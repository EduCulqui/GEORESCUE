"""Capa de lluvia: lectura de Open-Meteo, caché compartida y fallos. Sin red."""
import httpx
import pytest

from app.infrastructure.gateways.weather_gateway import OpenMeteoRainGateway, RainGatewayError
from app.services.weather_service import (
    MAX_EDAD_DATO_VIEJO_SEGUNDOS, TTL_SEGUNDOS, WeatherService, construir_cuadricula, nivel_de_lluvia,
)

PUNTOS = [(-7.16, -78.50), (-7.19, -78.50), (-7.13, -78.50)]


def cliente(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def item(mm):
    # Open-Meteo devuelve la rejilla del modelo en latitude/longitude: no deben usarse.
    return {"latitude": 99.0, "longitude": 99.0, "current": {"time": "2026-11-10T12:00", "precipitation": mm}}


def test_lee_la_lista_de_varias_ubicaciones_en_el_orden_pedido():
    pedidos = []

    def handler(request):
        pedidos.append(request)
        return httpx.Response(200, json=[item(0.0), item(3.2), item(None)])

    r = OpenMeteoRainGateway(cliente(handler)).precipitacion_mm(PUNTOS)

    assert r == [{"lat": -7.16, "lng": -78.50, "mm": 0.0}, {"lat": -7.19, "lng": -78.50, "mm": 3.2}]
    assert pedidos[0].url.params["latitude"] == "-7.1600,-7.1900,-7.1300"
    assert pedidos[0].url.params["current"] == "precipitation"


def test_un_solo_punto_responde_un_objeto_no_una_lista():
    r = OpenMeteoRainGateway(cliente(lambda req: httpx.Response(200, json=item(1.0)))).precipitacion_mm(PUNTOS[:1])
    assert r[0]["mm"] == 1.0


@pytest.mark.parametrize("respuesta", [
    httpx.Response(500),
    httpx.Response(200, json=[item(1.0)]),            # faltan puntos
    httpx.Response(200, json=[{"sin": "current"}] * 3),
    httpx.Response(200, text="no es json"),
])
def test_respuestas_malas_lanzan_error_en_vez_de_inventar_lluvia(respuesta):
    with pytest.raises(RainGatewayError):
        OpenMeteoRainGateway(cliente(lambda req: respuesta)).precipitacion_mm(PUNTOS)


def test_proveedor_caido_lanza_error():
    def caido(request):
        raise httpx.ConnectError("sin red")

    with pytest.raises(RainGatewayError):
        OpenMeteoRainGateway(cliente(caido)).precipitacion_mm(PUNTOS)


def test_niveles_de_intensidad():
    assert [nivel_de_lluvia(x) for x in (0, 0.05, 0.1, 2.4, 2.5, 7.5, 7.6, 40)] == [
        "NINGUNA", "NINGUNA", "LIGERA", "LIGERA", "MODERADA", "MODERADA", "FUERTE", "FUERTE"]


def test_la_cuadricula_son_49_puntos_centrados_en_cajamarca():
    puntos = construir_cuadricula()
    assert len(puntos) == 49 and len(set(puntos)) == 49
    assert (-7.1637, -78.5003) in puntos


class GatewayFalso:
    def __init__(self, respuestas):
        self.respuestas = list(respuestas)
        self.llamadas = 0

    def precipitacion_mm(self, puntos):
        self.llamadas += 1
        r = self.respuestas.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


class Reloj:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


LLUEVE = [{"lat": -7.16, "lng": -78.5, "mm": 3.0}, {"lat": -7.2, "lng": -78.5, "mm": 0.0}]


def test_solo_se_envian_los_puntos_donde_llueve_y_se_guarda_en_cache():
    gw, reloj = GatewayFalso([LLUEVE, LLUEVE]), Reloj()
    servicio = WeatherService(gw, reloj)

    primera = servicio.obtener_lluvia()
    assert primera["estado"] == "OK"
    assert primera["puntos"] == [{"lat": -7.16, "lng": -78.5, "mm": 3.0, "nivel": "MODERADA"}]

    reloj.t += TTL_SEGUNDOS - 1
    servicio.obtener_lluvia()
    assert gw.llamadas == 1            # dentro de 15 min no se vuelve a consultar

    reloj.t += 2
    servicio.obtener_lluvia()
    assert gw.llamadas == 2            # pasado el plazo, sí


def test_si_el_proveedor_falla_se_usa_dato_viejo_marcado_como_desactualizado():
    gw, reloj = GatewayFalso([LLUEVE, RainGatewayError("x")]), Reloj()
    servicio = WeatherService(gw, reloj)
    servicio.obtener_lluvia()
    reloj.t += TTL_SEGUNDOS + 1
    r = servicio.obtener_lluvia()
    assert r["estado"] == "DESACTUALIZADO" and len(r["puntos"]) == 1


def test_dato_demasiado_viejo_no_se_muestra():
    gw, reloj = GatewayFalso([LLUEVE, RainGatewayError("x")]), Reloj()
    servicio = WeatherService(gw, reloj)
    servicio.obtener_lluvia()
    reloj.t += MAX_EDAD_DATO_VIEJO_SEGUNDOS + 1
    r = servicio.obtener_lluvia()
    assert r["estado"] == "NO_DISPONIBLE" and r["puntos"] == [] and r["actualizado"] is None


def test_sin_datos_previos_y_con_fallo_no_inventa_lluvia_y_espera_antes_de_reintentar():
    gw, reloj = GatewayFalso([RainGatewayError("x"), LLUEVE]), Reloj()
    servicio = WeatherService(gw, reloj)
    assert servicio.obtener_lluvia()["estado"] == "NO_DISPONIBLE"
    reloj.t += 10
    assert servicio.obtener_lluvia()["estado"] == "NO_DISPONIBLE"
    assert gw.llamadas == 1            # no se martilla al proveedor caído
    reloj.t += 60
    assert servicio.obtener_lluvia()["estado"] == "OK"


def test_cielo_despejado_es_ok_con_lista_vacia():
    r = WeatherService(GatewayFalso([[{"lat": -7.16, "lng": -78.5, "mm": 0.0}]]), Reloj()).obtener_lluvia()
    assert r["estado"] == "OK" and r["puntos"] == []

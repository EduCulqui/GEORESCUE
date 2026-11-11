"""Rutas de rescate: origen (base o cobertura) y cálculo por calles.

Corren sin red: Geoapify se simula con httpx.MockTransport.
"""
from types import SimpleNamespace
from datetime import datetime

import httpx

from app.infrastructure.gateways.routing_gateway import EmergencyRoutingGateway
from app.schemas.rescue import RutaRequest
from app.services.rescue_service import RescueService

BOMBEROS_59 = (-7.164414, -78.509673)
DESTINO = (-7.1700, -78.5100)


def cliente_simulado(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def respuesta_geoapify():
    return {
        "features": [{
            "properties": {"distance": 1530, "time": 185},
            "geometry": {
                "type": "MultiLineString",
                # GeoJSON: [lon, lat]
                "coordinates": [[[-78.509673, -7.164414], [-78.5100, -7.1700]]],
            },
        }]
    }


def test_ruta_calculada_convierte_lonlat_a_latlon_y_formatea():
    pedidos = []

    def handler(request):
        pedidos.append(request)
        return httpx.Response(200, json=respuesta_geoapify())

    gw = EmergencyRoutingGateway(api_key="k", client=cliente_simulado(handler))
    r = gw.compute_rescue_route(*BOMBEROS_59, *DESTINO)

    assert r["estado_algoritmo"] == "RUTA_CALCULADA"
    assert r["distancia_km"] == 1.53
    assert r["tiempo_estimado"] == "3 min"
    assert r["puntos_ruta"][0] == [-7.164414, -78.509673]  # [lat, lon]
    assert r["bloqueos_evitados"] is None
    params = pedidos[0].url.params
    assert params["waypoints"] == f"{BOMBEROS_59[0]},{BOMBEROS_59[1]}|{DESTINO[0]},{DESTINO[1]}"
    assert params["mode"] == "drive"


def test_sin_clave_no_inventa_ruta():
    r = EmergencyRoutingGateway(api_key="").compute_rescue_route(*BOMBEROS_59, *DESTINO)
    assert r["estado_algoritmo"] == "PROVEEDOR_DE_RUTAS_NO_CONFIGURADO"
    assert r["puntos_ruta"] == [] and r["distancia_km"] is None


def test_clave_rechazada_y_proveedor_caido_no_inventan_ruta():
    rechazada = EmergencyRoutingGateway(api_key="k", client=cliente_simulado(lambda r: httpx.Response(401)))
    assert rechazada.compute_rescue_route(*BOMBEROS_59, *DESTINO)["estado_algoritmo"] == "PROVEEDOR_DE_RUTAS_CLAVE_RECHAZADA"

    def caido(request):
        raise httpx.ConnectError("sin red")

    gw = EmergencyRoutingGateway(api_key="k", client=cliente_simulado(caido))
    r = gw.compute_rescue_route(*BOMBEROS_59, *DESTINO)
    assert r["estado_algoritmo"] == "PROVEEDOR_DE_RUTAS_NO_DISPONIBLE"
    assert r["puntos_ruta"] == [] and r["tiempo_estimado"] is None


def test_respuesta_con_formato_inesperado():
    gw = EmergencyRoutingGateway(api_key="k", client=cliente_simulado(lambda r: httpx.Response(200, json={"features": []})))
    assert gw.compute_rescue_route(*BOMBEROS_59, *DESTINO)["estado_algoritmo"] == "PROVEEDOR_DE_RUTAS_RESPUESTA_INVALIDA"


def test_la_clave_no_aparece_en_los_logs(caplog):
    def caido(request):
        raise httpx.ConnectError("fallo")

    EmergencyRoutingGateway(api_key="CLAVE-SECRETA", client=cliente_simulado(caido)).compute_rescue_route(*BOMBEROS_59, *DESTINO)
    assert "CLAVE-SECRETA" not in caplog.text


class GatewayFalso:
    def __init__(self):
        self.llamadas = []

    def compute_rescue_route(self, **kwargs):
        self.llamadas.append(kwargs)
        return {"distancia_km": 1.0, "tiempo_estimado": "2 min", "estado_algoritmo": "RUTA_CALCULADA",
                "bloqueos_evitados": None, "puntos_ruta": [[0.0, 0.0]]}


class DbConCuenta:
    def __init__(self, cuenta):
        self.cuenta = cuenta

    def query(self, _modelo):
        return self

    def filter(self, *_args):
        return self

    def first(self):
        return self.cuenta


def cuenta(base=None, cobertura=None, validada=True):
    return SimpleNamespace(
        base_lat=base[0] if base else None, base_lng=base[1] if base else None,
        coverage_lat=cobertura[0] if cobertura else None, coverage_lng=cobertura[1] if cobertura else None,
        coverage_validated_at=datetime(2026, 10, 1) if validada else None,
    )


def pedir(servicio, institucion="Bomberos N.° 59", **extra):
    return servicio.calcular_ruta_rescate(
        RutaRequest(destino_lat=DESTINO[0], destino_lng=DESTINO[1], **extra), institucion=institucion)


def test_el_origen_es_la_base_de_la_institucion():
    gw = GatewayFalso()
    r = pedir(RescueService(DbConCuenta(cuenta(base=BOMBEROS_59, cobertura=(-7.0, -78.0))), gw))
    assert r.origen_tipo == "BASE_INSTITUCION"
    assert (gw.llamadas[0]["origen_lat"], gw.llamadas[0]["origen_lng"]) == BOMBEROS_59


def test_sin_base_usa_el_centro_de_cobertura_validada():
    gw = GatewayFalso()
    r = pedir(RescueService(DbConCuenta(cuenta(cobertura=(-7.1637, -78.5003))), gw))
    assert r.origen_tipo == "CENTRO_COBERTURA"


def test_sin_base_ni_cobertura_validada_no_se_calcula_nada():
    gw = GatewayFalso()
    r = pedir(RescueService(DbConCuenta(cuenta(cobertura=(-7.1, -78.5), validada=False)), gw))
    assert r.estado_algoritmo == "INSTITUCION_SIN_BASE_NI_COBERTURA"
    assert gw.llamadas == [] and r.puntos_ruta == []


def test_origen_manual_tiene_prioridad():
    gw = GatewayFalso()
    r = pedir(RescueService(DbConCuenta(cuenta(base=BOMBEROS_59)), gw), origen_lat=-7.2, origen_lng=-78.4)
    assert r.origen_tipo == "MANUAL" and gw.llamadas[0]["origen_lat"] == -7.2

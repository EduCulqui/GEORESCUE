import logging
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import settings
from app.core.geo import distancia_minima_a_ruta_m, puntos_a_evitar
from app.domain.interfaces.gateways import IRoutingGateway

logger = logging.getLogger("georescue.routing")

GEOAPIFY_ROUTING_URL = "https://api.geoapify.com/v1/routing"
TIMEOUT_SEGUNDOS = 8.0
MAX_REGLAS_EVITAR = 15


def _sin_ruta(estado: str) -> Dict[str, Any]:
    """Respuesta honesta: no se inventa distancia, tiempo ni trazado."""
    return {
        "distancia_km": None,
        "tiempo_estimado": None,
        "estado_algoritmo": estado,
        "bloqueos_evitados": None,
        "puntos_ruta": [],
    }


def _formatear_tiempo(segundos: float) -> str:
    minutos = max(1, round(segundos / 60))
    if minutos < 60:
        return f"{minutos} min"
    horas, resto = divmod(minutos, 60)
    return f"{horas} h {resto} min" if resto else f"{horas} h"


class EmergencyRoutingGateway(IRoutingGateway):
    """Ruta terrestre por calles reales (Geoapify sobre OpenStreetMap).

    Sin clave configurada devuelve PROVEEDOR_DE_RUTAS_NO_CONFIGURADO: nunca se
    inventa una ruta ni un tiempo de llegada.
    """

    def __init__(self, api_key: Optional[str] = None, client: Optional[httpx.Client] = None):
        self.api_key = settings.GEOAPIFY_API_KEY if api_key is None else api_key
        self._client = client

    def compute_rescue_route(
        self,
        origen_lat: float,
        origen_lng: float,
        destino_lat: float,
        destino_lng: float,
        evitar_bloqueos: bool = False,
        zonas_bloqueadas: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        zonas = zonas_bloqueadas or []
        if not self.api_key:
            logger.warning("Proveedor de rutas no configurado; no se calcula ruta ni ETA.")
            return _sin_ruta("PROVEEDOR_DE_RUTAS_NO_CONFIGURADO")

        params = {
            # Geoapify espera lat,lon en waypoints.
            "waypoints": f"{origen_lat},{origen_lng}|{destino_lat},{destino_lng}",
            "mode": "drive",
            "traffic": "approximated",
            "apiKey": self.api_key,
        }
        if zonas:
            reglas = [
                f"location:{lat},{lng}"
                for zona in zonas
                for lat, lng in puntos_a_evitar(zona["latitud"], zona["longitud"], zona["radio_m"])
            ]
            # Tope de reglas: cada una consume créditos y alarga la consulta.
            params["avoid"] = "|".join(reglas[:MAX_REGLAS_EVITAR])
        try:
            cliente = self._client or httpx.Client(timeout=TIMEOUT_SEGUNDOS)
            try:
                respuesta = cliente.get(GEOAPIFY_ROUTING_URL, params=params)
            finally:
                if self._client is None:
                    cliente.close()
            if respuesta.status_code in (401, 403):
                logger.error("Geoapify rechazó la clave (HTTP %s).", respuesta.status_code)
                return _sin_ruta("PROVEEDOR_DE_RUTAS_CLAVE_RECHAZADA")
            respuesta.raise_for_status()
            return self._con_zonas(self._interpretar(respuesta.json()), zonas)
        except httpx.HTTPError as exc:
            # No se registra la URL: lleva la clave y las coordenadas.
            logger.error("Fallo al consultar el proveedor de rutas: %s", exc.__class__.__name__)
            return _sin_ruta("PROVEEDOR_DE_RUTAS_NO_DISPONIBLE")
        except (ValueError, KeyError, IndexError, TypeError):
            logger.error("Respuesta de rutas con formato inesperado.")
            return _sin_ruta("PROVEEDOR_DE_RUTAS_RESPUESTA_INVALIDA")

    @staticmethod
    def _con_zonas(resultado: Dict[str, Any], zonas: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Verifica por cuenta propia si la ruta devuelta cruza alguna zona marcada.

        No se confía en que el proveedor haya evitado la zona: se mide la ruta.
        """
        resultado["zonas_consideradas"] = len(zonas)
        resultado["zonas_cruzadas"] = [
            zona["id"] for zona in zonas
            if distancia_minima_a_ruta_m(zona["latitud"], zona["longitud"], resultado["puntos_ruta"]) < zona["radio_m"]
        ]
        if zonas:
            resultado["bloqueos_evitados"] = not resultado["zonas_cruzadas"]
        return resultado

    @staticmethod
    def _interpretar(datos: Dict[str, Any]) -> Dict[str, Any]:
        rasgo = datos["features"][0]
        propiedades = rasgo["properties"]
        geometria = rasgo["geometry"]
        tramos = geometria["coordinates"]
        if geometria["type"] == "LineString":
            tramos = [tramos]
        # GeoJSON viene como [lon, lat]; el mapa (Leaflet) usa [lat, lon].
        puntos: List[List[float]] = [[lat, lon] for tramo in tramos for lon, lat in tramo]
        if not puntos:
            raise ValueError("ruta sin geometría")
        return {
            "distancia_km": round(float(propiedades["distance"]) / 1000, 2),
            "tiempo_estimado": _formatear_tiempo(float(propiedades["time"])),
            "estado_algoritmo": "RUTA_CALCULADA",
            # Sin zonas marcadas no se afirma nada (None); con zonas lo fija _con_zonas.
            "bloqueos_evitados": None,
            "zonas_consideradas": 0,
            "zonas_cruzadas": [],
            "puntos_ruta": puntos,
        }

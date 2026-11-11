import logging
from typing import Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger("georescue.weather")

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
TIMEOUT_SEGUNDOS = 10.0


class RainGatewayError(Exception):
    """El proveedor de lluvia no respondió o respondió algo inesperado."""


class OpenMeteoRainGateway:
    """Precipitación estimada por el modelo de Open-Meteo en una lista de puntos.

    Es una estimación de modelo meteorológico, no una medición de radar ni de
    pluviómetro. Open-Meteo es gratis para uso no comercial y no pide clave.
    """

    def __init__(self, client: Optional[httpx.Client] = None):
        self._client = client

    def precipitacion_mm(self, puntos: List[Tuple[float, float]]) -> List[Dict[str, float]]:
        """Devuelve [{lat, lng, mm}] con los puntos pedidos (no los de la rejilla del modelo).

        Los puntos sin dato se omiten. Una sola consulta cubre todos los puntos.
        """
        params = {
            "latitude": ",".join(f"{lat:.4f}" for lat, _ in puntos),
            "longitude": ",".join(f"{lng:.4f}" for _, lng in puntos),
            # Suma de la hora anterior, en mm.
            "current": "precipitation",
        }
        try:
            cliente = self._client or httpx.Client(timeout=TIMEOUT_SEGUNDOS)
            try:
                respuesta = cliente.get(OPEN_METEO_URL, params=params)
            finally:
                if self._client is None:
                    cliente.close()
            respuesta.raise_for_status()
            datos = respuesta.json()
        except httpx.HTTPError as exc:
            logger.error("Fallo al consultar la lluvia: %s", exc.__class__.__name__)
            raise RainGatewayError("proveedor_no_disponible") from exc
        except ValueError as exc:
            raise RainGatewayError("respuesta_invalida") from exc

        # Con varias coordenadas la respuesta es una lista, en el mismo orden pedido.
        items = datos if isinstance(datos, list) else [datos]
        if len(items) != len(puntos):
            raise RainGatewayError("respuesta_invalida")
        resultado = []
        for (lat, lng), item in zip(puntos, items):
            try:
                mm = item["current"]["precipitation"]
            except (KeyError, TypeError):
                raise RainGatewayError("respuesta_invalida")
            if mm is None:
                continue
            resultado.append({"lat": lat, "lng": lng, "mm": float(mm)})
        return resultado

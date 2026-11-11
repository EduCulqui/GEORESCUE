import threading
import time
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from app.infrastructure.gateways.weather_gateway import OpenMeteoRainGateway, RainGatewayError

# Centro de la cuadrícula: ciudad de Cajamarca.
CENTRO_LAT, CENTRO_LNG = -7.1637, -78.5003
LADO = 7            # 7 x 7 = 49 puntos por consulta (cada punto cuenta como una llamada).
PASO_GRADOS = 0.03  # ~3.3 km entre puntos: la cuadrícula cubre unos 20 km de lado.
RADIO_M = 1650      # radio con que se dibuja cada punto (media separación).

# Se refresca como mucho cada 15 min (Open-Meteo actualiza datos actuales en ese ritmo):
# todos los operadores comparten la misma consulta y el uso diario queda muy bajo el límite.
TTL_SEGUNDOS = 15 * 60
REINTENTO_TRAS_FALLO_SEGUNDOS = 60
MAX_EDAD_DATO_VIEJO_SEGUNDOS = 60 * 60

# Umbrales habituales de intensidad en mm por hora.
UMBRAL_LIGERA, UMBRAL_MODERADA, UMBRAL_FUERTE = 0.1, 2.5, 7.6


def nivel_de_lluvia(mm: float) -> str:
    if mm >= UMBRAL_FUERTE:
        return "FUERTE"
    if mm >= UMBRAL_MODERADA:
        return "MODERADA"
    if mm >= UMBRAL_LIGERA:
        return "LIGERA"
    return "NINGUNA"


def construir_cuadricula() -> List[tuple]:
    mitad = LADO // 2
    return [
        (round(CENTRO_LAT + i * PASO_GRADOS, 4), round(CENTRO_LNG + j * PASO_GRADOS, 4))
        for i in range(-mitad, mitad + 1)
        for j in range(-mitad, mitad + 1)
    ]


class WeatherService:
    """Lluvia estimada sobre Cajamarca, con caché compartida entre usuarios."""

    def __init__(self, gateway=None, reloj: Callable[[], float] = time.monotonic):
        self.gateway = gateway or OpenMeteoRainGateway()
        self._reloj = reloj
        self._lock = threading.Lock()
        self._cache: Optional[Dict[str, Any]] = None
        self._cache_t = 0.0
        self._ultimo_fallo_t: Optional[float] = None

    def _respuesta(self, estado: str, datos: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        return {
            "estado": estado,
            "fuente": "Open-Meteo (modelo meteorológico, no radar)",
            "actualizado": datos["actualizado"] if datos else None,
            "radio_m": RADIO_M,
            "puntos": datos["puntos"] if datos else [],
        }

    def obtener_lluvia(self) -> Dict[str, Any]:
        with self._lock:
            ahora = self._reloj()
            if self._cache and ahora - self._cache_t < TTL_SEGUNDOS:
                return self._respuesta("OK", self._cache)
            fallo_reciente = (
                self._ultimo_fallo_t is not None
                and ahora - self._ultimo_fallo_t < REINTENTO_TRAS_FALLO_SEGUNDOS
            )
            if not fallo_reciente:
                try:
                    medidas = self.gateway.precipitacion_mm(construir_cuadricula())
                    puntos = []
                    for medida in medidas:
                        nivel = nivel_de_lluvia(medida["mm"])
                        if nivel != "NINGUNA":  # solo se envían los puntos donde llueve
                            puntos.append({**medida, "mm": round(medida["mm"], 1), "nivel": nivel})
                    self._cache = {"actualizado": datetime.utcnow().isoformat() + "Z", "puntos": puntos}
                    self._cache_t = ahora
                    self._ultimo_fallo_t = None
                    return self._respuesta("OK", self._cache)
                except RainGatewayError:
                    self._ultimo_fallo_t = ahora
            # Falló o se espera antes de reintentar: se usa el dato viejo solo si es reciente.
            if self._cache and ahora - self._cache_t < MAX_EDAD_DATO_VIEJO_SEGUNDOS:
                return self._respuesta("DESACTUALIZADO", self._cache)
            return self._respuesta("NO_DISPONIBLE", None)

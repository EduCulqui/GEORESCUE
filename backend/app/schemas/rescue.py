from pydantic import BaseModel, Field
from typing import Dict, List, Optional

class RutaRequest(BaseModel):
    # Si no se envía el origen, se usa la base de la institución del usuario
    # (o el centro de su cobertura como respaldo).
    origen_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    origen_lng: Optional[float] = Field(default=None, ge=-180, le=180)
    destino_lat: float = Field(..., ge=-90, le=90)
    destino_lng: float = Field(..., ge=-180, le=180)
    bloqueos_detectados: bool = Field(default=False)

class RutaResponse(BaseModel):
    origen: Optional[Dict[str, float]] = None
    destino: Dict[str, float]
    # BASE_INSTITUCION, CENTRO_COBERTURA (respaldo) o MANUAL.
    origen_tipo: Optional[str] = None
    bloqueos_evitados: Optional[bool] = None
    distancia_km: Optional[float] = None
    tiempo_estimado_llegada: Optional[str] = None
    estado_algoritmo: str
    puntos_ruta: List[List[float]] = Field(default_factory=list)

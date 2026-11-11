from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from typing import Dict, List, Literal, Optional

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
    # Zonas marcadas por operadores que se tuvieron en cuenta y cuáles sigue cruzando la ruta.
    zonas_consideradas: int = 0
    zonas_cruzadas: List[int] = Field(default_factory=list)


MotivoZona = Literal["INUNDACION", "DERRUMBE", "CIERRE_VIAL", "OTRO"]


class ZonaBloqueadaCreate(BaseModel):
    latitud: float = Field(..., ge=-90, le=90)
    longitud: float = Field(..., ge=-180, le=180)
    radio_m: float = Field(default=100, ge=20, le=2000)
    motivo: MotivoZona
    nota: Optional[str] = Field(default=None, max_length=200)
    # El bloqueo vence solo: uno olvidado no debe desviar ambulancias por días.
    duracion_horas: int = Field(default=12, ge=1, le=72)


class ZonaBloqueadaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    latitud: float
    longitud: float
    radio_m: float
    motivo: str
    nota: Optional[str] = None
    creada_por: str
    institucion: Optional[str] = None
    creado_en: datetime
    expira_en: datetime

from typing import Optional

from pydantic import BaseModel, Field


class AntiTheftAlertRequest(BaseModel):
    """Payload enviado por la PWA cuando se detecta una amenaza o una manipulación del sistema."""

    usuario: Optional[str] = None
    dispositivo_id: Optional[str] = None
    latitud: float = Field(..., ge=-90, le=90)
    longitud: float = Field(..., ge=-180, le=180)
    foto_base64: str = Field(..., min_length=50)
    correo_destino: Optional[str] = None
    tipo_evento: str = "ANTI_THEFT"


class AntiTheftAlertResponse(BaseModel):
    alerta_id: int
    mensaje: str
    latitud: float
    longitud: float
    mapa_url: str
    email_enviado: bool

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class FamiliarCreate(BaseModel):
    usuario_invitado: str = Field(..., min_length=1, max_length=100)
    parentesco: str = Field(..., min_length=2, max_length=80)


class FamiliarResponse(BaseModel):
    id: int
    usuario_responsable: str
    nombre: str
    parentesco: str
    familiar_usuario: str
    consentimiento_en: datetime
    revocado_en: Optional[datetime] = None


class FamilyInvitationResponse(BaseModel):
    id: int
    invitante_usuario: str
    invitado_usuario: str
    parentesco: str
    estado: str
    creado_en: datetime
    respondido_en: Optional[datetime] = None

    class Config:
        from_attributes = True

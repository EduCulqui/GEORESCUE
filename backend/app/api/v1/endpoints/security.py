from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.security import AntiTheftAlertRequest, AntiTheftAlertResponse
from app.services.security_service import SecurityService

router = APIRouter(prefix="/security", tags=["Seguridad Inteligente"])


@router.post(
    "/anti-theft-alert",
    response_model=AntiTheftAlertResponse,
    status_code=status.HTTP_201_CREATED,
)
def anti_theft_alert(
    payload: AntiTheftAlertRequest,
    db: Session = Depends(get_db),
):
    """Recibe una foto y coordenadas del dispositivo para registrar una alerta de seguridad."""
    service = SecurityService(db)
    return service.process_anti_theft_alert(payload)

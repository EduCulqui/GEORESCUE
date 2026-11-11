from typing import List

from fastapi import APIRouter, Depends, HTTPException, status

from app.schemas.rescue import LluviaResponse, RutaRequest, RutaResponse, ZonaBloqueadaCreate, ZonaBloqueadaResponse
from app.services.rescue_service import RescueService
from app.api.deps import get_rescue_service, get_weather_service, require_permission
from app.services.weather_service import WeatherService

router = APIRouter(prefix="/rescate", tags=["Operaciones de Rescate"])

@router.post("/calcular-ruta/", response_model=RutaResponse)
def calcular_ruta(
    data: RutaRequest,
    user: dict = Depends(require_permission("map:view")),
    rescue_service: RescueService = Depends(get_rescue_service)
):
    """Cálculo de ruta de rescate por calles, evitando las zonas bloqueadas vigentes."""
    return rescue_service.calcular_ruta_rescate(data, institucion=user.get("institucion"))


@router.get("/zonas-bloqueadas/", response_model=List[ZonaBloqueadaResponse])
def listar_zonas_bloqueadas(
    _: dict = Depends(require_permission("map:view")),
    rescue_service: RescueService = Depends(get_rescue_service),
):
    """Zonas vigentes. Un bloqueo es un hecho físico: lo ven todas las instituciones."""
    return rescue_service.zonas_activas()


@router.post("/zonas-bloqueadas/", response_model=ZonaBloqueadaResponse, status_code=status.HTTP_201_CREATED)
def marcar_zona_bloqueada(
    data: ZonaBloqueadaCreate,
    user: dict = Depends(require_permission("alert:handle")),
    rescue_service: RescueService = Depends(get_rescue_service),
):
    """Marca una zona como no transitable. Vence sola a las horas indicadas."""
    return rescue_service.crear_zona(data, usuario=user.get("sub", "desconocido"), institucion=user.get("institucion"))


@router.delete("/zonas-bloqueadas/{zona_id}", response_model=ZonaBloqueadaResponse)
def levantar_zona_bloqueada(
    zona_id: int,
    user: dict = Depends(require_permission("alert:handle")),
    rescue_service: RescueService = Depends(get_rescue_service),
):
    """Levanta el bloqueo (la zona deja de evitarse). Queda registrado quién lo levantó."""
    zona = rescue_service.levantar_zona(zona_id, usuario=user.get("sub", "desconocido"))
    if not zona:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="La zona no existe o ya fue levantada.")
    return zona


@router.get("/lluvia/", response_model=LluviaResponse)
def consultar_lluvia(
    _: dict = Depends(require_permission("map:view")),
    weather_service: WeatherService = Depends(get_weather_service),
):
    """Lluvia estimada por modelo sobre Cajamarca. Es informativa: no cambia las rutas."""
    return weather_service.obtener_lluvia()

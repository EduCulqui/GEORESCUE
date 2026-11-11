from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.infrastructure.gateways.routing_gateway import EmergencyRoutingGateway
from app.models.rescue import ZonaBloqueada
from app.models.subscription import InstitutionAccount
from app.schemas.rescue import RutaRequest, RutaResponse, ZonaBloqueadaCreate


class RescueService:
    """Servicio de operaciones tácticas de rescate y enrutamiento."""

    def __init__(self, db: Optional[Session] = None, routing_gateway=None):
        self.db = db
        self.routing_gateway = routing_gateway or EmergencyRoutingGateway()

    def _origen_de_institucion(self, institucion: Optional[str]) -> Optional[Tuple[float, float, str]]:
        """Base registrada; si no hay, centro de cobertura validada; si no, nada."""
        if not self.db or not institucion:
            return None
        cuenta = self.db.query(InstitutionAccount).filter(
            InstitutionAccount.institution_name == institucion,
            InstitutionAccount.is_active.is_(True),
        ).first()
        if not cuenta:
            return None
        if cuenta.base_lat is not None and cuenta.base_lng is not None:
            return cuenta.base_lat, cuenta.base_lng, "BASE_INSTITUCION"
        if (
            cuenta.coverage_validated_at is not None
            and cuenta.coverage_lat is not None
            and cuenta.coverage_lng is not None
        ):
            return cuenta.coverage_lat, cuenta.coverage_lng, "CENTRO_COBERTURA"
        return None

    # ---- Zonas bloqueadas -------------------------------------------------
    def zonas_activas(self) -> List[ZonaBloqueada]:
        """Zonas vigentes: no levantadas y no vencidas."""
        if not self.db:
            return []
        return self.db.query(ZonaBloqueada).filter(
            ZonaBloqueada.activa.is_(True),
            ZonaBloqueada.expira_en > datetime.utcnow(),
        ).order_by(ZonaBloqueada.creado_en.desc()).all()

    def crear_zona(self, datos: ZonaBloqueadaCreate, usuario: str, institucion: Optional[str]) -> ZonaBloqueada:
        zona = ZonaBloqueada(
            latitud=datos.latitud,
            longitud=datos.longitud,
            radio_m=datos.radio_m,
            motivo=datos.motivo,
            nota=(datos.nota or "").strip() or None,
            creada_por=usuario,
            institucion=institucion,
            expira_en=datetime.utcnow() + timedelta(hours=datos.duracion_horas),
        )
        self.db.add(zona)
        self.db.commit()
        self.db.refresh(zona)
        return zona

    def levantar_zona(self, zona_id: int, usuario: str) -> Optional[ZonaBloqueada]:
        zona = self.db.query(ZonaBloqueada).filter(
            ZonaBloqueada.id == zona_id, ZonaBloqueada.activa.is_(True),
        ).first()
        if not zona:
            return None
        zona.activa = False
        zona.levantada_por = usuario
        zona.levantada_en = datetime.utcnow()
        self.db.add(zona)
        self.db.commit()
        self.db.refresh(zona)
        return zona

    def _zonas_cercanas(self, lat1: float, lng1: float, lat2: float, lng2: float) -> List[Dict[str, Any]]:
        """Zonas vigentes dentro del rectángulo de la ruta más ~2 km de margen."""
        margen = 0.02
        sur, norte = min(lat1, lat2) - margen, max(lat1, lat2) + margen
        oeste, este = min(lng1, lng2) - margen, max(lng1, lng2) + margen
        return [
            {"id": z.id, "latitud": z.latitud, "longitud": z.longitud, "radio_m": z.radio_m}
            for z in self.zonas_activas()
            if sur <= z.latitud <= norte and oeste <= z.longitud <= este
        ]

    def calcular_ruta_rescate(self, ruta_in: RutaRequest, institucion: Optional[str] = None) -> RutaResponse:
        destino = {"lat": ruta_in.destino_lat, "lng": ruta_in.destino_lng}

        if ruta_in.origen_lat is not None and ruta_in.origen_lng is not None:
            origen = (ruta_in.origen_lat, ruta_in.origen_lng, "MANUAL")
        else:
            origen = self._origen_de_institucion(institucion)
        if origen is None:
            return RutaResponse(
                origen=None,
                destino=destino,
                estado_algoritmo="INSTITUCION_SIN_BASE_NI_COBERTURA",
            )

        lat, lng, tipo = origen
        zonas = self._zonas_cercanas(lat, lng, ruta_in.destino_lat, ruta_in.destino_lng)
        resultado = self.routing_gateway.compute_rescue_route(
            origen_lat=lat,
            origen_lng=lng,
            destino_lat=ruta_in.destino_lat,
            destino_lng=ruta_in.destino_lng,
            evitar_bloqueos=bool(zonas),
            zonas_bloqueadas=zonas,
        )
        return RutaResponse(
            origen={"lat": lat, "lng": lng},
            destino=destino,
            origen_tipo=tipo,
            bloqueos_evitados=resultado["bloqueos_evitados"],
            distancia_km=resultado["distancia_km"],
            tiempo_estimado_llegada=resultado["tiempo_estimado"],
            estado_algoritmo=resultado["estado_algoritmo"],
            puntos_ruta=resultado["puntos_ruta"],
            zonas_consideradas=resultado.get("zonas_consideradas", 0),
            zonas_cruzadas=resultado.get("zonas_cruzadas", []),
        )

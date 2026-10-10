import base64
import smtplib
from datetime import datetime
from email.message import EmailMessage
from typing import Optional

from geoalchemy2.elements import WKTElement
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.security import SeguridadEvento
from app.schemas.security import AntiTheftAlertRequest, AntiTheftAlertResponse


class SecurityService:
    """Procesa eventos anti-robo y alerta por correo para el propietario."""

    def __init__(self, db: Session):
        self.db = db

    def process_anti_theft_alert(self, payload: AntiTheftAlertRequest) -> AntiTheftAlertResponse:
        # Validación básica del payload para evitar basura o contenido corrupto.
        foto_limpia = self._normalize_base64_image(payload.foto_base64)

        event = SeguridadEvento(
            usuario=payload.usuario or payload.dispositivo_id,
            dispositivo_id=payload.dispositivo_id or payload.usuario,
            tipo_evento=payload.tipo_evento or "ANTI_THEFT",
            latitud=float(payload.latitud),
            longitud=float(payload.longitud),
            foto_base64=foto_limpia,
            correo_destino=payload.correo_destino or settings.DEFAULT_SECURITY_EMAIL,
            email_enviado=False,
            ubicacion=WKTElement(f"POINT({payload.longitud} {payload.latitud})", srid=4326),
            creado_en=datetime.utcnow(),
        )

        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)

        map_url = self._build_internal_map_url(event.id, payload.latitud, payload.longitud)
        email_enviado = self._send_security_email(event, map_url)

        event.email_enviado = email_enviado
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)

        return AntiTheftAlertResponse(
            alerta_id=event.id,
            mensaje="Alerta antirrobo registrada y enviada al titular del dispositivo.",
            latitud=event.latitud,
            longitud=event.longitud,
            mapa_url=map_url,
            email_enviado=email_enviado,
        )

    @staticmethod
    def _normalize_base64_image(data_url: str) -> str:
        if not data_url or len(data_url) < 64:
            raise ValueError("La foto no tiene un contenido válido para generar la alerta.")

        if data_url.startswith("data:image/"):
            header, _, payload = data_url.partition(",")
            if payload:
                return payload
            raise ValueError("La imagen base64 está incompleta.")

        # Se acepta también el caso de que el cliente ya haya enviado solo el contenido base64.
        return data_url

    @staticmethod
    def _detect_image_mime(data_url: str) -> str:
        if data_url.startswith("data:image/png"):
            return "image/png"
        return "image/jpeg"

    @staticmethod
    def _decode_image(data_url: str) -> bytes:
        clean = SecurityService._normalize_base64_image(data_url)
        return base64.b64decode(clean, validate=True)

    @staticmethod
    def _build_internal_map_url(alerta_id: int, latitud: float, longitud: float) -> str:
        base = settings.APP_BASE_URL.rstrip("/")
        return f"{base}/?lat={latitud}&lon={longitud}&alerta_id={alerta_id}&focus=security"

    def _send_security_email(self, event: SeguridadEvento, map_url: str) -> bool:
        recipient = event.correo_destino or settings.DEFAULT_SECURITY_EMAIL
        if not settings.SMTP_HOST or not recipient:
            return False

        try:
            image_bytes = self._decode_image(event.foto_base64)
            image_mime = self._detect_image_mime(event.foto_base64)
            image_ext = "png" if image_mime == "image/png" else "jpg"

            msg = EmailMessage()
            msg["Subject"] = f"[GEORESCUE IA] Alerta antirrobo #{event.id}"
            msg["From"] = settings.SMTP_FROM_EMAIL or settings.SMTP_USERNAME
            msg["To"] = recipient
            msg.set_content(
                "Se registró una posible intrusión. Revisa la ubicación del evento y la evidencia adjunta.",
                subtype="plain",
            )

            html = f"""
            <html>
              <body style="font-family: Arial, sans-serif; background:#0b1220; color:#e2e8f0; padding:24px;">
                <h2 style="color:#f87171;">🔒 Alerta antirrobo GEORESCUE IA</h2>
                <p><strong>Usuario:</strong> {event.usuario or 'Desconocido'}</p>
                <p><strong>Dispositivo:</strong> {event.dispositivo_id or 'No informado'}</p>
                <p><strong>Hora:</strong> {event.creado_en.strftime('%Y-%m-%d %H:%M:%S UTC')}</p>
                <p><strong>Coordenadas:</strong> {event.latitud}, {event.longitud}</p>
                <p>
                  <a href="{map_url}" style="color:#60a5fa;">Abrir mapa interno de la alerta</a>
                </p>
                <img src="cid:intruso" alt="Evidencia de intrusión" style="max-width:100%; border-radius:12px; border:1px solid #334155;" />
              </body>
            </html>
            """
            msg.add_alternative(html, subtype="html")
            msg.get_payload()[1].set_param("charset", "utf-8")
            msg.add_attachment(
                image_bytes,
                maintype="image",
                subtype=image_ext,
                filename=f"intruso_{event.id}.{image_ext}",
            )

            # Se adjunta la imagen como parte embebida para no depender de un CDN externo.
            msg.get_payload()[-1].add_header("Content-ID", "<intruso>")

            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as smtp:
                if settings.SMTP_USE_TLS:
                    smtp.starttls()
                if settings.SMTP_USERNAME and settings.SMTP_PASSWORD:
                    smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                smtp.send_message(msg)

            return True
        except Exception:
            return False

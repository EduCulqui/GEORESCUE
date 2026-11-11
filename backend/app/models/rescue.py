from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String

from app.db.base import Base


class ZonaBloqueada(Base):
    """Zona que el operador marca como no transitable (inundación, derrumbe, cierre).

    La lluvia por sí sola no bloquea una calle: lo que la bloquea es lo que provoca.
    Por eso la zona la decide una persona, y vence sola (expira_en) para que un
    bloqueo olvidado no desvíe ambulancias por días.
    """

    __tablename__ = "zonas_bloqueadas"

    id = Column(Integer, primary_key=True, autoincrement=True)
    latitud = Column(Float, nullable=False)
    longitud = Column(Float, nullable=False)
    radio_m = Column(Float, nullable=False, default=100.0)
    motivo = Column(String(30), nullable=False)
    nota = Column(String(200), nullable=True)
    creada_por = Column(String(120), nullable=False)
    institucion = Column(String(120), nullable=True)
    creado_en = Column(DateTime, default=datetime.utcnow, nullable=False)
    expira_en = Column(DateTime, nullable=False, index=True)
    activa = Column(Boolean, default=True, nullable=False, index=True)
    levantada_por = Column(String(120), nullable=True)
    levantada_en = Column(DateTime, nullable=True)

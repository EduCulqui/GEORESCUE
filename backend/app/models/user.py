from sqlalchemy import Column, Integer, String
from app.db.base import Base

class Usuario(Base):
    __tablename__ = "usuarios"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    usuario = Column(String(100), unique=True, index=True, nullable=False)
    password = Column(String(255), nullable=False) # Coincide con la columna existente en PostgreSQL
    rol = Column(String(50), default="ciudadano", nullable=False)
    institucion = Column(String(120), default="individual", nullable=False)
    permisos = Column(String(500), default="[]", nullable=False)
    is_active = Column(Integer, default=1, nullable=False)
    codigo_enlace = Column(String(50), unique=True, nullable=False)

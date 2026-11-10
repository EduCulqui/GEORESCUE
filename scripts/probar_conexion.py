"""Diagnóstico de la conexión a PostgreSQL.

Muestra qué credenciales está leyendo el proyecto (las mismas que usan el backend
y preparar_bd.py) y el mensaje real de PostgreSQL, que en Windows en español
psycopg2 no logra mostrar por sí solo.

Uso, desde la raíz del proyecto:
    python scripts/probar_conexion.py
"""
import os
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "backend"))

import psycopg2  # noqa: E402

from app.core.config import settings  # noqa: E402

print("=== Lo que el proyecto está leyendo ===")
for ruta in (RAIZ / "backend" / ".env", RAIZ / ".env"):
    print(f"Archivo {ruta}: {'existe' if ruta.exists() else 'NO existe'}")
print(f"Host:     {settings.DB_HOST!r}")
print(f"Puerto:   {settings.DB_PORT!r}")
print(f"Usuario:  {settings.DB_USER!r}")
print(f"Base:     {settings.DB_NAME!r}")
print(f"Password: {settings.DB_PASSWORD!r}  ({len(settings.DB_PASSWORD)} caracteres)")
if "DB_PASSWORD" in os.environ and os.environ["DB_PASSWORD"] != settings.DB_PASSWORD:
    print("AVISO: hay una variable de entorno DB_PASSWORD distinta en Windows.")

print("\n=== Prueba de conexión ===")
try:
    conexion = psycopg2.connect(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        dbname="postgres",
        connect_timeout=5,
    )
except UnicodeDecodeError as exc:
    # El servidor respondió con un mensaje en Windows-1252 que psycopg2 no decodifica.
    print("PostgreSQL respondió:", exc.object.decode("cp1252", errors="replace").strip())
    sys.exit(1)
except psycopg2.OperationalError as exc:
    print("Error:", str(exc).strip())
    sys.exit(1)

with conexion.cursor() as cursor:
    cursor.execute("SELECT version()")
    print("Conectado correctamente:", cursor.fetchone()[0])
conexion.close()

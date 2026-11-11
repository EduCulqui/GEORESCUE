import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user, get_rescue_service
from app.core.config import settings
from app.core.security import build_permissions_for_role
from app.schemas.rescue import RutaResponse
from main import app


@pytest.fixture
def client():
    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides.clear()
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous_overrides)


def test_calcular_ruta_requires_authentication(client):
    response = client.post("/api/v1/rescate/calcular-ruta/", json={
        "origen_lat": -7.16,
        "origen_lng": -78.52,
        "destino_lat": -7.17,
        "destino_lng": -78.53,
    })

    assert response.status_code == 401


def test_calcular_ruta_forbids_role_without_map_permission(client):
    app.dependency_overrides[get_current_user] = lambda: {
        "sub": "ciudadano-test",
        "rol": "ciudadano",
        "permisos": build_permissions_for_role("ciudadano"),
    }
    response = client.post("/api/v1/rescate/calcular-ruta/", json={
        "origen_lat": -7.16,
        "origen_lng": -78.52,
        "destino_lat": -7.17,
        "destino_lng": -78.53,
    })

    assert response.status_code == 403


def test_calcular_ruta_accepts_role_with_map_permission(client):
    class RescueServiceStub:
        def calcular_ruta_rescate(self, data, institucion=None):
            return RutaResponse(
                origen={"lat": data.origen_lat, "lng": data.origen_lng},
                destino={"lat": data.destino_lat, "lng": data.destino_lng},
                estado_algoritmo="calculada",
                puntos_ruta=[],
            )

    app.dependency_overrides[get_current_user] = lambda: {
        "sub": "operador-test",
        "rol": "operador",
        "permisos": build_permissions_for_role("operador"),
    }
    app.dependency_overrides[get_rescue_service] = RescueServiceStub
    response = client.post("/api/v1/rescate/calcular-ruta/", json={
        "origen_lat": -7.16,
        "origen_lng": -78.52,
        "destino_lat": -7.17,
        "destino_lng": -78.53,
    })

    assert response.status_code == 200
    assert response.json()["estado_algoritmo"] == "calculada"


def test_cors_rejects_origin_not_in_allowed_origins(client):
    origin = "https://cors-unlisted.invalid"
    assert origin not in settings.ALLOWED_ORIGINS

    response = client.options(
        "/health",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_cors_accepts_listed_origin(client):
    origin = settings.ALLOWED_ORIGINS[0]
    response = client.options(
        "/health",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_production_settings_require_allowed_origins():
    backend_dir = Path(__file__).resolve().parents[1]
    environment = os.environ.copy()
    environment["ENV"] = "production"
    environment["ALLOWED_ORIGINS"] = ""

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import app.core.config",
        ],
        cwd=backend_dir,
        env=environment,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "ALLOWED_ORIGINS debe configurarse cuando ENV=production." in result.stderr


ZONA = {"latitud": -7.167, "longitud": -78.51, "motivo": "INUNDACION"}


def test_zonas_bloqueadas_exigen_sesion(client):
    assert client.get("/api/v1/rescate/zonas-bloqueadas/").status_code == 401
    assert client.post("/api/v1/rescate/zonas-bloqueadas/", json=ZONA).status_code == 401


def test_ciudadano_no_puede_marcar_ni_levantar_zonas(client):
    app.dependency_overrides[get_current_user] = lambda: {
        "sub": "ciudadano-test",
        "rol": "ciudadano",
        "permisos": build_permissions_for_role("ciudadano"),
    }
    assert client.post("/api/v1/rescate/zonas-bloqueadas/", json=ZONA).status_code == 403
    assert client.delete("/api/v1/rescate/zonas-bloqueadas/1").status_code == 403
    assert client.get("/api/v1/rescate/zonas-bloqueadas/").status_code == 403


def test_zona_con_datos_invalidos_se_rechaza(client):
    app.dependency_overrides[get_current_user] = lambda: {
        "sub": "operador-test",
        "rol": "operador",
        "permisos": build_permissions_for_role("operador"),
    }
    class ServicioFalso:
        def crear_zona(self, *args, **kwargs):
            raise AssertionError("no debe llegar al servicio")
    app.dependency_overrides[get_rescue_service] = ServicioFalso
    assert client.post("/api/v1/rescate/zonas-bloqueadas/", json={**ZONA, "motivo": "LLUVIA"}).status_code == 422
    assert client.post("/api/v1/rescate/zonas-bloqueadas/", json={**ZONA, "radio_m": 50000}).status_code == 422
    assert client.post("/api/v1/rescate/zonas-bloqueadas/", json={**ZONA, "latitud": 200}).status_code == 422


def test_lluvia_exige_sesion_y_permiso_de_mapa(client):
    assert client.get("/api/v1/rescate/lluvia/").status_code == 401
    app.dependency_overrides[get_current_user] = lambda: {
        "sub": "ciudadano-test", "rol": "ciudadano", "permisos": build_permissions_for_role("ciudadano"),
    }
    assert client.get("/api/v1/rescate/lluvia/").status_code == 403


def test_lluvia_devuelve_la_respuesta_del_servicio(client):
    from app.api.deps import get_weather_service

    class ServicioFalso:
        def obtener_lluvia(self):
            return {"estado": "OK", "fuente": "prueba", "actualizado": "2026-11-10T12:00:00Z", "radio_m": 1650,
                    "puntos": [{"lat": -7.16, "lng": -78.5, "mm": 3.0, "nivel": "MODERADA"}]}

    app.dependency_overrides[get_current_user] = lambda: {
        "sub": "operador-test", "rol": "operador", "permisos": build_permissions_for_role("operador"),
    }
    app.dependency_overrides[get_weather_service] = ServicioFalso
    r = client.get("/api/v1/rescate/lluvia/")
    assert r.status_code == 200 and r.json()["puntos"][0]["nivel"] == "MODERADA"

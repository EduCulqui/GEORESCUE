"""Utilidades geográficas que no dependen del motor de base de datos."""
from math import asin, cos, radians, sin, sqrt

RADIO_TIERRA_KM = 6371.0088


def distancia_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distancia de círculo máximo (haversine) entre dos puntos WGS84, en km."""
    phi1, phi2 = radians(lat1), radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = radians(lng2 - lng1)
    a = sin(d_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(d_lambda / 2) ** 2
    return 2 * RADIO_TIERRA_KM * asin(min(1.0, sqrt(a)))


def distancia_minima_a_ruta_m(lat: float, lng: float, puntos: list) -> float:
    """Distancia mínima, en metros, de un punto a una ruta [[lat, lng], ...].

    Mide contra los tramos (no solo contra los vértices) con una proyección plana
    local, suficiente para distancias de pocos kilómetros.
    """
    if not puntos:
        return float("inf")
    metros_por_grado = 111_320.0
    escala_lng = cos(radians(lat))

    def plano(p):
        return ((p[1] - lng) * metros_por_grado * escala_lng, (p[0] - lat) * metros_por_grado)

    xy = [plano(p) for p in puntos]
    if len(xy) == 1:
        return sqrt(xy[0][0] ** 2 + xy[0][1] ** 2)
    mejor = float("inf")
    for (x1, y1), (x2, y2) in zip(xy, xy[1:]):
        dx, dy = x2 - x1, y2 - y1
        largo2 = dx * dx + dy * dy
        t = 0.0 if largo2 == 0 else max(0.0, min(1.0, -(x1 * dx + y1 * dy) / largo2))
        px, py = x1 + t * dx, y1 + t * dy
        mejor = min(mejor, sqrt(px * px + py * py))
    return mejor


def puntos_a_evitar(lat: float, lng: float, radio_m: float) -> list:
    """Puntos que se le piden al proveedor que evite para cubrir una zona circular.

    El proveedor evita puntos, no áreas: se usa el centro y, si la zona es grande,
    cuatro puntos más a mitad de radio. Después se verifica la ruta resultante.
    """
    puntos = [(lat, lng)]
    if radio_m >= 150:
        grados_lat = (radio_m * 0.5) / 111_320.0
        grados_lng = grados_lat / max(cos(radians(lat)), 0.01)
        puntos += [
            (lat + grados_lat, lng), (lat - grados_lat, lng),
            (lat, lng + grados_lng), (lat, lng - grados_lng),
        ]
    return puntos

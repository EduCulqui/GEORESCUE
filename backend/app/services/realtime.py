from typing import Dict, Set

from fastapi import WebSocket


class InstitutionalAlertHub:
    def __init__(self):
        self._connections: Dict[str, Set[WebSocket]] = {}

    def connect(self, institution: str, websocket: WebSocket) -> None:
        self._connections.setdefault(institution, set()).add(websocket)

    def disconnect(self, institution: str, websocket: WebSocket) -> None:
        connections = self._connections.get(institution)
        if not connections:
            return
        connections.discard(websocket)
        if not connections:
            self._connections.pop(institution, None)

    async def publish_alert(self, institution: str, event: dict) -> None:
        stale = []
        connections = self._connections.get(institution, set())
        for websocket in tuple(connections):
            try:
                await websocket.send_json(event)
            except Exception:
                stale.append((websocket, connections))
        for websocket, connections in stale:
            connections.discard(websocket)


institutional_alert_hub = InstitutionalAlertHub()

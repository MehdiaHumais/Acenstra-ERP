from __future__ import annotations

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str
    version: str
    environment: str
    uptime_seconds: float


class MessageResponse(BaseModel):
    message: str
    detail: str | None = None

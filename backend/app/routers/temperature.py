from __future__ import annotations

from fastapi import APIRouter

from app.domain import data

router = APIRouter(prefix="/temperature", tags=["temperature"])


@router.get("/readings")
def readings() -> list[dict]:
    return data.TEMPERATURE

from __future__ import annotations

from fastapi import APIRouter

from app.domain import data

router = APIRouter(prefix="/deliveries", tags=["deliveries"])


@router.get("")
def list_deliveries() -> list[dict]:
    return data.DELIVERIES

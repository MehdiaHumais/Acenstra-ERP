from __future__ import annotations

from fastapi import APIRouter

from app.domain import data

router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("")
def list_orders() -> list[dict]:
    return data.ORDERS

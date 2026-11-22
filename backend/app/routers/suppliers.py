from __future__ import annotations

from fastapi import APIRouter

from app.domain import data

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


@router.get("")
def list_suppliers() -> list[dict]:
    return data.SUPPLIERS

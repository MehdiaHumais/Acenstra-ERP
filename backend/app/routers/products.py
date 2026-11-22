from __future__ import annotations

from fastapi import APIRouter

from app.domain import data

router = APIRouter(prefix="/products", tags=["products"])


@router.get("")
def list_products() -> list[dict]:
    return data.PRODUCTS

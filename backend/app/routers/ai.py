from __future__ import annotations

from fastapi import APIRouter

from app.domain import data

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/insights")
def insights() -> list[dict]:
    return data.INSIGHTS

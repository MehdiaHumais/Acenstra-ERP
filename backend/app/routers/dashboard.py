from __future__ import annotations

from fastapi import APIRouter

from app.domain import data

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/overview")
def overview() -> dict:
    return {
        "kpis": data.KPIS,
        "alerts": data.ALERTS,
        "temperature": data.TEMPERATURE,
        "expiring": data.LOTS[:4],
        "tasks": data.TASKS,
        "insights": data.INSIGHTS,
        "journey": data.JOURNEY,
        "revenue_by_week": data.REVENUE,
    }

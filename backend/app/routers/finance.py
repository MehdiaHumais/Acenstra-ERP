from __future__ import annotations

from fastapi import APIRouter

from app.domain import data

router = APIRouter(prefix="/finance", tags=["finance"])


@router.get("/summary")
def finance_summary() -> dict:
    return {
        "invoices": data.INVOICES,
        "revenue_cents": 0,
        "collected_cents": 0,
        "overdue_cents": 0,
        "ap_cents": 0,
        "gross_margin_pct": 0.0,
        "sdi_pending": 0,
        "ageing": [],
    }

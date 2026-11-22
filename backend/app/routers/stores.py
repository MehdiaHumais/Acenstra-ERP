from __future__ import annotations

from fastapi import APIRouter

from app.domain import data

router = APIRouter(prefix="/stores", tags=["stores"])


@router.get("/summary")
def stores_summary() -> dict:
    total_spend = sum(store["purchases_30d_cents"] for store in data.STORES)
    total_orders = sum(store["orders_30d"] for store in data.STORES)
    avg_waste = (
        sum(store["waste_pct"] for store in data.STORES) / len(data.STORES)
        if data.STORES
        else 0.0
    )
    return {
        "stores": data.STORES,
        "total_spend_cents": total_spend,
        "total_orders": total_orders,
        "average_waste_pct": round(avg_waste, 1),
    }

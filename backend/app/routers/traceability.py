from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.domain import data

router = APIRouter(prefix="/traceability", tags=["traceability"])


@router.get("/batches/{batch_id}")
def trace_batch(batch_id: int) -> dict:
    lot = next((item for item in data.LOTS if item["id"] == batch_id), None)
    if not lot:
        raise HTTPException(status_code=404, detail="Batch not found")

    downstream: list[dict] = []
    shipped_kg = 0.0
    initial_kg = round(lot["remaining_kg"] + shipped_kg, 1)

    return {
        "batch": lot,
        "upstream": {
            "supplier": lot["supplier_name"],
            "purchase_order": f"PO-{2400 + batch_id}",
            "received_at": f"{lot['received_at']}T06:42:00+00:00",
            "initial_kg": initial_kg,
            "certificate": "Pending quality release",
        },
        "downstream": downstream,
        "mass_balance": {
            "received_kg": initial_kg,
            "shipped_kg": shipped_kg,
            "remaining_kg": lot["remaining_kg"],
            "variance_kg": round(initial_kg - shipped_kg - lot["remaining_kg"], 1),
        },
    }

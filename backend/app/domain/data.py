from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


PRODUCTS: list[dict[str, Any]] = []

SUPPLIERS: list[dict[str, Any]] = []

LOTS: list[dict[str, Any]] = []

TASKS: list[dict[str, Any]] = []

ORDERS: list[dict[str, Any]] = []

DELIVERIES: list[dict[str, Any]] = []

INVOICES: list[dict[str, Any]] = []

TEMPERATURE: list[dict[str, Any]] = []

STORES: list[dict[str, Any]] = []

INSIGHTS: list[dict[str, Any]] = []

REVENUE: list[dict[str, Any]] = []

KPIS: list[dict[str, Any]] = []

ALERTS: list[dict[str, Any]] = []

JOURNEY: list[dict[str, Any]] = [
    {
        "step": 1,
        "title": "Product master",
        "description": "SKU, catch-weight, allergens, shelf life and temperature profile.",
        "owner": "Commercial",
    },
    {
        "step": 2,
        "title": "Supplier sourcing",
        "description": "Scorecards, RFQ, PO and landed cost.",
        "owner": "Procurement",
    },
    {
        "step": 3,
        "title": "Receiving",
        "description": "Batch capture, temperature evidence and quality release.",
        "owner": "Warehouse",
    },
    {
        "step": 4,
        "title": "Quality gate",
        "description": "HACCP, hold/release, excursions and CAPA.",
        "owner": "Quality",
    },
    {
        "step": 5,
        "title": "Pick and pack",
        "description": "FEFO allocation, scan checks and labels.",
        "owner": "Warehouse",
    },
    {
        "step": 6,
        "title": "Delivery and POD",
        "description": "Routes, checks, exceptions and evidence.",
        "owner": "Transport",
    },
    {
        "step": 7,
        "title": "Finance",
        "description": "Invoices, SdI handoff and margin.",
        "owner": "Finance",
    },
]

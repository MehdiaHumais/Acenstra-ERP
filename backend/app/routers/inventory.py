from __future__ import annotations

from fastapi import APIRouter

from app.domain import data

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.get("/lots")
def list_lots() -> list[dict]:
    return data.LOTS


@router.get("/temperature/readings")
def temperature() -> list[dict]:
    return data.TEMPERATURE

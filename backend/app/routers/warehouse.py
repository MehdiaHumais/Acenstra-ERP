from __future__ import annotations

from fastapi import APIRouter

from app.domain import data

router = APIRouter(prefix="/warehouse", tags=["warehouse"])


@router.get("/tasks")
def list_tasks() -> list[dict]:
    return data.TASKS

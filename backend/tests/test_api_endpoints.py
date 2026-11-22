from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_dashboard_overview() -> None:
    response = client.get("/api/v1/dashboard/overview")
    assert response.status_code == 200
    payload = response.json()
    assert payload["kpis"] == []
    assert payload["alerts"] == []
    assert payload["temperature"] == []
    assert payload["expiring"] == []
    assert payload["tasks"] == []
    assert payload["insights"] == []
    assert payload["revenue_by_week"] == []
    assert len(payload["journey"]) >= 1


def test_products() -> None:
    response = client.get("/api/v1/products")
    assert response.status_code == 200
    assert response.json() == []


def test_suppliers() -> None:
    response = client.get("/api/v1/suppliers")
    assert response.status_code == 200
    assert response.json() == []


def test_inventory_lots() -> None:
    response = client.get("/api/v1/inventory/lots")
    assert response.status_code == 200
    assert response.json() == []


def test_warehouse_tasks() -> None:
    response = client.get("/api/v1/warehouse/tasks")
    assert response.status_code == 200
    assert response.json() == []


def test_orders() -> None:
    response = client.get("/api/v1/orders")
    assert response.status_code == 200
    assert response.json() == []


def test_deliveries() -> None:
    response = client.get("/api/v1/deliveries")
    assert response.status_code == 200
    assert response.json() == []


def test_finance_summary() -> None:
    response = client.get("/api/v1/finance/summary")
    assert response.status_code == 200
    payload = response.json()
    assert payload["invoices"] == []
    assert payload["ageing"] == []
    assert payload["revenue_cents"] == 0


def test_stores_summary() -> None:
    response = client.get("/api/v1/stores/summary")
    assert response.status_code == 200
    payload = response.json()
    assert payload["stores"] == []
    assert payload["total_orders"] == 0
    assert payload["average_waste_pct"] == 0


def test_temperature_readings() -> None:
    response = client.get("/api/v1/temperature/readings")
    assert response.status_code == 200
    assert response.json() == []


def test_ai_insights() -> None:
    response = client.get("/api/v1/ai/insights")
    assert response.status_code == 200
    assert response.json() == []


def test_traceability_missing() -> None:
    response = client.get("/api/v1/traceability/batches/1")
    assert response.status_code == 404

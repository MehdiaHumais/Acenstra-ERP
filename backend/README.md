# Ascentra Food Distribution ERP - API

FastAPI backend providing domain APIs for warehouse, traceability, procurement, delivery, finance, stores and governed AI insights. Designed to align with the revised Ascentra proposal.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Docs: http://127.0.0.1:8000/docs
Health: http://127.0.0.1:8000/health

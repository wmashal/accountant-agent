# Accountant Agent — Receipt OCR & Data Extraction Suite

Multi-tenant automated receipt processing system with two ingestion channels:

- **WhatsApp**: Customers send a receipt photo or PDF via WhatsApp and receive back structured data — no manual entry required.
- **Google Drive**: Accountant creates a customer from the dashboard → a Drive folder is auto-created → customer uploads receipts → system picks them up and auto-confirms them.

An **accountant dashboard** lets the accountant review, classify, and manage receipts per customer.
An **admin panel** lets the platform operator manage accountant accounts, view stats, and upload logos.

## Architecture

```
[Admin Panel]   → /api/admin/*           (admin JWT — env vars)
[Dashboard]     → /api/dashboard/*       (accountant JWT — DB)
[Twilio]        → /webhook               (routes by To number → accountant)
[Drive Poller]  → asyncio loop per accountant (every 30s)

Receipt pipeline:
  WhatsApp/Drive file → Gemini 2.5 Flash extraction → normalize
    → Postgres (receipts + customers, scoped by accountant_id)
    → GCS (file storage)
    → WhatsApp reply (Twilio channel only; Drive auto-confirms)
```

## GCP Deployment (production)

| Service | URL |
|---|---|
| API | https://accountant-api-v2-1002080144616.us-central1.run.app |
| Dashboard | https://accountant-dashboard-v2-1002080144616.us-central1.run.app |
| Admin Panel | https://accountant-admin-1002080144616.us-central1.run.app |
| Redis | accountant-redis (internal) |

**Database**: Cloud SQL `accountant-db` instance, database `accountant_v2` (Postgres 16)

**Secrets** (Secret Manager): `DATABASE_URL_V2`, `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `REDIS_URL`, `GEMINI_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `GCS_BUCKET_NAME`, `GOOGLE_SERVICE_ACCOUNT_FILE`

## Local Development

```bash
cp .env.example .env
# fill in API keys
docker compose up
ngrok http 8000
# set ngrok URL as Twilio webhook: https://xxxx.ngrok.io/webhook
```

Services:
- API: http://localhost:8000
- Dashboard: http://localhost:3001
- Admin: http://localhost:3002

## Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Multi-tenancy | `accountant_id` FK on all tables | Each accountant fully isolated; same DB instance |
| Auth | PyJWT (HS256) — 24h accountant, 8h admin | Stateless, no session store needed |
| Admin credentials | Env vars (Secret Manager) | No DB row; simpler rotation |
| WhatsApp routing | `To` field → `twilio_from_number` lookup | Each accountant has their own Twilio number |
| Drive polling | Per-accountant asyncio loop | No webhooks; Drive API polling sufficient |
| Multi-page PDF | `asyncio.gather()` concurrent extraction + invoice grouping | ~5-6× faster than sequential; reuses prefetched result for single-page groups |
| Primary LLM | Gemini 2.5 Flash | Price/performance for vision + structured output |
| Fallback LLM | Claude Sonnet 4.5 | Triggered on parse failure only |
| File storage | GCS (production), local disk (dev) | Cloud Run is stateless |
| Dashboard | React + Vite + TypeScript + nginx | Served as static SPA; nginx proxies `/api/` to backend |

## Repository Structure

```
app/                    FastAPI backend
  models/               SQLAlchemy ORM (Accountant, Customer, Receipt)
  routes/               admin.py, auth.py, dashboard.py, webhook.py
  pipeline/             process_receipt.py — extraction, normalize, split PDFs
  services/             db_service, drive_poller, gcs_storage, twilio_client, redis_client
  middleware/auth.py    JWT helpers + FastAPI Depends
  config.py             Pydantic Settings (reads env / Secret Manager)
dashboard/              Accountant dashboard (React + Vite)
  nginx.conf            Proxies /api/ → accountant-api-v2
admin/                  Admin panel (React + Vite)
  nginx.conf            Proxies /api/ → accountant-api-v2
```

## Documentation

| Section | Description |
|---|---|
| [Architecture Design](architecture-design.md) | System design, data flow, schema |
| [Component Breakdown](component-breakdown.md) | Code-level spec for every module |
| [Implementation Plan](implementation-plan.md) | Phase build plan, open items |

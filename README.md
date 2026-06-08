# Accountant Agent — WhatsApp Receipt OCR & Data Extraction Suite

Automated receipt processing system. Users send a receipt photo or PDF via WhatsApp and receive back structured, accounting-ready data — no manual entry required. An admin dashboard lets the accountant review, classify, and manage all receipts per customer.

## Architecture at a Glance

```
WhatsApp → Twilio → FastAPI → BackgroundTask
                                    ↓
                       LlamaParse (PDF) / Gemini Vision (Image)
                                    ↓
                       Gemini 2.5 Flash extraction → normalize
                                    ↓
                       Local disk storage (/app/receipts/)
                       Postgres (receipts + customers)
                                    ↓
                       WhatsApp reply → user confirms or rejects
                                    ↓
                       React Dashboard → accountant classifies income/expense
```

## Quick Start (Docs)

```bash
cd accountant-agent
npm i docsify-cli -g
docsify serve .
```

Open http://localhost:3000

## Quick Start (App)

```bash
cp .env.example .env
# fill in your API keys in .env
docker compose up
ngrok http 8000
# set ngrok URL as Twilio webhook: https://xxxx.ngrok.io/webhook
```

Services exposed:
- API: http://localhost:8000
- Dashboard: http://localhost:3001
- Postgres: internal only (no host port)
- Redis: http://localhost:6379

---

## Documentation

| Section | Description |
|---|---|
| [Architecture Design](architecture-design.md) | System design, data flow, multilanguage support, data schema |
| [Component Breakdown](component-breakdown.md) | Code-level spec for every service, task, and module |
| [Implementation Plan](implementation-plan.md) | Phase build plan, credentials checklist, open items |

## Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Orchestration | FastAPI BackgroundTasks + Redis | No broker needed, simpler stack |
| OCR for PDFs | LlamaParse (invoice preset) → fallback Gemini Vision | Best table/invoice extraction; free tier times out gracefully |
| OCR for Images | Gemini Vision direct | Single API call, lower latency |
| Primary LLM | Gemini 2.5 Flash | Price/performance for vision + structured output |
| Fallback LLM | Claude Sonnet 4.5 | Triggered on parse failure only |
| Database | Postgres (SQLAlchemy async + asyncpg) | Structured queries, per-customer reporting |
| File Storage | Local disk with Docker volume + FastAPI StaticFiles | Simple, no cloud dependencies for POC |
| Dashboard | React + Vite + TypeScript + nginx | Modern UI, served on port 3001 |

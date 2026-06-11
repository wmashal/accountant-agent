# Implementation Plan

## Overview

The system is built and operational. The phases below track what was built (✅) and what remains (⬜).

---

## Phase 1 — Local Skeleton ✅ Complete

| # | Task | Status |
|---|---|---|
| 1.1 | `docker-compose.yml` with `api`, `redis`, `postgres`, `dashboard` | ✅ |
| 1.2 | `Dockerfile` (Python 3.12, FastAPI, uvicorn) | ✅ |
| 1.3 | `app/main.py` with FastAPI app and `/health` endpoint | ✅ |
| 1.4 | `app/routes/webhook.py` — accept POST, return 200 | ✅ |
| 1.5 | `app/services/redis_client.py` — connect to Redis | ✅ |
| 1.6 | `.env.example` with all required variables | ✅ |
| 1.7 | ngrok + Twilio sandbox webhook pointed at `/webhook` | ✅ |

---

## Phase 2 — Image Receipt Extraction ✅ Complete

| # | Task | Status |
|---|---|---|
| 2.1 | Twilio signature validation (skipped in dev env) | ✅ |
| 2.2 | `fetch_media()` — download file bytes (handles 307 Twilio → CDN redirect) | ✅ |
| 2.3 | `app/services/gemini_client.py` — vision extraction | ✅ |
| 2.4 | Extraction prompt (multilingual, returns strict JSON) | ✅ |
| 2.5 | `app/pipeline/normalize.py` — date, ABN, GST, currency normalization | ✅ |
| 2.6 | `app/models/receipt.py` — `ReceiptData` dataclass + ORM models | ✅ |
| 2.7 | `app/services/db_service.py` — Postgres upsert | ✅ |
| 2.8 | `process_receipt` background task wired for image path | ✅ |
| 2.9 | WhatsApp reply with extracted data summary | ✅ |
| 2.10 | Tested with real receipts (Hebrew ILS, image JPEG) | ✅ |

---

## Phase 3 — PDF Support ✅ Complete

| # | Task | Status |
|---|---|---|
| 3.1 | PDFs sent directly to Gemini Vision (application/pdf mime) | ✅ |
| 3.2 | Gemini retries 3x with backoff on 5xx errors | ✅ |
| 3.3 | Multi-page PDF splitting via pypdf (`PdfReader` + `PdfWriter` per page) | ✅ |
| 3.4 | `extraction_model` field stored in Postgres | ✅ |
| 3.5 | Tested with Hebrew PDF invoices | ✅ |

---

## Phase 4 — Storage + Confirmation ✅ Complete

| # | Task | Status |
|---|---|---|
| 4.1 | `is_valid()` check on LLM output (vendor + cost required) | ✅ |
| 4.2 | Local disk file storage (`app/services/local_storage.py`) | ✅ |
| 4.3 | File URL stored in Postgres `receipts.file_url` | ✅ |
| 4.4 | Confirmation via Redis `pending:<from>` → JSON list of SIDs | ✅ |
| 4.5 | Handle `confirm` / `reject` — bulk-update all pending SIDs | ✅ |
| 4.6 | Auto-confirm after 5 minutes if user doesn't reply | ✅ |
| 4.9 | Full round-trip tested | ✅ |

---

## Phase 5 — Admin Dashboard ✅ Complete

| # | Task | Status |
|---|---|---|
| 5.1 | Postgres schema: `customers` + `receipts` tables | ✅ |
| 5.2 | `app/routes/dashboard.py` — REST API for customers + receipts | ✅ |
| 5.3 | React + Vite + TypeScript dashboard in `dashboard/` | ✅ |
| 5.4 | Two-panel layout: customer sidebar + receipt table | ✅ |
| 5.5 | Toggle income / expense per receipt (click type badge) | ✅ |
| 5.6 | Inline edit all receipt fields (vendor, cost, tax, date, ABN, type, status) | ✅ |
| 5.7 | Summary cards: total income, expense, net per customer | ✅ |
| 5.8 | nginx reverse proxy `/api/` and `/files/` → FastAPI | ✅ |
| 5.9 | File preview modal (image or PDF inline) | ✅ |
| 5.10 | Search sidebar by name, phone, company name, company ID | ✅ |

---

## Phase 6 — Registration + Multi-File ✅ Complete

| # | Task | Status |
|---|---|---|
| 6.1 | Registration state machine (Redis `reg:<from>`) — 2-step flow | ✅ |
| 6.2 | Media queued during registration, processed on completion | ✅ |
| 6.3 | `company_name` + `company_id` fields on Customer model | ✅ |
| 6.4 | Dashboard: show company name + ID in sidebar and header | ✅ |
| 6.5 | Dashboard: edit customer profile (name + company + ID) | ✅ |
| 6.6 | Multi-file support: each Twilio webhook call appends to batch | ✅ |
| 6.7 | Batch counter (`processing:<from>`) + 15s settle logic | ✅ |
| 6.8 | Single confirm prompt after all receipts in batch processed | ✅ |

---

## Phase 7 — Google Drive Integration ✅ Complete

| # | Task | Status |
|---|---|---|
| 7.1 | `drive_folder_id` + `source` columns on `customers`; `drive_file_id` on `receipts` | ✅ |
| 7.2 | `google_drive.py`: `create_customer_folder()`, `list_folder_files()`, `download_file()`, `move_to_processed()` | ✅ |
| 7.3 | `drive_poller.py`: asyncio background loop, polls all customers with `drive_folder_id` every 30s | ✅ |
| 7.4 | `process_single_receipt_from_drive()`: same extract/normalize pipeline, auto-confirms, no Twilio | ✅ |
| 7.5 | `db_service.py`: `create_customer()`, `get_processed_drive_file_ids()`, `upsert_receipt_from_drive()` | ✅ |
| 7.6 | `POST /api/dashboard/customers` — creates customer + Drive folder, returns share link | ✅ |
| 7.7 | Dashboard: "+ Add Customer" modal form (name, company, ID, phone optional) | ✅ |
| 7.8 | Dashboard: source badges (📱/📁) per customer in sidebar and header | ✅ |
| 7.9 | Dashboard: Drive folder link in customer header; Drive file link in receipt table | ✅ |
| 7.10 | Drive-only customers use `drive_{uuid}` placeholder phone for DB uniqueness | ✅ |
| 7.11 | Multi-page PDF from Drive split into individual receipt rows (same pypdf logic) | ✅ |
| 7.12 | Poller started in `app/main.py` lifespan (conditional on `GOOGLE_DRIVE_FOLDER_ID`) | ✅ |
| 7.13 | `DRIVE_POLL_INTERVAL_SECONDS` env var (default 30) | ✅ |
| 7.14 | End-to-end tested: 3-page PDF + JPG + single-page PDF → 5 confirmed receipts | ✅ |

---

## Phase 8 — GCP Deployment ✅ Complete

See [`deploy-gcp.md`](deploy-gcp.md) for full setup instructions.

| # | Task | Status |
|---|---|---|
| 8.1 | Cloud SQL (Postgres 16) on private VPC with VPC connector | ✅ |
| 8.2 | GCS bucket for receipt file storage | ✅ |
| 8.3 | All secrets stored in Secret Manager | ✅ |
| 8.4 | Service account with Cloud SQL, GCS, Secret Manager roles | ✅ |
| 8.5 | API deployed to Cloud Run (`accountant-api`) | ✅ |
| 8.6 | Dashboard deployed to Cloud Run (`accountant-dashboard`) | ✅ |
| 8.7 | DB migrations run (Drive columns + default_currency + receipt_number) | ✅ |
| 8.8 | Drive poller confirmed running in Cloud Run (removed `--reload` flag) | ✅ |

---

## Phase 9 — Dashboard Enhancements ✅ Complete

| # | Task | Status |
|---|---|---|
| 9.1 | Default currency per customer (ILS/USD) — used for all receipts | ✅ |
| 9.2 | Income auto-detection: check `payer` + `vendor` fields for customer company_id/name | ✅ |
| 9.3 | `payer` field added to extraction prompt (Hebrew fields: לכבוד, מקור) | ✅ |
| 9.4 | `receipt_number` extracted and shown in dashboard table | ✅ |
| 9.5 | All/Income/Expense filter tabs with counts | ✅ |
| 9.6 | Receipts grouped by YYYY-MM with collapsible sections + monthly totals | ✅ |
| 9.7 | Move button (toggle income↔expense) | ✅ |
| 9.8 | Delete button — removes DB row + GCS file + moves Drive file to `deleted/` subfolder | ✅ |
| 9.9 | Drive processed folder: `processed/YYYY-MM/` subfolders based on receipt date | ✅ |

---

## Phase 10 — Hardening ⬜ Pending

| # | Task | Priority |
|---|---|---|
## Phase 10 — Hardening ⬜ Pending

| # | Task | Priority |
|---|---|---|
| 10.1 | Idempotency: confirm Twilio retry dedup works end-to-end | High |
| 10.2 | Unit tests: normalize, ABN validator, extraction prompt | Medium |
| 10.3 | Integration test with mock Twilio webhook payload | Medium |
| 10.4 | Cron: auto-expire `pending_confirmation` rows older than 7 days | Low |
| 10.5 | Test with degraded images (dark, skewed, crumpled) | Low |
| 10.6 | Export receipts to CSV / Excel from dashboard | Low |

---

## Phase 11 — Multi-Tenant Admin Panel ✅ Complete

| # | Task | Status |
|---|---|---|
| 11.1 | `accountants` table: username, password_hash, display_name, company_name, logo_url, email, twilio_from_number, gemini_api_key, default_currency, is_active | ✅ |
| 11.2 | JWT auth: accountant login + admin login (separate credentials) | ✅ |
| 11.3 | Admin panel (React + Vite) — list, create, edit, deactivate accountants | ✅ |
| 11.4 | Per-accountant Twilio number, Gemini key, Drive folder, currency | ✅ |
| 11.5 | All customers and receipts scoped to `accountant_id` | ✅ |
| 11.6 | Logo upload per accountant (stored in GCS) | ✅ |
| 11.7 | Admin panel deployed as separate Cloud Run service | ✅ |

---

## Phase 12 — Dashboard UX Improvements ✅ Complete

| # | Task | Status |
|---|---|---|
| 12.1 | Resizable table columns (drag handle on each header) | ✅ |
| 12.2 | SVG icons replacing Unicode characters for cross-browser reliability | ✅ |
| 12.3 | Sticky actions column (always visible when scrolling horizontally) | ✅ |
| 12.4 | Eye/view icon moved into actions cell alongside move/edit/delete | ✅ |
| 12.5 | Group By filter: upload month or invoice month | ✅ |
| 12.6 | Upload Date column in table | ✅ |
| 12.7 | Receipt number column in table | ✅ |
| 12.8 | Refresh button on customer header | ✅ |

---

## Phase 13 — Arabic / English i18n + RTL ✅ Complete

| # | Task | Status |
|---|---|---|
| 13.1 | `default_language` column on `accountants` table (VARCHAR 10, default `en`) | ✅ |
| 13.2 | `language` field returned in login response | ✅ |
| 13.3 | Admin panel: language select (English / Arabic) on create + edit accountant | ✅ |
| 13.4 | `dashboard/src/i18n/en.ts` — ~130 English translation keys | ✅ |
| 13.5 | `dashboard/src/i18n/ar.ts` — full Arabic translation | ✅ |
| 13.6 | `LangContext` + `useLang` hook — no external i18n library | ✅ |
| 13.7 | Lang persisted in `localStorage`; initialized from login response | ✅ |
| 13.8 | `document.documentElement.dir = 'rtl'` on Arabic switch | ✅ |
| 13.9 | RTL CSS overrides (`[dir="rtl"]`) for sidebar, table, actions column | ✅ |
| 13.10 | EN / عربي language switcher in sidebar footer | ✅ |

---

## Phase 14 — Export CSV + Profile Refresh ✅ Complete

| # | Task | Status |
|---|---|---|
| 14.1 | Export CSV button in filter bar — exports filtered receipts as flat CSV | ✅ |
| 14.2 | CSV respects all active filters (type, invoice month, upload month, supplier) | ✅ |
| 14.3 | `GET /api/auth/me` endpoint — returns fresh accountant profile from DB | ✅ |
| 14.4 | Dashboard fetches `/me` on mount — picks up admin name changes without re-login | ✅ |
| 14.5 | Sidebar shows `displayName` before `companyName` (priority fix) | ✅ |

---

## Database Schema

See [`deploy-gcp.md` — DB Schema & All Migrations](deploy-gcp.md#db-schema--all-migrations) for the full schema and all SQL statements.

### `accountants`
| Column | Type | Notes |
|--------|------|-------|
| `id` | PK int | |
| `username` | VARCHAR(100) | unique, indexed |
| `password_hash` | VARCHAR(255) | bcrypt |
| `display_name` | VARCHAR(200) | nullable |
| `company_name` | VARCHAR(200) | nullable |
| `logo_url` | VARCHAR(500) | nullable, GCS URL |
| `email` | VARCHAR(200) | nullable |
| `google_drive_root_folder_id` | VARCHAR(200) | nullable |
| `twilio_from_number` | VARCHAR(50) | nullable, indexed |
| `gemini_api_key` | VARCHAR(200) | nullable |
| `default_currency` | VARCHAR(10) | default `USD` |
| `default_language` | VARCHAR(10) | default `en` |
| `is_active` | BOOLEAN | default `true` |
| `created_at` | TIMESTAMPTZ | |

### `customers`
| Column | Type | Notes |
|--------|------|-------|
| `id` | PK int | |
| `phone_number` | VARCHAR(50) | indexed; Drive customers use `drive_{uuid}` |
| `display_name` | VARCHAR(200) | nullable |
| `company_name` | VARCHAR(200) | nullable |
| `company_id` | VARCHAR(100) | nullable (tax ID) |
| `drive_folder_id` | VARCHAR(200) | nullable |
| `source` | VARCHAR(20) | `whatsapp` or `drive` |
| `default_currency` | VARCHAR(10) | default `USD` |
| `accountant_id` | FK → accountants | indexed |
| `created_at` | TIMESTAMPTZ | |
| **UNIQUE** | `(phone_number, accountant_id)` | |

### `receipts`
| Column | Type | Notes |
|--------|------|-------|
| `id` | PK int | |
| `message_sid` | VARCHAR(100) | unique, indexed |
| `customer_id` | FK → customers | indexed |
| `phone_number` | VARCHAR(50) | indexed |
| `vendor` | VARCHAR(300) | nullable |
| `cost` | FLOAT | nullable |
| `tax` | FLOAT | nullable |
| `tax_rate` | FLOAT | nullable (e.g. 0.17) |
| `currency` | VARCHAR(10) | default `AUD` |
| `date` | VARCHAR(20) | nullable, as printed on invoice |
| `receipt_number` | VARCHAR(100) | nullable |
| `receipt_language` | VARCHAR(20) | BCP-47 code, default `unknown` |
| `extraction_model` | VARCHAR(50) | Gemini model used |
| `upload_date` | TIMESTAMPTZ | nullable |
| `transaction_type` | VARCHAR(20) | `income` or `expense` |
| `status` | VARCHAR(30) | `processing` / `pending_confirmation` / `confirmed` / `rejected` / `error` |
| `file_url` | VARCHAR(500) | nullable, GCS URL |
| `drive_file_id` | VARCHAR(200) | nullable, indexed |
| `accountant_id` | FK → accountants | indexed |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | auto-updated on change |

---

## Required Credentials

| Service | What You Need | Where |
|---|---|---|
| Twilio | Account SID, Auth Token, WhatsApp number | console.twilio.com |
| Gemini | API key | aistudio.google.com |
| Google Cloud | Project, service account with Cloud Run + SQL + Redis + GCS roles | console.cloud.google.com |

---

## Open Items

| # | Item | Priority |
|---|---|---|
| OI-1 | Twilio interactive button template for confirm/reject (requires WhatsApp Business approval) | Medium |

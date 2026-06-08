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
| 3.2 | `ocr.py` — LlamaParse stub present but bypassed (consistently times out on free tier) | ✅ |
| 3.3 | Gemini retries 3x with backoff on 5xx errors | ✅ |
| 3.4 | Multi-page PDF splitting via pypdf (`PdfReader` + `PdfWriter` per page) | ✅ |
| 3.5 | `extraction_model` field stored in Postgres | ✅ |
| 3.6 | Tested with Hebrew PDF invoices | ✅ |

---

## Phase 4 — Claude Fallback + Storage + Confirmation ✅ Complete

| # | Task | Status |
|---|---|---|
| 4.1 | `is_valid()` check on LLM output (vendor + cost required) | ✅ |
| 4.2 | `app/services/claude_client.py` — Anthropic API fallback (images only) | ✅ |
| 4.3 | Fallback: invalid Gemini output → Claude retry for images | ✅ |
| 4.4 | Local disk file storage (`app/services/local_storage.py`) | ✅ |
| 4.5 | File URL stored in Postgres `receipts.file_url` | ✅ |
| 4.6 | Confirmation via Redis `pending:<from>` → JSON list of SIDs | ✅ |
| 4.7 | Handle `confirm` / `reject` — bulk-update all pending SIDs | ✅ |
| 4.8 | Auto-confirm after 5 minutes if user doesn't reply | ✅ |
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

## Phase 8 — GCP Deployment ⬜ Planned

See [`deploy-gcp.md`](deploy-gcp.md) for full setup instructions.

| # | Task | Status |
|---|---|---|
| 8.1 | Build and push API image to Artifact Registry | ⬜ |
| 8.2 | Build and push Dashboard image to Artifact Registry | ⬜ |
| 8.3 | Provision Cloud SQL (Postgres 16) | ⬜ |
| 8.4 | Provision Memorystore for Redis | ⬜ |
| 8.5 | Create GCS bucket for receipt file storage | ⬜ |
| 8.6 | Deploy API to Cloud Run | ⬜ |
| 8.7 | Deploy Dashboard to Cloud Run | ⬜ |
| 8.8 | Store all secrets in Secret Manager | ⬜ |
| 8.9 | Update Twilio webhook URL to Cloud Run API URL | ⬜ |
| 8.10 | Run DB migration (ALTER TABLE for Drive columns) | ⬜ |

---

## Phase 9 — Hardening ⬜ Pending

| # | Task | Priority |
|---|---|---|
| 9.1 | Idempotency: confirm Twilio retry dedup works end-to-end | High |
| 9.2 | Unit tests: normalize, ABN validator, extraction prompt | Medium |
| 9.3 | Integration test with mock Twilio webhook payload | Medium |
| 9.4 | Cron: auto-expire `pending_confirmation` rows older than 7 days | Low |
| 9.5 | Test with degraded images (dark, skewed, crumpled) | Low |
| 9.6 | Export receipts to CSV / Excel from dashboard | Low |

---

## Required Credentials

| Service | What You Need | Where |
|---|---|---|
| Twilio | Account SID, Auth Token, WhatsApp number | console.twilio.com |
| Gemini | API key | aistudio.google.com |
| Anthropic | API key (Claude Sonnet fallback) | console.anthropic.com |
| LlamaParse | API key (present in config, pipeline bypasses it) | cloud.llamaindex.ai |
| Google Cloud | Project, service account with Cloud Run + SQL + Redis + GCS roles | console.cloud.google.com |

---

## Open Items

| # | Item | Priority |
|---|---|---|
| OI-1 | Production file storage: migrate from local Docker volume to GCS for Cloud Run | High (required for GCP) |
| OI-2 | Twilio interactive button template for confirm/reject (requires WhatsApp Business approval) | Medium |
| OI-3 | Multi-currency `$` ambiguity for non-AU receipts | Low |
| OI-4 | Export receipts to CSV / Excel from dashboard | Low |

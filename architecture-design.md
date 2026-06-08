# Architecture Design

## Overview

Two receipt ingestion channels feed the same Postgres database and React dashboard:

1. **WhatsApp (Twilio)** — Event-driven pipeline triggered by an inbound WhatsApp message. A thin FastAPI service receives the webhook, fires a background task via `BackgroundTasks`, and returns HTTP 200 immediately. Redis manages state for registration, batch tracking, and confirmation.

2. **Google Drive** — Accountant creates a customer from the dashboard; the system auto-creates a Drive folder. An asyncio background poller runs every 30 seconds, picks up new files, extracts data, and auto-confirms receipts (no user reply needed).

Postgres stores all structured receipt data. A React dashboard allows the accountant to classify and review receipts from both channels per customer.

---

## System Context

```mermaid
flowchart TD
    User([User — WhatsApp]) -->|Receipt photo or PDF| Twilio
    Twilio -->|POST /webhook| API[FastAPI Service :8000]
    API -->|Registration + batch state| Redis[(Redis)]
    API -->|Fire background task| BG[BackgroundTask]
    BG -->|Extract + normalize| BG
    BG -->|Save file| Disk[(Local Disk\n/app/receipts/)]
    BG -->|Upsert row| PG[(Postgres\nreceipts + customers)]
    BG -->|Send receipt summary| Twilio
    BG -->|Send confirm prompt\nafter all receipts done| Twilio
    Twilio -->|Summary messages| User
    Twilio -->|Single confirm prompt| User
    User -->|confirm / reject| Twilio
    Twilio -->|POST /webhook| API
    API -->|Lookup pending SIDs| Redis
    API -->|Bulk update status| PG
    Accountant([Accountant]) -->|Create customer| Dashboard[React Dashboard :3001]
    Accountant -->|View + classify| Dashboard
    Dashboard -->|REST API| API
    API -->|Create Drive folder| Drive[(Google Drive)]
    API -->|Query| PG
    DrivePoller[Drive Poller\nasyncio every 30s] -->|List + download files| Drive
    DrivePoller -->|Extract + auto-confirm| PG
    DrivePoller -->|Move to processed/| Drive
```

---

## Local Development Stack

```mermaid
flowchart LR
    subgraph Local Machine
        ngrok -->|tunnel| API[FastAPI :8000]
        API --> Redis[(Redis :6379)]
        API --> PG[(Postgres :5432\ninternal only)]
        API --> Disk[(receipts_data\nDocker volume)]
        Dashboard[React :3001] -->|nginx proxy /api/ + /files/| API
    end
    Twilio -->|HTTPS webhook| ngrok
```

All services run via a single `docker compose up` — `api`, `redis`, `postgres`, `dashboard`. ngrok exposes `localhost:8000` to Twilio.

---

## Registration Flow

New users must register before receipts are processed. The state machine lives in Redis.

```mermaid
sequenceDiagram
    participant U as User (WhatsApp)
    participant T as Twilio
    participant A as FastAPI
    participant R as Redis

    U->>T: Send receipt (first ever message)
    T->>A: POST /webhook (media)
    A->>R: Store pending_media + set reg:{from}=awaiting_name
    A->>T: "What is your full name or company name?"
    T->>U: Deliver

    U->>T: "وائل مشعل"
    T->>A: POST /webhook (text)
    A->>R: Save name, set step=awaiting_id
    A->>T: "What is your company ID? (or reply skip)"
    T->>U: Deliver

    U->>T: "12345"
    T->>A: POST /webhook (text)
    A->>R: Delete reg key
    A->>A: Save profile to Postgres
    A->>T: "All set! Processing your receipts..."
    A->>A: Fire background tasks for all queued media
```

**Redis keys used:**
- `reg:<from_number>` — JSON `{step, name}` — 1h TTL
- `pending_media:<from_number>` — JSON list of queued files — 1h TTL

Files sent during registration are queued and processed after registration completes.

---

## Multi-File Batch Flow

Twilio sends each file attachment as a **separate webhook POST**. The system accumulates all SIDs and sends one confirmation prompt after all processing is done.

```mermaid
sequenceDiagram
    participant T as Twilio
    participant A as FastAPI
    participant R as Redis
    participant B as BackgroundTask

    T->>A: POST /webhook (file 1 — PDF)
    A->>R: INCRBY processing:{from} 1
    A->>R: Append SID to pending:{from}
    A->>B: add_task(process_receipt, sid_1)

    T->>A: POST /webhook (file 2 — JPEG)
    A->>R: INCRBY processing:{from} 1
    A->>R: Append SID to pending:{from}
    A->>B: add_task(process_receipt, sid_2)

    B->>B: process sid_1 → DECR counter → schedule _maybe_send_confirm
    B->>B: process sid_2 → DECR counter → schedule _maybe_send_confirm

    Note over B: After 15s settle: counter=0, send ONE confirm prompt
    B->>T: "All done! 2 receipts processed. Reply confirm or reject"

    Note over B: After 5min with no reply: auto-confirm
    B->>B: Auto-confirm all pending SIDs
```

---

## End-to-End Receipt Processing Sequence

```mermaid
sequenceDiagram
    participant U as User (WhatsApp)
    participant T as Twilio
    participant A as FastAPI
    participant R as Redis
    participant B as BackgroundTask
    participant G as Gemini 2.5 Flash
    participant C as Claude Sonnet (fallback)
    participant D as Local Disk
    participant P as Postgres

    U->>T: Send receipt (image or PDF)
    T->>A: POST /webhook
    A->>A: Validate Twilio signature
    A->>R: INCRBY processing:{from}, append to pending:{from}
    A->>B: background_tasks.add_task(process_receipt, ...)
    A-->>T: HTTP 200 (immediate)

    B->>T: Fetch media bytes (auth → 307 CDN redirect)

    alt ContentType = application/pdf
        B->>G: Send PDF bytes as inline data (application/pdf mime)
        G-->>B: JSON extraction result
        note over B,G: Gemini retries up to 3x with backoff on 5xx errors
    else ContentType = image/*
        B->>G: Send image bytes (vision)
        G-->>B: JSON extraction result
        alt Gemini fails all retries
            B->>C: Claude Sonnet fallback (images only)
            C-->>B: JSON extraction result
        end
    end

    B->>B: Normalize data (date, ABN, GST, currency, language)
    B->>D: Save file to /app/receipts/{phone}/{YYYY-MM}/{sid}.ext
    D-->>B: file_url
    B->>P: Upsert customer + receipt row (status=pending_confirmation)
    B->>T: Send receipt summary (no confirm prompt)
    B->>R: DECR processing:{from}

    Note over B: After 15s settle, if counter=0:
    B->>T: "All done! N receipts. Reply confirm or reject"

    U->>T: "confirm"
    T->>A: POST /webhook (Body=confirm)
    A->>R: GET pending:{from} → list of SIDs
    A->>P: Bulk update all SIDs → status=confirmed
    A->>R: DELETE pending:{from}
    A-->>T: HTTP 200
```

---

## Google Drive Ingestion Flow

```mermaid
sequenceDiagram
    participant A as Accountant (Dashboard)
    participant API as FastAPI
    participant PG as Postgres
    participant Drive as Google Drive
    participant Poller as Drive Poller (asyncio)
    participant G as Gemini 2.5 Flash

    A->>API: POST /api/dashboard/customers (name, company, id)
    API->>Drive: create_customer_folder() → Receipts/Name_ID/
    Drive-->>API: folder_id + share_link
    API->>PG: INSERT customer (drive_folder_id, source=drive)
    API-->>A: CustomerSummary with share link

    Note over A: Accountant shares Drive link with customer

    loop Every 30s
        Poller->>PG: Fetch customers with drive_folder_id
        Poller->>Drive: list_folder_files(folder_id)
        Drive-->>Poller: [{id, name, mimeType}]
        Poller->>PG: get_processed_drive_file_ids() — dedup
        Poller->>Drive: download_file(file_id)
        Drive-->>Poller: (bytes, content_type)
        Poller->>G: extract(bytes, content_type)
        G-->>Poller: JSON extraction
        Poller->>Poller: normalize()
        Poller->>PG: upsert_receipt_from_drive() (status=confirmed)
        Poller->>Drive: move_to_processed(file_id) → processed/ subfolder
    end
```

**Key differences from WhatsApp:**
- No Twilio, no Redis counter, no confirmation step
- `status` is set directly to `confirmed`
- `drive_file_id` stored in DB for idempotency (poller deduplicates on each cycle)
- Multi-page PDFs split into individual pages, each stored as a separate receipt row
- Processed files moved to `processed/` subfolder in the customer's Drive folder

---

## Job State Machine

```mermaid
stateDiagram-v2
    [*] --> processing: receipt row created
    processing --> pending_confirmation: extraction + reply sent
    pending_confirmation --> confirmed: user replies confirm (or auto-confirm after 5min)
    pending_confirmation --> rejected: user replies reject
    pending_confirmation --> expired: pending:{from} Redis key expires (30min)
    [*] --> error: unrecoverable extraction failure
```

Status stored in `receipts.status` column. Redis `pending:<from_number>` holds the list of SIDs awaiting confirmation (30-minute TTL as safety net; actively deleted on confirm/reject).

---

## MIME-Type Routing

```mermaid
flowchart LR
    A[MediaContentType] --> B{Type?}
    B -- application/pdf --> D[Gemini Vision\napplication/pdf inline]
    B -- image/jpeg\nimage/png\nimage/webp --> E[Gemini Vision\nimage inline]

    D -->|retry 3x on 5xx| D
    E -->|retry 3x on 5xx| E
    E -->|all retries failed| F[Claude Sonnet fallback\nimages only]

    D --> G[Normalization]
    E --> G
    F --> G
```

> **Note:** LlamaParse is present in `ocr.py` but is not used in the active pipeline — it consistently times out on the free tier. PDFs go directly to Gemini Vision which natively supports `application/pdf` as an inline data mime type.

---

## Data Schema

### Postgres Tables

#### `customers`

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | Auto-increment |
| `phone_number` | String unique | WhatsApp number or `drive_{uuid}` placeholder for Drive-only customers |
| `display_name` | String nullable | Set during registration or via dashboard |
| `company_name` | String nullable | Set during registration or via dashboard |
| `company_id` | String nullable | Company registration number |
| `drive_folder_id` | String nullable | Google Drive folder ID for this customer |
| `source` | String | `whatsapp` \| `drive` \| `both` |
| `default_currency` | String | `ILS` or `USD` — always applied to receipts, overrides AI-extracted currency |
| `created_at` | DateTime | UTC |

#### `receipts`

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | Auto-increment |
| `message_sid` | String unique | Twilio MessageSid — idempotency key |
| `customer_id` | FK → customers | |
| `phone_number` | String | Denormalized for fast lookup |
| `vendor` | String nullable | Normalized vendor name |
| `cost` | Float nullable | Total amount inc. tax |
| `tax` | Float nullable | GST/tax line amount |
| `currency` | String | ISO 4217 (AUD, ILS, USD, etc.) |
| `date` | String nullable | YYYY-MM-DD |
| `abn` | String nullable | 11-digit ABN, validated |
| `receipt_language` | String nullable | BCP 47 (e.g. `en`, `he`, `ar`) |
| `extraction_model` | String nullable | `gemini-2.5-flash` or `claude-sonnet-4-5` |
| `transaction_type` | String | `income` or `expense` — default `expense` |
| `status` | String | `processing`, `pending_confirmation`, `confirmed`, `rejected`, `error` |
| `file_url` | String nullable | `/files/{phone}/{YYYY-MM}/{sid}.ext` |
| `receipt_number` | String nullable | Invoice/receipt number extracted from document |
| `drive_file_id` | String nullable | Google Drive file ID — idempotency key for Drive receipts |
| `created_at` | DateTime | UTC |
| `updated_at` | DateTime | UTC, auto-updated |

### Redis Keys

| Key Pattern | Value | TTL |
|---|---|---|
| `reg:<from_number>` | JSON `{step, name}` — registration state machine | 1h |
| `pending_media:<from_number>` | JSON list of `{message_sid, media_url, content_type}` | 1h |
| `pending:<from_number>` | JSON list of SIDs awaiting confirmation | 30min |
| `processing:<from_number>` | Integer batch counter (decremented as jobs finish) | 30min |

### File Storage Layout

```
/app/receipts/                        ← Docker volume: receipts_data
└── {safe_phone}/                     ← phone without whatsapp: prefix and +
    └── {YYYY-MM}/
        └── {message_sid}.{ext}       ← ext: pdf, jpg, png, webp
```

Served by FastAPI `StaticFiles` at `/files/` — e.g. `http://localhost:8000/files/972524871170/2026-06/SM123.jpg`

---

## Dashboard API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/dashboard/customers` | All customers with receipt counts, income/expense totals, `drive_folder_id`, `source` |
| `POST` | `/api/dashboard/customers` | Create customer; auto-creates Drive folder if `GOOGLE_DRIVE_FOLDER_ID` set |
| `GET` | `/api/dashboard/customers/{id}/receipts` | All receipts for a customer |
| `PATCH` | `/api/dashboard/receipts/{id}` | Update any receipt fields (vendor, cost, tax, currency, date, abn, receipt_number, type, status) |
| `DELETE` | `/api/dashboard/receipts/{id}` | Delete receipt — removes DB row, GCS file, and moves Drive file to `deleted/` subfolder |
| `PATCH` | `/api/dashboard/customers/{id}/profile` | Update display_name, company_name, company_id, phone_number, default_currency |
| `PATCH` | `/api/dashboard/customers/{id}/name` | Update display name only (legacy) |

Dashboard served at http://localhost:3001. The nginx container proxies `/api/` and `/files/` → `http://api:8000`.

---

## Multilanguage Support

Receipts may be in any language. Confirmed working: Hebrew (ILS receipts from Israel).

| Script | Examples | Handled by |
|---|---|---|
| Latin | English, French, Spanish | Gemini Vision |
| Arabic / Hebrew (RTL) | Arabic, Hebrew | Gemini Vision |
| CJK | Chinese, Japanese, Korean | Gemini Vision |

Gemini detects the language, returns a BCP 47 code, and normalizes all values to English/ISO formats.

---

## Normalization Rules

### Date
- Accept any format (DD/MM/YYYY, ISO 8601, "Jan 3 2024", etc.)
- Output: `YYYY-MM-DD` via `python-dateutil`
- On parse failure: store raw string

### ABN (Australian Business Number)
- Strip all non-digit characters
- Must be exactly 11 digits
- Validate using ATO checksum (weights: 10,1,3,5,7,9,11,13,15,17,19)

### GST Logic (Australian)

| Scenario | Rule |
|---|---|
| Tax line present on receipt | Use extracted value directly |
| "GST included" but no tax line | `tax = round(cost / 11, 2)` |
| No tax info found | `tax = None` |

### Currency
- Always use the customer's `default_currency` — AI-extracted currency is ignored
- Customer default is set at creation (`ILS` or `USD`) and editable from the dashboard

---

## Error Handling

| Failure | Behaviour |
|---|---|
| Gemini 5xx / rate limit | Retry up to 3x with 3s, 6s backoff |
| Gemini JSON invalid | Skip to Claude fallback (images only) |
| Claude also fails | `status = error`, send error WhatsApp message |
| File save fails | Non-fatal — `file_url` stored as `None`, processing continues |
| Postgres write fails | Error logged, user receives error WhatsApp message |
| User never confirms | Auto-confirm after 5 minutes; `pending:{from}` Redis key also expires after 30min |
| LlamaParse timeout | Not used in active pipeline; code present but bypassed |

---

## Security

| Concern | Mitigation |
|---|---|
| Webhook spoofing | Validate `X-Twilio-Signature` on every inbound POST (skipped in `development` env) |
| Sensitive receipt data | All processing runs locally in Docker; files stored on local volume |
| LLM prompt injection | OCR text treated as data in user turn; system prompt is instruction-only |
| API keys | Loaded from `.env`, never hardcoded; `.env` in `.gitignore` |
| Google credentials | Service account JSON mounted as Docker secret at `/secrets/credentials.json` |
| CORS | FastAPI CORS middleware: only ports 3000 and 3001 allowed |

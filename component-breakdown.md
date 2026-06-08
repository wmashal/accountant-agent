# Component Breakdown

## Project Structure

```
accountant-agent/
├── docker-compose.yml              # Full local stack (api + redis + postgres + dashboard)
├── Dockerfile                      # API image
├── requirements.txt                # Python dependencies
├── .env.example                    # Environment variable template
├── app/
│   ├── main.py                     # FastAPI entry point, mounts /files/ static, starts Drive poller
│   ├── db.py                       # SQLAlchemy engine + SessionLocal (lazy init)
│   ├── config.py                   # Settings from env vars (pydantic-settings)
│   ├── routes/
│   │   ├── webhook.py              # POST /webhook — inbound WhatsApp messages
│   │   ├── dashboard.py            # GET/POST/PATCH /api/dashboard/* — admin API
│   │   └── health.py               # GET /health
│   ├── pipeline/
│   │   ├── process_receipt.py      # WhatsApp pipeline + Drive pipeline + batch settle + auto-confirm
│   │   ├── ocr.py                  # LlamaParse (unused) + Twilio media fetch
│   │   ├── extract.py              # Gemini (3 retries) + Claude fallback
│   │   └── normalize.py            # Date, ABN, GST, currency normalization
│   ├── services/
│   │   ├── twilio_client.py        # Send WhatsApp messages (summary, registration, confirm)
│   │   ├── local_storage.py        # Save files to /app/receipts/ Docker volume
│   │   ├── db_service.py           # Postgres CRUD (WhatsApp + Drive)
│   │   ├── gemini_client.py        # Gemini Vision API calls
│   │   ├── claude_client.py        # Claude API calls (image fallback only)
│   │   ├── redis_client.py         # Redis singleton
│   │   ├── google_drive.py         # Drive folder creation, file listing, download, move
│   │   ├── drive_poller.py         # asyncio background poller — polls Drive folders every 30s
│   │   └── google_sheets.py        # Legacy — not used in active pipeline
│   └── models/
│       └── receipt.py              # ReceiptData dataclass + Customer/Receipt ORM models
├── dashboard/
│   ├── src/
│   │   ├── App.tsx                 # Two-panel: customer sidebar + receipt table + Add Customer modal
│   │   ├── App.css                 # Styling
│   │   └── api.ts                  # Typed API client
│   ├── Dockerfile                  # Multi-stage: node build → nginx serve
│   └── nginx.conf                  # Proxies /api/ and /files/ → http://api:8000
└── docs/
    ├── architecture-design.md
    ├── component-breakdown.md
    ├── implementation-plan.md
    └── deploy-gcp.md
```

---

## 1. Docker Compose Stack

Four services: `api`, `redis`, `postgres`, `dashboard`.

```yaml
services:
  api:
    build: .
    ports: ["8000:8000"]
    env_file: .env
    depends_on:
      redis: { condition: service_healthy }
      postgres: { condition: service_healthy }
    volumes:
      - ./app:/app/app                             # hot reload
      - receipts_data:/app/receipts                # persistent file storage

  dashboard:
    build: ./dashboard
    ports: ["3001:80"]
    depends_on: [api]

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: accountant
      POSTGRES_USER: accountant
      POSTGRES_PASSWORD: accountant
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
  receipts_data:
```

**Start everything:**
```bash
docker compose up
```

---

## 2. FastAPI Entry Point (`app/main.py`)

```python
RECEIPTS_DIR = Path("/app/receipts")

@asynccontextmanager
async def lifespan(app: FastAPI):
    RECEIPTS_DIR.mkdir(parents=True, exist_ok=True)
    await init_db()   # creates tables if not exist
    # Start Drive poller if configured
    if settings.google_drive_folder_id and settings.google_service_account_file:
        from app.services.drive_poller import poll_drive_forever
        asyncio.create_task(poll_drive_forever())
    yield

app = FastAPI(title="Accountant Agent", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3001", ...])
app.include_router(health_router)
app.include_router(webhook_router)
app.include_router(dashboard_router)
app.mount("/files", StaticFiles(directory=str(RECEIPTS_DIR)), name="files")
```

Receipt files served at: `http://localhost:8000/files/{phone}/{YYYY-MM}/{sid}.ext`

---

## 3. Database Layer (`app/db.py`)

Uses **lazy initialization** — engine created on first call, not at import time. Prevents errors on hot-reload.

```python
_engine = None

def _get_engine():
    global _engine
    if _engine is None:
        _engine = create_async_engine(settings.database_url)
    return _engine

def SessionLocal():
    return async_sessionmaker(_get_engine(), expire_on_commit=False)()

async def init_db():
    async with _get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
```

> **New columns added after initial creation** (e.g. `company_name`, `company_id`) require a manual `ALTER TABLE` — SQLAlchemy's `create_all` uses `IF NOT EXISTS` and won't add columns to existing tables.

---

## 4. ORM Models (`app/models/receipt.py`)

```python
class Customer(Base):
    __tablename__ = "customers"
    id: int (PK)
    phone_number: str (unique)      # WhatsApp number or drive_{uuid} placeholder
    display_name: str | None        # set during registration or via dashboard
    company_name: str | None        # set during registration or via dashboard
    company_id: str | None          # company registration number
    drive_folder_id: str | None     # Google Drive folder ID
    source: str                     # 'whatsapp' | 'drive' | 'both' (default: 'whatsapp')
    default_currency: str           # 'ILS' or 'USD' — applied to all receipts
    created_at: datetime

class Receipt(Base):
    __tablename__ = "receipts"
    id: int (PK)
    message_sid: str (unique)       # Twilio MessageSid or drive_{file_id}[_pN] — idempotency key
    customer_id: int (FK)
    phone_number: str
    vendor: str | None
    cost: float | None
    tax: float | None
    currency: str                   # ISO 4217 — always customer's default_currency
    date: str | None                # YYYY-MM-DD
    abn: str | None
    receipt_number: str | None      # Invoice/receipt number extracted from document
    receipt_language: str | None    # BCP 47
    extraction_model: str | None    # gemini-2.5-flash or claude-sonnet-4-5
    transaction_type: str           # income or expense — auto-detected from payer field
    status: str                     # processing / pending_confirmation / confirmed / rejected / error
    file_url: str | None
    drive_file_id: str | None       # Google Drive file ID — idempotency key for Drive receipts
    created_at: datetime
    updated_at: datetime
```

---

## 5. Webhook (`app/routes/webhook.py`)

### POST /webhook

Receives all inbound Twilio WhatsApp messages.

**Flow:**
1. Validate `X-Twilio-Signature` (skipped in `development` env)
2. Check Redis for active registration state (`reg:<from>`)
   - If registration active + media arrives → queue to `pending_media`, return silently
   - If registration active + text arrives → advance registration state machine
3. If no registration state + media → check if registered
   - Not registered: store media, start registration
   - Registered: create receipt rows, queue background tasks, increment `processing:` counter
4. If text only → check for confirm/reject, bulk-update all `pending:<from>` SIDs

### Registration State Machine

| Step | Redis `reg:<from>` | Bot message | User replies with |
|---|---|---|---|
| Start | `{step: awaiting_name}` | "What is your full name or company name?" | Any text |
| Name received | `{step: awaiting_id, name: ...}` | "Thanks! What is your company ID? (or skip)" | ID number or "skip" |
| ID received | (key deleted) | "All set! Processing your receipts..." | — |

### Confirmation Handler

```python
# pending:<from> holds a JSON list of SIDs
sids = json.loads(await redis.get(f"pending:{from_number}"))

if body_lower in ("confirm", "yes", "✓"):
    for sid in sids:
        await update_receipt_status(session, sid, "confirmed")
    await redis.delete(f"pending:{from_number}")

elif body_lower in ("reject", "no", "✗"):
    for sid in sids:
        await update_receipt_status(session, sid, "rejected")
    await redis.delete(f"pending:{from_number}")
```

---

## 6. Background Pipeline (`app/pipeline/process_receipt.py`)

### Batch Counter Logic

```
Webhook queues N jobs → INCRBY processing:{from} N
Each job finishes → DECR processing:{from}
After each decrement → schedule _maybe_send_confirm (15s delay)
  If counter still > 0 after 15s → another job running, skip
  If counter = 0 → send ONE confirm prompt, start 5-min auto-confirm timer
```

### process_single_receipt

```python
async def process_single_receipt(message_sid, from_number, file_bytes, content_type):
    ocr_text = None
    raw_result, model = await extract(file_bytes, content_type, ocr_text)
    data = normalize(raw_result, extraction_model=model, raw_ocr=ocr_text)
    file_url = await upload_receipt(file_bytes, from_number, message_sid, content_type)
    await upsert_receipt(session, message_sid, from_number, data, file_url, "pending_confirmation")
    send_summary(from_number, data, file_url)

    # Decrement counter, schedule settle-and-confirm
    remaining = await redis.decr(f"processing:{from_number}")
    asyncio.create_task(_maybe_send_confirm(from_number))
```

### Auto-Confirm Timer

```python
async def _auto_confirm(from_number):
    await asyncio.sleep(300)  # 5 minutes
    pending_raw = await redis.get(f"pending:{from_number}")
    if not pending_raw:
        return  # user already replied
    for sid in json.loads(pending_raw):
        await update_receipt_status(session, sid, "confirmed")
    await redis.delete(f"pending:{from_number}")
    _send(from_number, "✅ N receipt(s) auto-confirmed after 5 minutes.")
```

### Multi-Page PDF Splitting

```python
reader = PdfReader(io.BytesIO(file_bytes))
if len(reader.pages) > 1:
    await redis.incrby(f"processing:{from_number}", num_pages - 1)
    for page_num in range(num_pages):
        writer = PdfWriter()
        writer.add_page(reader.pages[page_num])
        page_sid = f"{message_sid}_p{page_num + 1}"
        await process_single_receipt(page_sid, from_number, page_bytes, content_type)
```

---

## 7. Extraction Pipeline (`app/pipeline/extract.py`)

```
Primary: Gemini 2.5 Flash
  → retry up to 3x on 5xx with 3s / 6s backoff
  → validates result (vendor + cost required and non-empty)

Fallback (images only): Claude Sonnet 4.5
  → triggered if all Gemini attempts fail or return invalid JSON
  → NOT used for PDFs (Claude does not support PDF as image)

Failure: raise ValueError → process_single_receipt catches → status=error
```

---

## 8. Local File Storage (`app/services/local_storage.py`)

```python
RECEIPTS_DIR = Path("/app/receipts")

async def upload_receipt(file_bytes, phone_number, message_sid, content_type) -> str:
    safe_phone = phone_number.replace("whatsapp:", "").replace("+", "")
    month = datetime.utcnow().strftime("%Y-%m")
    folder = RECEIPTS_DIR / safe_phone / month
    folder.mkdir(parents=True, exist_ok=True)
    filepath = folder / f"{message_sid}.{ext}"
    filepath.write_bytes(file_bytes)
    return f"/files/{safe_phone}/{month}/{message_sid}.{ext}"
```

Files served by FastAPI `StaticFiles`. Proxied through nginx at `/files/` so the dashboard can load them without CORS issues.

---

## 9. Database Service (`app/services/db_service.py`)

| Function | Description |
|---|---|
| `get_or_create_customer(session, phone)` | Upsert customer by phone number |
| `create_customer(session, display_name, company_name, company_id, phone_number, drive_folder_id)` | Create new customer (Drive flow) |
| `create_receipt_row(session, sid, phone)` | Create placeholder row (status=processing) |
| `upsert_receipt(session, sid, phone, data, url, status)` | Create or update full receipt row (WhatsApp) |
| `upsert_receipt_from_drive(session, sid, customer_id, data, url, drive_file_id)` | Create receipt row auto-confirmed (Drive) |
| `update_receipt_status(session, sid, status)` | Mark as confirmed/rejected/error |
| `update_customer_profile(session, phone, name, company, id)` | Set display_name, company_name, company_id |
| `get_processed_drive_file_ids(session, customer_id)` | Return set of already-processed Drive file IDs for dedup |

---

## 10. Dashboard API (`app/routes/dashboard.py`)

```
GET  /api/dashboard/customers
     → [{id, phone_number, display_name, company_name, company_id,
         drive_folder_id, drive_share_link, source,
         total_receipts, total_income, total_expense, created_at}]

POST /api/dashboard/customers
     body: {display_name, company_name?, company_id?, phone_number?}
     → creates customer + Drive folder (if GOOGLE_DRIVE_FOLDER_ID set)
     → CustomerSummary with drive_share_link

GET  /api/dashboard/customers/{id}/receipts
     → [{id, message_sid, vendor, cost, tax, currency, date, abn,
         status, transaction_type, file_url, drive_file_id,
         receipt_language, extraction_model, created_at}]

PATCH /api/dashboard/receipts/{id}
      body: any subset of {vendor, cost, tax, currency, date, abn, transaction_type, status}
      → updated receipt

PATCH /api/dashboard/customers/{id}/profile
      body: {display_name?, company_name?, company_id?}
      → updated customer

PATCH /api/dashboard/customers/{id}/name
      body: {display_name}
      → updated customer (legacy endpoint)
```

---

## 11. React Dashboard (`dashboard/src/App.tsx`)

**Left panel — Customer sidebar**
- Search bar: filters by name, phone, company name, company ID (client-side)
- Customer list: name/phone, company name + ID, income/expense/count badges, source badge (📱/📁)
- "+ Add Customer" button at the bottom → opens modal form
- Click to select

**Add Customer modal**
- Fields: Display Name (required), Company Name, Company ID, Phone (optional)
- On submit: calls `POST /api/dashboard/customers`
- On success: shows Drive folder share link to give to the customer

**Right panel — Customer detail**
- Header: name, company, phone — click to edit profile (name + company + ID inline form)
- Source badge (📱/📁) + Drive folder link (if customer has Drive folder)
- Summary cards: Confirmed Income / Confirmed Expenses / Net
- Receipt table: date, receipt #, vendor, amount, tax, ABN, type, status, file link, Drive link, actions
  - **Move button** → toggle income/expense
  - **Edit button** → inline edit row (all fields + dropdowns for type/status)
  - **Delete button** → removes DB row + GCS file + moves Drive file to `deleted/` subfolder
  - Click View → modal overlay (image or PDF)
  - Drive receipts show a "Drive" link to the original file in Drive

**File preview modal**
- Images: `<img>` tag
- PDFs: `<iframe>`
- Click outside or ✕ to close
- Files loaded via `/files/` nginx proxy

---

## 12. nginx Config (`dashboard/nginx.conf`)

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;

    location /api/ {
        proxy_pass http://api:8000/api/;
        proxy_set_header Host $host;
    }

    location /files/ {
        proxy_pass http://api:8000/files/;
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 13. WhatsApp Messages (`app/services/twilio_client.py`)

| Function | When sent | Content |
|---|---|---|
| `send_registration_ask_name(to)` | First media from unknown number | "What is your full name or company name?" |
| `send_registration_ask_id(to, name)` | After name received | "Thanks, {name}! What is your company ID? (or reply skip)" |
| `send_registration_welcome(to, name)` | Registration complete | "All set, {name}! Send receipts anytime." |
| `send_summary(to, data, url)` | After each receipt processed | Vendor, amount, tax, date, ABN, file link — no confirm prompt |
| `send_confirm_prompt(to, count)` | After all receipts in batch done | "All done! N receipts. Reply confirm or reject" |
| `send_error(to)` | Extraction failure | "Could not process your receipt. Please try sending it again." |

---

## 14. Extraction Prompt

Used by both Gemini (vision + text) and Claude fallback. Handles receipts in any language.

```
You are a receipt data extraction assistant.
Return ONLY valid JSON — no markdown fences, no explanation.

{
  "vendor": "string",          // issuer of the receipt
  "payer": "string or null",   // who paid — check fields like "לכבוד", "מקור", "bill to"
  "receipt_number": "string or null",  // invoice/receipt number
  "cost": 0.00,
  "tax": 0.00,
  "tax_included": false,
  "currency": "AUD",
  "date": "string",
  "abn": "string or null",
  "receipt_language": "en"
}
```

**Income detection:** After extraction, `normalize.py` checks if the customer's `company_id`, `company_name`, or `display_name` appears in the `vendor` or `payer` fields. If matched → `transaction_type = income`. Otherwise → `expense`.

---

## 15. Environment Variables

```bash
# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_NUMBER=+1415xxxxxxx

# LlamaParse (present in config but pipeline uses Gemini Vision directly for PDFs)
LLAMA_CLOUD_API_KEY=llx-xxxxxxxxxxxxxxxxxxxx

# Gemini
GEMINI_API_KEY=AIzaxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Claude (Anthropic) — image fallback only
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx

# Google Drive — service account + root folder
GOOGLE_SERVICE_ACCOUNT_FILE=/secrets/credentials.json
GOOGLE_DRIVE_FOLDER_ID=your-google-drive-folder-id-from-url

# Drive poller interval in seconds (30 for dev, 300 for prod)
DRIVE_POLL_INTERVAL_SECONDS=30

# Postgres
DATABASE_URL=postgresql+asyncpg://accountant:accountant@postgres/accountant

# Redis
REDIS_URL=redis://redis:6379/0

# App
ENVIRONMENT=development   # set to "production" to enable Twilio signature validation
```

---

## 16. ngrok (Local Twilio Tunnel)

ngrok exposes `localhost:8000` to a public HTTPS URL that Twilio can POST to.

```bash
ngrok http 8000
```

Copy the `https://xxxx.ngrok.io` URL and set it in Twilio console:
- **Webhook URL:** `https://xxxx.ngrok.io/webhook`
- **HTTP method:** `POST`

> ngrok URL changes on every restart unless you have a paid account with a static domain. Update Twilio console each time.

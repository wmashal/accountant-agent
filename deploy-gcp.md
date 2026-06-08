# Deploy to Google Cloud Platform

This guide covers deploying the Accountant Agent to GCP using:
- **Cloud Run** — API and Dashboard (serverless containers)
- **Cloud SQL** — Postgres 16 (managed database)
- **Memorystore for Redis** — managed Redis
- **Google Cloud Storage** — receipt file storage (replaces local Docker volume)
- **Artifact Registry** — Docker image storage
- **Secret Manager** — API keys and credentials

---

## Architecture on GCP

```
Internet
  │
  ├── Twilio webhook → Cloud Run (API) ──┬── Cloud SQL (Postgres)
  │                                      ├── Memorystore (Redis)
  │                                      └── Cloud Storage (receipt files)
  │
  └── Browser → Cloud Run (Dashboard) → Cloud Run (API)
```

- The API Cloud Run service is public (Twilio must POST to it)
- The Dashboard Cloud Run service can be restricted to your IP or left public
- Cloud SQL and Memorystore are private (VPC only, not internet-accessible)
- All secrets stored in Secret Manager (no `.env` files in production)

---

## Prerequisites

### 1. Install Google Cloud CLI

```bash
# macOS
brew install google-cloud-sdk

# Verify
gcloud version
```

### 2. Authenticate

```bash
gcloud auth login
gcloud auth configure-docker australia-southeast1-docker.pkg.dev
```

> Replace `australia-southeast1` with your preferred region throughout this guide. Other options: `us-central1`, `europe-west1`, `asia-east1`.

### 3. Set your project

```bash
# Create a new project (or use existing)
gcloud projects create accountant-agent-prod --name="Accountant Agent"

# Set as active project
gcloud config set project accountant-agent-prod

# Enable billing (required for Cloud Run, Cloud SQL, etc.)
# Go to: https://console.cloud.google.com/billing
```

### 4. Enable required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  storage.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  vpcaccess.googleapis.com \
  servicenetworking.googleapis.com
```

---

## Step 1 — Artifact Registry (Docker Image Storage)

```bash
# Create registry repository
gcloud artifacts repositories create accountant-agent \
  --repository-format=docker \
  --location=australia-southeast1 \
  --description="Accountant Agent Docker images"

# Configure Docker auth
gcloud auth configure-docker australia-southeast1-docker.pkg.dev
```

---

## Step 2 — Build and Push Docker Images

From the project root (`accountant-agent/`):

```bash
# Set your project ID
PROJECT_ID=accountant-agent-prod
REGION=australia-southeast1
REGISTRY=${REGION}-docker.pkg.dev/${PROJECT_ID}/accountant-agent

# Build and push API image
docker build -t ${REGISTRY}/api:latest .
docker push ${REGISTRY}/api:latest

# Build and push Dashboard image
docker build -t ${REGISTRY}/dashboard:latest ./dashboard
docker push ${REGISTRY}/dashboard:latest
```

> For Apple Silicon (M1/M2/M3) Macs, add `--platform linux/amd64` to each build command:
> ```bash
> docker build --platform linux/amd64 -t ${REGISTRY}/api:latest .
> docker build --platform linux/amd64 -t ${REGISTRY}/dashboard:latest ./dashboard
> ```

---

## Step 3 — VPC Network (for Cloud SQL + Memorystore)

Cloud SQL and Memorystore require a VPC. Cloud Run connects via Serverless VPC Access.

```bash
# Create a VPC network (or use default)
gcloud compute networks create accountant-vpc \
  --subnet-mode=auto

# Create Serverless VPC Access connector (allows Cloud Run to reach private services)
gcloud compute networks vpc-access connectors create accountant-connector \
  --network=accountant-vpc \
  --region=australia-southeast1 \
  --range=10.8.0.0/28
```

---

## Step 4 — Cloud SQL (Postgres)

```bash
# Create Postgres 16 instance
# db-f1-micro is the smallest (free tier eligible) — upgrade for production
gcloud sql instances create accountant-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=australia-southeast1 \
  --network=accountant-vpc \
  --no-assign-ip \
  --storage-type=SSD \
  --storage-size=10GB

# Create database
gcloud sql databases create accountant \
  --instance=accountant-db

# Create database user
gcloud sql users create accountant \
  --instance=accountant-db \
  --password=CHANGE_THIS_PASSWORD

# Get the private IP of your Cloud SQL instance (needed for DATABASE_URL)
gcloud sql instances describe accountant-db \
  --format="value(ipAddresses[0].ipAddress)"
```

Note the private IP — you'll need it for `DATABASE_URL`.

**Database URL format for Cloud Run:**
```
postgresql+asyncpg://accountant:CHANGE_THIS_PASSWORD@<PRIVATE_IP>/accountant
```

### Run DB Migration (after first deploy)

After deploying the API, run the `ALTER TABLE` to add the `company_name` and `company_id` columns that were added after the initial schema:

```bash
# Connect via Cloud SQL Auth Proxy (or use Cloud Shell)
gcloud sql connect accountant-db --user=accountant --database=accountant

# Then run:
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name VARCHAR(200);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_id VARCHAR(100);
\q
```

---

## Step 5 — Memorystore for Redis

```bash
# Create Redis instance (basic tier, 1GB)
gcloud redis instances create accountant-redis \
  --size=1 \
  --region=australia-southeast1 \
  --network=projects/${PROJECT_ID}/global/networks/accountant-vpc \
  --redis-version=redis_7_0

# Get the Redis host IP
gcloud redis instances describe accountant-redis \
  --region=australia-southeast1 \
  --format="value(host)"
```

Note the host IP — **Redis URL format:**
```
redis://<HOST_IP>:6379/0
```

---

## Step 6 — Cloud Storage (Receipt Files)

Cloud Run containers are stateless — the local Docker volume won't work. Receipt files must be stored in GCS.

```bash
# Create bucket (use your project ID for uniqueness)
gcloud storage buckets create gs://accountant-agent-receipts-${PROJECT_ID} \
  --location=australia-southeast1 \
  --uniform-bucket-level-access

# Make bucket publicly readable (so dashboard can load receipt images/PDFs)
# OR serve files through a signed URL / via the API (more secure)
gcloud storage buckets add-iam-policy-binding \
  gs://accountant-agent-receipts-${PROJECT_ID} \
  --member=allUsers \
  --role=roles/storage.objectViewer
```

> **Note:** Public bucket means anyone with the file URL can access receipt files. For a production system, consider serving files through the API with authentication instead.

### Update the app to use GCS

The current `local_storage.py` saves files to `/app/receipts/` — this won't persist on Cloud Run. You have two options:

**Option A (Recommended): Use GCS client** — `app/services/gcs_client.py` already exists in the codebase. Set `GCS_BUCKET_NAME` in your environment and update `process_receipt.py` to call `gcs_client.upload_receipt()` instead of `local_storage.upload_receipt()`.

**Option B (Simpler):** Mount a GCS bucket as a volume in Cloud Run (in preview as of 2026 — check availability).

For now, set `GCS_BUCKET_NAME=accountant-agent-receipts-${PROJECT_ID}` in your secrets and the app will use GCS if the bucket name is set.

---

## Step 7 — Secret Manager

Store all sensitive values in Secret Manager instead of a `.env` file.

```bash
# Helper function
create_secret() {
  echo -n "$2" | gcloud secrets create "$1" --data-file=- --replication-policy=automatic
}

# Create all secrets (replace values with your actual keys)
create_secret TWILIO_ACCOUNT_SID       "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
create_secret TWILIO_AUTH_TOKEN        "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
create_secret TWILIO_FROM_NUMBER       "+1415xxxxxxx"
create_secret GEMINI_API_KEY           "AIzaxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
create_secret ANTHROPIC_API_KEY        "sk-ant-xxxxxxxxxxxxxxxxxxxx"
create_secret LLAMA_CLOUD_API_KEY      "llx-xxxxxxxxxxxxxxxxxxxx"
create_secret DATABASE_URL             "postgresql+asyncpg://accountant:CHANGE_THIS_PASSWORD@<PRIVATE_IP>/accountant"
create_secret REDIS_URL                "redis://<REDIS_HOST_IP>:6379/0"
create_secret GCS_BUCKET_NAME         "accountant-agent-receipts-${PROJECT_ID}"
```

---

## Step 8 — Service Account for Cloud Run

```bash
# Create service account for the API
gcloud iam service-accounts create accountant-api-sa \
  --display-name="Accountant Agent API"

SA_EMAIL=accountant-api-sa@${PROJECT_ID}.iam.gserviceaccount.com

# Grant access to Secret Manager
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"

# Grant access to Cloud Storage
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectAdmin"

# Grant access to Cloud SQL
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudsql.client"
```

---

## Step 9 — Deploy API to Cloud Run

```bash
PROJECT_ID=accountant-agent-prod
REGION=australia-southeast1
REGISTRY=${REGION}-docker.pkg.dev/${PROJECT_ID}/accountant-agent
SA_EMAIL=accountant-api-sa@${PROJECT_ID}.iam.gserviceaccount.com

gcloud run deploy accountant-api \
  --image=${REGISTRY}/api:latest \
  --platform=managed \
  --region=${REGION} \
  --service-account=${SA_EMAIL} \
  --allow-unauthenticated \
  --port=8000 \
  --min-instances=1 \
  --max-instances=10 \
  --memory=1Gi \
  --cpu=1 \
  --timeout=300 \
  --vpc-connector=accountant-connector \
  --vpc-egress=private-ranges-only \
  --set-secrets=\
TWILIO_ACCOUNT_SID=TWILIO_ACCOUNT_SID:latest,\
TWILIO_AUTH_TOKEN=TWILIO_AUTH_TOKEN:latest,\
TWILIO_FROM_NUMBER=TWILIO_FROM_NUMBER:latest,\
GEMINI_API_KEY=GEMINI_API_KEY:latest,\
ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,\
LLAMA_CLOUD_API_KEY=LLAMA_CLOUD_API_KEY:latest,\
DATABASE_URL=DATABASE_URL:latest,\
REDIS_URL=REDIS_URL:latest,\
GCS_BUCKET_NAME=GCS_BUCKET_NAME:latest \
  --set-env-vars=ENVIRONMENT=production

# Get the deployed URL
gcloud run services describe accountant-api \
  --region=${REGION} \
  --format="value(status.url)"
```

The URL will look like: `https://accountant-api-xxxxxxxxxx-ts.a.run.app`

> **`--min-instances=1`** prevents cold starts. The auto-confirm background task (`asyncio.create_task`) requires the process to stay alive for 5 minutes — set min instances to 1 so the container isn't shut down between requests.

---

## Step 10 — Deploy Dashboard to Cloud Run

The dashboard nginx config proxies `/api/` to `http://api:8000` by hostname — this won't work on Cloud Run. You need to update the nginx config to proxy to the Cloud Run API URL.

### Update nginx.conf for production

Edit `dashboard/nginx.conf` before building:

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;

    location /api/ {
        proxy_pass https://accountant-api-xxxxxxxxxx-ts.a.run.app/api/;
        proxy_set_header Host accountant-api-xxxxxxxxxx-ts.a.run.app;
        proxy_ssl_server_name on;
    }

    location /files/ {
        proxy_pass https://accountant-api-xxxxxxxxxx-ts.a.run.app/files/;
        proxy_set_header Host accountant-api-xxxxxxxxxx-ts.a.run.app;
        proxy_ssl_server_name on;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Then rebuild and push the dashboard image:

```bash
docker build --platform linux/amd64 -t ${REGISTRY}/dashboard:latest ./dashboard
docker push ${REGISTRY}/dashboard:latest
```

Deploy:

```bash
gcloud run deploy accountant-dashboard \
  --image=${REGISTRY}/dashboard:latest \
  --platform=managed \
  --region=${REGION} \
  --allow-unauthenticated \
  --port=80 \
  --memory=256Mi \
  --cpu=1

# Get dashboard URL
gcloud run services describe accountant-dashboard \
  --region=${REGION} \
  --format="value(status.url)"
```

---

## Step 11 — Update Twilio Webhook

Go to [console.twilio.com](https://console.twilio.com) → Messaging → Senders → WhatsApp Sandbox (or your number):

- **Webhook URL:** `https://accountant-api-xxxxxxxxxx-ts.a.run.app/webhook`
- **HTTP method:** `POST`

---

## Step 12 — Run Database Migration

Connect to Cloud SQL and add the columns that were added after initial schema creation:

```bash
# Open Cloud Shell or use gcloud sql connect
gcloud sql connect accountant-db --user=accountant --database=accountant

# Inside psql:
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name VARCHAR(200);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_id VARCHAR(100);
\q
```

---

## Step 13 — Verify Deployment

```bash
# Check API health
curl https://accountant-api-xxxxxxxxxx-ts.a.run.app/health

# Check Cloud Run logs
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=accountant-api" \
  --limit=50 \
  --format="value(textPayload)"

# Or stream logs
gcloud beta run services logs tail accountant-api --region=${REGION}
```

---

## Using GCP Services with the App

### Gemini API on GCP

Gemini is called via the Gemini API (not Vertex AI) using your `GEMINI_API_KEY` from Google AI Studio. No GCP-specific setup needed — the existing `gemini_client.py` works as-is.

If you want to use **Vertex AI** instead (billed to your GCP project, no separate API key):
1. Enable: `gcloud services enable aiplatform.googleapis.com`
2. Grant the service account `roles/aiplatform.user`
3. Update `gemini_client.py` to use the `google-cloud-aiplatform` SDK with ADC (Application Default Credentials)

### Anthropic (Claude) API on GCP

Claude is called via the Anthropic API directly using `ANTHROPIC_API_KEY`. Store it in Secret Manager (done in Step 7). No GCP-specific integration needed.

Alternatively, Claude is available through **Vertex AI Model Garden**:
1. Enable Vertex AI and accept the Claude model terms in the console
2. Use the `anthropic-sdk` with `vertex=True` and your GCP project credentials

### Twilio on GCP

Twilio works identically on GCP — it POSTs to your Cloud Run URL. The only change is updating the webhook URL in the Twilio console to point to your Cloud Run API service URL.

For **Twilio signature validation** to work correctly on Cloud Run, ensure:
- `ENVIRONMENT=production` is set (enables validation in `webhook.py`)
- The `X-Forwarded-Proto` and `Host` headers are passed correctly — Cloud Run does this automatically

---

## Cost Estimate (Monthly)

| Service | Tier | Approx. Cost |
|---|---|---|
| Cloud Run (API, min 1 instance) | 1 vCPU, 1GB RAM | ~$15–25/mo |
| Cloud Run (Dashboard) | 256MB, scales to 0 | < $1/mo |
| Cloud SQL (Postgres) | db-f1-micro | ~$10/mo |
| Memorystore (Redis) | 1GB basic | ~$25/mo |
| Cloud Storage | First 5GB free | < $1/mo |
| Artifact Registry | First 0.5GB free | < $1/mo |
| Secret Manager | First 6 versions free | < $1/mo |
| **Total** | | **~$50–60/mo** |

> Memorystore is the largest cost. For a lower-cost alternative, run Redis as a sidecar container in Cloud Run (preview feature) or use a small Compute Engine VM for Redis.

---

## Redeployment (After Code Changes)

```bash
PROJECT_ID=accountant-agent-prod
REGION=australia-southeast1
REGISTRY=${REGION}-docker.pkg.dev/${PROJECT_ID}/accountant-agent

# Rebuild and push API
docker build --platform linux/amd64 -t ${REGISTRY}/api:latest .
docker push ${REGISTRY}/api:latest
gcloud run services update-traffic accountant-api \
  --region=${REGION} --to-latest

# Rebuild and push Dashboard
docker build --platform linux/amd64 -t ${REGISTRY}/dashboard:latest ./dashboard
docker push ${REGISTRY}/dashboard:latest
gcloud run services update-traffic accountant-dashboard \
  --region=${REGION} --to-latest
```

Or use the deploy command again — it updates in-place with zero downtime.

---

## Environment Variables Reference (Production)

| Variable | Source | Value |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Secret Manager | `ACxxxxxxxx...` |
| `TWILIO_AUTH_TOKEN` | Secret Manager | `xxxxxxxx...` |
| `TWILIO_FROM_NUMBER` | Secret Manager | `+1415xxxxxxx` |
| `GEMINI_API_KEY` | Secret Manager | `AIzaxxxxxxxx...` |
| `ANTHROPIC_API_KEY` | Secret Manager | `sk-ant-xxxxxxxx...` |
| `LLAMA_CLOUD_API_KEY` | Secret Manager | `llx-xxxxxxxx...` |
| `DATABASE_URL` | Secret Manager | `postgresql+asyncpg://accountant:pass@<PRIVATE_IP>/accountant` |
| `REDIS_URL` | Secret Manager | `redis://<REDIS_HOST>:6379/0` |
| `GCS_BUCKET_NAME` | Secret Manager | `accountant-agent-receipts-<project>` |
| `ENVIRONMENT` | Env var (inline) | `production` |

---

## Troubleshooting

**Cloud Run can't reach Cloud SQL / Redis**
- Verify the VPC connector is attached: check `--vpc-connector` in the deploy command
- Verify Cloud SQL has no public IP (`--no-assign-ip`)
- Check the connector is in the same region as Cloud Run

**Twilio signature validation failing (403)**
- Ensure `ENVIRONMENT=production` is set
- Cloud Run sits behind a load balancer — the request URL seen by the app must match what Twilio signed. Use `X-Forwarded-Proto` header or hardcode the public URL in the validator

**Background tasks (auto-confirm) not running**
- Cloud Run with `--min-instances=0` will shut down the container after the request returns, killing background `asyncio` tasks
- Set `--min-instances=1` to keep the container alive

**Receipt files not persisting**
- Cloud Run containers are ephemeral — local storage is lost on restart
- Must use GCS bucket (`GCS_BUCKET_NAME` env var) rather than local `/app/receipts/`

**Cold start latency**
- First request after idle can be slow (2–5s)
- `--min-instances=1` prevents cold starts but costs more

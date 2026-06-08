# Deploy to Google Cloud Platform

This guide covers deploying the Accountant Agent to GCP using:
- **Cloud Run** — API, Dashboard, and Redis (containerised)
- **Cloud SQL** — Postgres 16 (managed — required, Cloud Run is stateless)
- **Cloud Storage** — receipt file storage (replaces local Docker volume)
- **Artifact Registry** — Docker image storage
- **Secret Manager** — API keys and credentials

> **Why not Memorystore for Redis?** Redis only holds ephemeral session state (registration flow, batch counters, confirmation SIDs). Running it as a Cloud Run container saves ~$25/mo. If it restarts, active WhatsApp sessions are lost but no data is permanently affected.

---

## Two Connectivity Options for Cloud SQL

### Option A — Public IP + Cloud SQL Auth Proxy (POC / default in this guide)

Cloud SQL gets a public IP. Cloud Run connects via the built-in Cloud SQL Auth Proxy using the instance connection name. No VPC, no VPC connector needed.

- Simpler setup
- No VPC connector cost (~$6/mo saved)
- Secure — Auth Proxy uses IAM + TLS, no password exposed to internet
- **This is what the steps below use**

### Option B — Private IP + VPC (Production recommended)

Cloud SQL has no public IP. Cloud Run reaches it through a private VPC via a Serverless VPC Access Connector.

- More secure (database not reachable from internet at all)
- Extra cost: VPC Access Connector ~$6/mo
- See [Production VPC Setup](#production-vpc-setup-option-b) section at the bottom

---

## Architecture on GCP

```
Internet
  │
  ├── Twilio webhook  →  Cloud Run: accountant-api
  │                             │
  │                    ┌────────┼────────┐
  │               Cloud SQL  Redis CR  GCS bucket
  │              (Postgres)  (session)  (files)
  │              public IP
  │              via Auth Proxy
  │
  └── Browser  →  Cloud Run: accountant-dashboard
                        │
                   proxy /api/ → accountant-api URL
```

- API and Dashboard are public Cloud Run services
- Cloud SQL has a public IP but is protected by Cloud SQL Auth Proxy (IAM auth)
- Redis runs as its own Cloud Run service (internal ingress only)
- GCS bucket serves receipt files publicly (images/PDFs for the dashboard)
- All secrets stored in Secret Manager

---

## Prerequisites

### 1. Install Google Cloud CLI

```bash
# macOS
brew install google-cloud-sdk

# Verify
gcloud version
```

### 2. Authenticate and set project

```bash
gcloud auth login

# Set your existing project
export PROJECT_ID=accountant-agent-498810
gcloud config set project ${PROJECT_ID}

# Set region (used throughout)
export REGION=us-central1
export REGISTRY=${REGION}-docker.pkg.dev/${PROJECT_ID}/accountant-agent

# Configure Docker auth for Artifact Registry
gcloud auth configure-docker ${REGION}-docker.pkg.dev
```

### 3. Enable required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  storage.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  vpcaccess.googleapis.com \
  servicenetworking.googleapis.com
```

---

## Step 1 — Artifact Registry

```bash
gcloud artifacts repositories create accountant-agent \
  --repository-format=docker \
  --location=${REGION} \
  --description="Accountant Agent Docker images"
```

---

## Step 2 — Build and Push Docker Images

From the project root (`accountant-agent/`):

```bash
# Apple Silicon (M1/M2/M3): add --platform linux/amd64 to both commands

# API
docker build --platform linux/amd64 -t ${REGISTRY}/api:latest .
docker push ${REGISTRY}/api:latest

# Dashboard (build without nginx.conf changes yet — we'll handle API URL via env var below)
docker build --platform linux/amd64 -t ${REGISTRY}/dashboard:latest ./dashboard
docker push ${REGISTRY}/dashboard:latest
```

---

## Step 3 — VPC Network (Option B / Production only)

> **Skip this step for POC.** Only needed if using private IP for Cloud SQL (Option B). See [Production VPC Setup](#production-vpc-setup-option-b) at the bottom.

---

## Step 4 — Cloud SQL (Postgres)

```bash
# Create Postgres 16 instance with public IP (POC — simpler, no VPC needed)
gcloud sql instances create accountant-db \
  --database-version=POSTGRES_16 \
  --tier=db-g1-small \
  --edition=ENTERPRISE \
  --region=${REGION} \
  --storage-type=SSD \
  --storage-size=10GB

# Create database
gcloud sql databases create accountant \
  --instance=accountant-db

# Create user (choose a strong password)
gcloud sql users create accountant \
  --instance=accountant-db \
  --password=CHANGE_THIS_PASSWORD

# Get the instance connection name (needed for DATABASE_URL)
gcloud sql instances describe accountant-db \
  --format="value(connectionName)"
```

The connection name looks like: `accountant-agent-498810:us-central1:accountant-db`

**DATABASE_URL format for Cloud Run (Auth Proxy via Unix socket):**
```
postgresql+asyncpg://accountant:CHANGE_THIS_PASSWORD@/accountant?host=/cloudsql/accountant-agent-498810:us-central1:accountant-db
```

> Cloud Run has built-in Cloud SQL Auth Proxy support. Adding `--add-cloudsql-instances` to the deploy command makes the proxy socket available automatically — no sidecar needed, connection is IAM-authenticated and encrypted.

### DB Migration

Run after first deploy. Adds columns added after the initial schema:

```bash
gcloud sql connect accountant-db --user=accountant --database=accountant

# Inside psql:
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name VARCHAR(200);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_id VARCHAR(100);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS drive_folder_id VARCHAR(200);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'whatsapp';
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS drive_file_id VARCHAR(200);
\q
```

---

## Step 5 — Redis on Cloud Run

Run Redis as a Cloud Run service with internal-only ingress. No VPC connector needed — Cloud Run services can call each other internally via `https://<service>-<hash>-<region>.a.run.app`.

```bash
gcloud run deploy accountant-redis \
  --image=redis:7-alpine \
  --platform=managed \
  --region=${REGION} \
  --port=6379 \
  --memory=256Mi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=1 \
  --ingress=internal \
  --args="--save,60,1,--loglevel,warning"

# Get the internal Redis URL
gcloud run services describe accountant-redis \
  --region=${REGION} \
  --format="value(status.url)"
```

> Redis on Cloud Run uses HTTPS internally. The Redis client needs to connect via SSL. The `REDIS_URL` for Cloud Run will be:
> ```
> rediss://:<no-password>@<service-url-without-https>:443/0
> ```
> Note: `rediss://` (double-s) for TLS. No password needed since ingress is internal-only.

---

## Step 6 — Cloud Storage (Receipt Files)

```bash
# Create bucket
gcloud storage buckets create gs://accountant-receipts-${PROJECT_ID} \
  --location=${REGION} \
  --uniform-bucket-level-access

# Make publicly readable (so dashboard can display receipt images/PDFs)
gcloud storage buckets add-iam-policy-binding \
  gs://accountant-receipts-${PROJECT_ID} \
  --member=allUsers \
  --role=roles/storage.objectViewer
```

> Files are served directly from GCS (`storage.googleapis.com`). The dashboard links to them directly. If you want private files served through the API, remove the public binding and add a signed URL endpoint — leave this as a future hardening step.

---

## Step 7 — Google Drive Credentials in Secret Manager

The service account JSON for Google Drive must be stored as a secret and mounted as a file.

```bash
# Store the service account JSON as a secret
gcloud secrets create GOOGLE_CREDENTIALS_JSON \
  --data-file=./accountant-agent-498810-1cbc6f7bf4c0.json \
  --replication-policy=automatic
```

---

## Step 8 — Secret Manager (All Secrets)

```bash
# Helper
create_secret() {
  echo -n "$2" | gcloud secrets create "$1" \
    --data-file=- \
    --replication-policy=automatic
}

# Fill in your actual values
create_secret TWILIO_ACCOUNT_SID      "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
create_secret TWILIO_AUTH_TOKEN       "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
create_secret TWILIO_FROM_NUMBER      "+1415xxxxxxx"
create_secret GEMINI_API_KEY          "AIzaxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
create_secret ANTHROPIC_API_KEY       "sk-ant-xxxxxxxxxxxxxxxxxxxx"
create_secret LLAMA_CLOUD_API_KEY     "llx-xxxxxxxxxxxxxxxxxxxx"
create_secret DATABASE_URL            "postgresql+asyncpg://accountant:CHANGE_THIS_PASSWORD@<PRIVATE_IP>/accountant"
create_secret REDIS_URL               "rediss://<redis-service-url-without-https>:443/0"
create_secret GCS_BUCKET_NAME         "accountant-receipts-${PROJECT_ID}"
create_secret GOOGLE_DRIVE_FOLDER_ID  "your-root-drive-folder-id"
```

---

## Step 9 — Service Account for Cloud Run API

```bash
gcloud iam service-accounts create accountant-api-sa \
  --display-name="Accountant Agent API"

export SA_EMAIL=accountant-api-sa@${PROJECT_ID}.iam.gserviceaccount.com

# Secret Manager access
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"

# Cloud Storage access
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectAdmin"

# Cloud SQL access
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudsql.client"
```

---

## Step 10 — Deploy API to Cloud Run

The Google Drive service account JSON is mounted as a secret volume at `/secrets/credentials.json` — same path as local dev.

```bash
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
  --add-cloudsql-instances=accountant-agent-498810:us-central1:accountant-db \
  --set-secrets=\
TWILIO_ACCOUNT_SID=TWILIO_ACCOUNT_SID:latest,\
TWILIO_AUTH_TOKEN=TWILIO_AUTH_TOKEN:latest,\
TWILIO_FROM_NUMBER=TWILIO_FROM_NUMBER:latest,\
GEMINI_API_KEY=GEMINI_API_KEY:latest,\
ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,\
LLAMA_CLOUD_API_KEY=LLAMA_CLOUD_API_KEY:latest,\
DATABASE_URL=DATABASE_URL:latest,\
REDIS_URL=REDIS_URL:latest,\
GCS_BUCKET_NAME=GCS_BUCKET_NAME:latest,\
GOOGLE_DRIVE_FOLDER_ID=GOOGLE_DRIVE_FOLDER_ID:latest,\
/secrets/credentials.json=GOOGLE_CREDENTIALS_JSON:latest \
  --set-env-vars=ENVIRONMENT=production,GOOGLE_SERVICE_ACCOUNT_FILE=/secrets/credentials.json,DRIVE_POLL_INTERVAL_SECONDS=300

# Save the API URL
export API_URL=$(gcloud run services describe accountant-api \
  --region=${REGION} \
  --format="value(status.url)")
echo "API URL: ${API_URL}"
```

> **`--min-instances=1`** is required. The Drive poller (`asyncio.create_task`) and auto-confirm timers run as background tasks — they need the container to stay alive between requests.

---

## Step 11 — Deploy Dashboard to Cloud Run

The dashboard nginx config proxies `/api/` to the API by hostname (`http://api:8000`) — this only works in Docker Compose. For Cloud Run, we pass the API URL as a build arg so nginx is configured at build time.

### Update nginx.conf to use a build arg

Edit `dashboard/nginx.conf`:

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass API_URL_PLACEHOLDER/api/;
        proxy_set_header Host $proxy_host;
        proxy_ssl_server_name on;
    }

    location /files/ {
        proxy_pass API_URL_PLACEHOLDER/files/;
        proxy_set_header Host $proxy_host;
        proxy_ssl_server_name on;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Update `dashboard/Dockerfile` to substitute the placeholder at build time:

```dockerfile
# Build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# Serve stage
FROM nginx:alpine
ARG API_URL
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN sed -i "s|API_URL_PLACEHOLDER|${API_URL}|g" /etc/nginx/conf.d/default.conf
EXPOSE 80
```

Build and push with your API URL:

```bash
docker build --platform linux/amd64 \
  --build-arg API_URL=${API_URL} \
  -t ${REGISTRY}/dashboard:latest ./dashboard
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

## Step 12 — Run DB Migration

```bash
gcloud sql connect accountant-db --user=accountant --database=accountant

# Inside psql:
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name VARCHAR(200);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_id VARCHAR(100);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS drive_folder_id VARCHAR(200);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'whatsapp';
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS drive_file_id VARCHAR(200);
\q
```

> If this is a fresh database, SQLAlchemy's `create_all` in `init_db()` creates all tables automatically on first startup — no migration needed.

---

## Step 13 — Update Twilio Webhook

Go to [console.twilio.com](https://console.twilio.com) → Messaging → Senders → WhatsApp Sandbox:

- **Webhook URL:** `${API_URL}/webhook`
- **HTTP method:** `POST`

---

## Step 14 — Verify

```bash
# Health check
curl ${API_URL}/health

# Stream logs
gcloud beta run services logs tail accountant-api --region=${REGION}
gcloud beta run services logs tail accountant-redis --region=${REGION}
```

---

## Cost Estimate (Monthly, us-central1)

| Service | Config | Approx. Cost |
|---|---|---|
| Cloud Run — API (min 1 instance) | 1 vCPU, 1GB RAM | ~$15–25/mo |
| Cloud Run — Dashboard | 256MB, scales to 0 | < $1/mo |
| Cloud Run — Redis | 256MB, min 1 instance | ~$5–8/mo |
| Cloud SQL — Postgres | db-f1-micro, 10GB SSD | ~$10/mo |
| Cloud Storage | First 5GB free | < $1/mo |
| Artifact Registry | First 0.5GB free | < $1/mo |
| Secret Manager | First 6 versions free | < $1/mo |
| **Total** | | **~$32–46/mo** |

> Compared to using Memorystore (~$25/mo for Redis), running Redis on Cloud Run saves ~$20/mo.

---

## Redeployment (After Code Changes)

```bash
export PROJECT_ID=accountant-agent-498810
export REGION=us-central1
export REGISTRY=${REGION}-docker.pkg.dev/${PROJECT_ID}/accountant-agent
export API_URL=$(gcloud run services describe accountant-api --region=${REGION} --format="value(status.url)")

# Redeploy API
docker build --platform linux/amd64 -t ${REGISTRY}/api:latest .
docker push ${REGISTRY}/api:latest
gcloud run deploy accountant-api --image=${REGISTRY}/api:latest --region=${REGION} --platform=managed

# Redeploy Dashboard
docker build --platform linux/amd64 --build-arg API_URL=${API_URL} -t ${REGISTRY}/dashboard:latest ./dashboard
docker push ${REGISTRY}/dashboard:latest
gcloud run deploy accountant-dashboard --image=${REGISTRY}/dashboard:latest --region=${REGION} --platform=managed
```

---

## Environment Variables Reference (Production)

| Variable | Source | Notes |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Secret Manager | |
| `TWILIO_AUTH_TOKEN` | Secret Manager | |
| `TWILIO_FROM_NUMBER` | Secret Manager | |
| `GEMINI_API_KEY` | Secret Manager | |
| `ANTHROPIC_API_KEY` | Secret Manager | |
| `LLAMA_CLOUD_API_KEY` | Secret Manager | Present but pipeline bypasses it |
| `DATABASE_URL` | Secret Manager | `postgresql+asyncpg://...@<PRIVATE_IP>/accountant` |
| `REDIS_URL` | Secret Manager | `rediss://<cloud-run-url>:443/0` |
| `GCS_BUCKET_NAME` | Secret Manager | Triggers GCS upload instead of local disk |
| `GOOGLE_DRIVE_FOLDER_ID` | Secret Manager | Root Drive folder for customer folders |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | Env var | `/secrets/credentials.json` |
| `/secrets/credentials.json` | Secret volume | Google service account JSON |
| `ENVIRONMENT` | Env var | `production` — enables Twilio signature validation |
| `DRIVE_POLL_INTERVAL_SECONDS` | Env var | `300` (5 min) for production |

---

## Troubleshooting

**Cloud Run can't reach Cloud SQL**
- Check `--vpc-connector=accountant-connector` is on the API deploy command
- Verify connector and Cloud SQL are in the same region
- Cloud SQL must have no public IP (`--no-assign-ip`)

**Redis connection refused**
- Confirm `accountant-redis` Cloud Run service has `--ingress=internal`
- Use `rediss://` (TLS) not `redis://` — Cloud Run internal traffic is HTTPS
- Check `--min-instances=1` on Redis service so it doesn't spin down

**Twilio signature validation failing (403)**
- `ENVIRONMENT=production` must be set
- Cloud Run forwards the correct `Host` header automatically

**Drive poller not starting**
- Check `GOOGLE_DRIVE_FOLDER_ID` is set in secrets
- Check `/secrets/credentials.json` is mounted correctly
- Check logs: `gcloud beta run services logs tail accountant-api --region=${REGION}`

**Receipt files not showing in dashboard**
- Verify GCS bucket has `allUsers` → `objectViewer` IAM binding
- Check `GCS_BUCKET_NAME` secret is correct
- File URLs will be `https://storage.googleapis.com/<bucket>/receipts/...`

**Background tasks (auto-confirm, Drive poller) dying**
- `--min-instances=1` on the API service prevents container shutdown between requests
- Without this, asyncio background tasks are killed when the container idles

---

## Production VPC Setup (Option B)

Use this instead of the public IP approach when you want Cloud SQL to have **no public IP at all**. Costs ~$6/mo extra for the VPC Access Connector.

### 1. Create VPC and connector

```bash
# Create VPC network
gcloud compute networks create accountant-vpc \
  --subnet-mode=auto

# Allocate IP range for Google-managed services (required for Cloud SQL private IP)
gcloud compute addresses create google-managed-services-accountant-vpc \
  --global \
  --purpose=VPC_PEERING \
  --prefix-length=16 \
  --network=accountant-vpc

# Peer with Google service networking
gcloud services vpc-peerings connect \
  --service=servicenetworking.googleapis.com \
  --ranges=google-managed-services-accountant-vpc \
  --network=accountant-vpc

# Create Serverless VPC Access Connector (allows Cloud Run → Cloud SQL)
gcloud compute networks vpc-access connectors create accountant-connector \
  --network=accountant-vpc \
  --region=${REGION} \
  --range=10.8.0.0/28
```

### 2. Create Cloud SQL with private IP only

```bash
gcloud sql instances create accountant-db \
  --database-version=POSTGRES_16 \
  --tier=db-g1-small \
  --edition=ENTERPRISE \
  --region=${REGION} \
  --network=accountant-vpc \
  --no-assign-ip \
  --storage-type=SSD \
  --storage-size=10GB

# Get private IP
gcloud sql instances describe accountant-db \
  --format="value(ipAddresses[0].ipAddress)"
```

**DATABASE_URL format (direct TCP to private IP):**
```
postgresql+asyncpg://accountant:CHANGE_THIS_PASSWORD@<PRIVATE_IP>/accountant
```

### 3. Deploy API with VPC connector (replace Step 10)

Replace `--add-cloudsql-instances` with `--vpc-connector` in the API deploy command:

```bash
gcloud run deploy accountant-api \
  ... \
  --vpc-connector=accountant-connector \
  --vpc-egress=private-ranges-only \
  # (remove --add-cloudsql-instances)
  ...
```

---

## Cleanup — Delete Everything After Demo

Run these commands to tear down all GCP resources and stop all billing.

```bash
export PROJECT_ID=accountant-agent-498810
export REGION=us-central1

# 1. Delete Cloud Run services
gcloud run services delete accountant-api --region=${REGION} --quiet
gcloud run services delete accountant-dashboard --region=${REGION} --quiet
gcloud run services delete accountant-redis --region=${REGION} --quiet

# 2. Delete Cloud SQL instance (this deletes all databases and data)
gcloud sql instances delete accountant-db --quiet

# 3. Delete GCS bucket and all files
gcloud storage rm -r gs://accountant-receipts-${PROJECT_ID}

# 4. Delete Artifact Registry images
gcloud artifacts repositories delete accountant-agent \
  --location=${REGION} \
  --quiet

# 5. Delete all secrets
gcloud secrets delete TWILIO_ACCOUNT_SID --quiet
gcloud secrets delete TWILIO_AUTH_TOKEN --quiet
gcloud secrets delete TWILIO_FROM_NUMBER --quiet
gcloud secrets delete GEMINI_API_KEY --quiet
gcloud secrets delete ANTHROPIC_API_KEY --quiet
gcloud secrets delete LLAMA_CLOUD_API_KEY --quiet
gcloud secrets delete DATABASE_URL --quiet
gcloud secrets delete REDIS_URL --quiet
gcloud secrets delete GCS_BUCKET_NAME --quiet
gcloud secrets delete GOOGLE_DRIVE_FOLDER_ID --quiet
gcloud secrets delete GOOGLE_CREDENTIALS_JSON --quiet

# 6. Delete service account
gcloud iam service-accounts delete \
  accountant-api-sa@${PROJECT_ID}.iam.gserviceaccount.com --quiet

# 7. Delete VPC connector and network (if created)
gcloud compute networks vpc-access connectors delete accountant-connector \
  --region=${REGION} --quiet
gcloud compute addresses delete google-managed-services-accountant-vpc \
  --global --quiet
gcloud compute networks delete accountant-vpc --quiet
```

> After running cleanup, verify no billable resources remain:
> ```bash
> gcloud run services list --region=${REGION}
> gcloud sql instances list
> gcloud storage buckets list
> ```

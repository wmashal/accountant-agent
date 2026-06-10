from contextlib import asynccontextmanager
import asyncio
import logging
import logging.config
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.routes.webhook import router as webhook_router
from app.routes.health import router as health_router
from app.routes.dashboard import router as dashboard_router
from app.routes.auth import router as auth_router
from app.routes.admin import router as admin_router
from app.db import init_db
from app.config import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)
RECEIPTS_DIR = Path("/app/receipts")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()

    settings = get_settings()
    logger.info(f"Drive config: sa_file={bool(settings.google_service_account_file)} interval={settings.drive_poll_interval_seconds}")
    if settings.google_service_account_file:
        from app.services.drive_poller import poll_drive_forever
        asyncio.create_task(poll_drive_forever())
        logger.info("Drive poller started")
    else:
        logger.warning("Drive poller NOT started — missing GOOGLE_SERVICE_ACCOUNT_FILE")

    yield


app = FastAPI(title="Accountant Agent", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3002",
        "http://localhost:3000",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(webhook_router)
app.include_router(dashboard_router)

# Only serve local receipt files when not using GCS (local dev).
# In production GCS_BUCKET_NAME is set and files are served directly from GCS.
_settings = get_settings()
if not _settings.gcs_bucket_name:
    RECEIPTS_DIR.mkdir(parents=True, exist_ok=True)
    app.mount("/files", StaticFiles(directory=str(RECEIPTS_DIR)), name="files")

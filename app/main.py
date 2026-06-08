from contextlib import asynccontextmanager
import asyncio
import logging
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.routes.webhook import router as webhook_router
from app.routes.health import router as health_router
from app.routes.dashboard import router as dashboard_router
from app.db import init_db
from app.config import get_settings

logger = logging.getLogger(__name__)
RECEIPTS_DIR = Path("/app/receipts")


@asynccontextmanager
async def lifespan(app: FastAPI):
    RECEIPTS_DIR.mkdir(parents=True, exist_ok=True)
    await init_db()

    settings = get_settings()
    if settings.google_drive_folder_id and settings.google_service_account_file:
        from app.services.drive_poller import poll_drive_forever
        asyncio.create_task(poll_drive_forever())
        logger.info("Drive poller started")

    yield


app = FastAPI(title="Accountant Agent", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://127.0.0.1:3001", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(webhook_router)
app.include_router(dashboard_router)
app.mount("/files", StaticFiles(directory=str(RECEIPTS_DIR)), name="files")

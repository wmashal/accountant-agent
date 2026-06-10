import bcrypt
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.middleware.auth import require_admin
from app.models.accountant import Accountant
from app.models.receipt import Customer, Receipt

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin")


# --- Schemas ---

class AccountantOut(BaseModel):
    id: int
    username: str
    display_name: Optional[str]
    company_name: Optional[str]
    logo_url: Optional[str]
    email: Optional[str]
    google_drive_root_folder_id: Optional[str]
    twilio_from_number: Optional[str]
    default_currency: str
    is_active: bool
    created_at: str
    customer_count: int = 0
    receipt_count: int = 0


class CreateAccountantRequest(BaseModel):
    username: str
    password: str
    display_name: Optional[str] = None
    company_name: Optional[str] = None
    email: Optional[str] = None
    google_drive_root_folder_id: Optional[str] = None
    twilio_from_number: Optional[str] = None
    gemini_api_key: Optional[str] = None
    default_currency: str = "USD"


class UpdateAccountantRequest(BaseModel):
    username: Optional[str] = None
    display_name: Optional[str] = None
    company_name: Optional[str] = None
    email: Optional[str] = None
    google_drive_root_folder_id: Optional[str] = None
    twilio_from_number: Optional[str] = None
    gemini_api_key: Optional[str] = None
    default_currency: Optional[str] = None
    is_active: Optional[bool] = None
    new_password: Optional[str] = None


class GlobalStats(BaseModel):
    total_accountants: int
    active_accountants: int
    total_customers: int
    total_receipts: int
    receipts_this_month: int


# --- Helpers ---

async def _accountant_out(a: Accountant, session: AsyncSession) -> AccountantOut:
    customer_count = (await session.execute(
        select(func.count()).where(Customer.accountant_id == a.id)
    )).scalar_one()
    receipt_count = (await session.execute(
        select(func.count()).where(Receipt.accountant_id == a.id)
    )).scalar_one()
    return AccountantOut(
        id=a.id,
        username=a.username,
        display_name=a.display_name,
        company_name=a.company_name,
        logo_url=a.logo_url,
        email=a.email,
        google_drive_root_folder_id=a.google_drive_root_folder_id,
        twilio_from_number=a.twilio_from_number,
        default_currency=a.default_currency,
        is_active=a.is_active,
        created_at=a.created_at.isoformat(),
        customer_count=customer_count,
        receipt_count=receipt_count,
    )


# --- Endpoints ---

@router.get("/stats", response_model=GlobalStats)
async def get_stats(
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_admin),
):
    total_accountants = (await session.execute(select(func.count(Accountant.id)))).scalar_one()
    active_accountants = (await session.execute(
        select(func.count(Accountant.id)).where(Accountant.is_active == True)
    )).scalar_one()
    total_customers = (await session.execute(select(func.count(Customer.id)))).scalar_one()
    total_receipts = (await session.execute(select(func.count(Receipt.id)))).scalar_one()

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    receipts_this_month = (await session.execute(
        select(func.count(Receipt.id)).where(Receipt.created_at >= month_start)
    )).scalar_one()

    return GlobalStats(
        total_accountants=total_accountants,
        active_accountants=active_accountants,
        total_customers=total_customers,
        total_receipts=total_receipts,
        receipts_this_month=receipts_this_month,
    )


@router.get("/accountants", response_model=list[AccountantOut])
async def list_accountants(
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_admin),
):
    result = await session.execute(select(Accountant).order_by(Accountant.created_at.desc()))
    accountants = result.scalars().all()
    return [await _accountant_out(a, session) for a in accountants]


@router.post("/accountants", response_model=AccountantOut)
async def create_accountant(
    body: CreateAccountantRequest,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_admin),
):
    existing = (await session.execute(
        select(Accountant).where(Accountant.username == body.username)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")

    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    accountant = Accountant(
        username=body.username,
        password_hash=pw_hash,
        display_name=body.display_name,
        company_name=body.company_name,
        email=body.email,
        google_drive_root_folder_id=body.google_drive_root_folder_id,
        twilio_from_number=body.twilio_from_number,
        gemini_api_key=body.gemini_api_key,
        default_currency=body.default_currency,
    )
    session.add(accountant)
    await session.commit()
    await session.refresh(accountant)
    return await _accountant_out(accountant, session)


@router.get("/accountants/{accountant_id}", response_model=AccountantOut)
async def get_accountant(
    accountant_id: int,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_admin),
):
    a = (await session.execute(
        select(Accountant).where(Accountant.id == accountant_id)
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="Accountant not found")
    return await _accountant_out(a, session)


@router.patch("/accountants/{accountant_id}", response_model=AccountantOut)
async def update_accountant(
    accountant_id: int,
    body: UpdateAccountantRequest,
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_admin),
):
    a = (await session.execute(
        select(Accountant).where(Accountant.id == accountant_id)
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="Accountant not found")

    if body.username is not None:
        username = body.username.strip()
        if username:
            existing = (await session.execute(
                select(Accountant).where(Accountant.username == username, Accountant.id != accountant_id)
            )).scalar_one_or_none()
            if existing:
                raise HTTPException(status_code=400, detail="Username already taken")
            a.username = username
    if body.display_name is not None:
        a.display_name = body.display_name.strip() or None
    if body.company_name is not None:
        a.company_name = body.company_name.strip() or None
    if body.email is not None:
        a.email = body.email.strip() or None
    if body.google_drive_root_folder_id is not None:
        a.google_drive_root_folder_id = body.google_drive_root_folder_id.strip() or None
    if body.twilio_from_number is not None:
        a.twilio_from_number = body.twilio_from_number.strip() or None
    if body.gemini_api_key is not None:
        a.gemini_api_key = body.gemini_api_key.strip() or None
    if body.default_currency is not None:
        currency = body.default_currency.strip().upper()
        if currency in ("ILS", "USD"):
            a.default_currency = currency
    if body.is_active is not None:
        a.is_active = body.is_active
    if body.new_password:
        a.password_hash = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()

    await session.commit()
    await session.refresh(a)
    return await _accountant_out(a, session)


@router.post("/accountants/{accountant_id}/logo")
async def upload_logo(
    accountant_id: int,
    logo: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    _: dict = Depends(require_admin),
):
    a = (await session.execute(
        select(Accountant).where(Accountant.id == accountant_id)
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="Accountant not found")

    from app.config import get_settings
    settings = get_settings()
    if not settings.gcs_bucket_name:
        raise HTTPException(status_code=500, detail="GCS not configured")

    file_bytes = await logo.read()
    content_type = logo.content_type or "image/png"
    ext_map = {"image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp"}
    ext = ext_map.get(content_type, "png")
    blob_name = f"logos/{accountant_id}/{logo.filename or f'logo.{ext}'}"

    from google.cloud import storage
    client = storage.Client()
    bucket = client.bucket(settings.gcs_bucket_name)
    blob = bucket.blob(blob_name)
    blob.upload_from_string(file_bytes, content_type=content_type)
    logo_url = f"https://storage.googleapis.com/{settings.gcs_bucket_name}/{blob_name}"

    a.logo_url = logo_url
    await session.commit()
    return {"logo_url": logo_url}

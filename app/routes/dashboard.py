import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.db import get_session
from app.middleware.auth import get_current_accountant
from app.models.receipt import Customer, Receipt
from app.services.db_service import create_customer

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/dashboard")


# --- Request / Response schemas ---

class CustomerSummary(BaseModel):
    id: int
    phone_number: str
    display_name: Optional[str]
    company_name: Optional[str]
    company_id: Optional[str]
    drive_folder_id: Optional[str]
    drive_share_link: Optional[str]
    source: str
    default_currency: str
    total_receipts: int
    total_income: float
    total_expense: float
    created_at: str


class ReceiptOut(BaseModel):
    id: int
    message_sid: str
    vendor: Optional[str]
    cost: Optional[float]
    tax: Optional[float]
    tax_rate: Optional[float]
    currency: str
    date: Optional[str]
    upload_date: Optional[str]
    receipt_number: Optional[str]
    receipt_language: Optional[str]
    extraction_model: Optional[str]
    transaction_type: str
    status: str
    file_url: Optional[str]
    drive_file_id: Optional[str]
    created_at: str


class UpdateReceiptRequest(BaseModel):
    vendor: Optional[str] = None
    cost: Optional[float] = None
    tax: Optional[float] = None
    tax_rate: Optional[float] = None
    currency: Optional[str] = None
    date: Optional[str] = None
    receipt_number: Optional[str] = None
    transaction_type: Optional[str] = None
    status: Optional[str] = None


class UpdateCustomerProfileRequest(BaseModel):
    display_name: Optional[str] = None
    company_name: Optional[str] = None
    company_id: Optional[str] = None
    phone_number: Optional[str] = None
    default_currency: Optional[str] = None


class CreateCustomerRequest(BaseModel):
    display_name: str
    company_name: Optional[str] = None
    company_id: Optional[str] = None
    phone_number: Optional[str] = None
    default_currency: str = "USD"


# --- Helpers ---

def _drive_share_link(drive_folder_id: Optional[str]) -> Optional[str]:
    if not drive_folder_id:
        return None
    return f"https://drive.google.com/drive/folders/{drive_folder_id}"


def _customer_summary(c: Customer, receipts: list) -> CustomerSummary:
    confirmed = [r for r in receipts if r.status == "confirmed"]
    income = sum(r.cost or 0 for r in confirmed if r.transaction_type == "income")
    expense = sum(r.cost or 0 for r in confirmed if r.transaction_type == "expense")
    return CustomerSummary(
        id=c.id,
        phone_number=c.phone_number,
        display_name=c.display_name,
        company_name=c.company_name,
        company_id=c.company_id,
        drive_folder_id=c.drive_folder_id,
        drive_share_link=_drive_share_link(c.drive_folder_id),
        source=c.source,
        default_currency=c.default_currency,
        total_receipts=len(receipts),
        total_income=round(income, 2),
        total_expense=round(expense, 2),
        created_at=c.created_at.isoformat(),
    )


# --- Endpoints ---

@router.post("/customers", response_model=CustomerSummary)
async def create_customer_endpoint(
    body: CreateCustomerRequest,
    session: AsyncSession = Depends(get_session),
    current: dict = Depends(get_current_accountant),
):
    """Create a customer from the dashboard and provision a Drive folder if configured."""
    accountant_id = int(current["sub"])

    from app.config import get_settings
    from app.db import SessionLocal
    from app.models.accountant import Accountant
    from sqlalchemy import select as sa_select

    # Load accountant to get their Drive root folder
    async with SessionLocal() as s:
        acc = (await s.execute(sa_select(Accountant).where(Accountant.id == accountant_id))).scalar_one_or_none()
    drive_root = acc.google_drive_root_folder_id if acc else None

    settings = get_settings()
    drive_folder_id = None
    if drive_root and settings.google_service_account_file:
        try:
            from app.services.google_drive import create_customer_folder
            drive_folder_id = await create_customer_folder(
                display_name=body.display_name,
                company_id=body.company_id,
                root_folder_id=drive_root,
            )
        except Exception as e:
            logger.warning(f"Drive folder creation failed (non-fatal): {e}")

    customer = await create_customer(
        session=session,
        display_name=body.display_name,
        company_name=body.company_name,
        company_id=body.company_id,
        phone_number=body.phone_number,
        drive_folder_id=drive_folder_id,
        default_currency=body.default_currency,
        accountant_id=accountant_id,
    )
    return _customer_summary(customer, [])


@router.get("/customers", response_model=list[CustomerSummary])
async def list_customers(
    session: AsyncSession = Depends(get_session),
    current: dict = Depends(get_current_accountant),
):
    accountant_id = int(current["sub"])
    result = await session.execute(
        select(Customer)
        .where(Customer.accountant_id == accountant_id)
        .order_by(Customer.created_at.desc())
    )
    customers = result.scalars().all()

    summaries = []
    for c in customers:
        r = await session.execute(select(Receipt).where(Receipt.customer_id == c.id))
        receipts = r.scalars().all()
        summaries.append(_customer_summary(c, receipts))
    return summaries


@router.get("/customers/{customer_id}/receipts", response_model=list[ReceiptOut])
async def list_customer_receipts(
    customer_id: int,
    session: AsyncSession = Depends(get_session),
    current: dict = Depends(get_current_accountant),
):
    accountant_id = int(current["sub"])
    # Verify the customer belongs to this accountant
    customer = (await session.execute(
        select(Customer).where(Customer.id == customer_id, Customer.accountant_id == accountant_id)
    )).scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    result = await session.execute(
        select(Receipt)
        .where(Receipt.customer_id == customer_id)
        .order_by(Receipt.created_at.desc())
    )
    receipts = result.scalars().all()
    return [
        ReceiptOut(
            id=r.id,
            message_sid=r.message_sid,
            vendor=r.vendor,
            cost=r.cost,
            tax=r.tax,
            tax_rate=r.tax_rate,
            currency=r.currency,
            date=r.date,
            upload_date=r.upload_date.isoformat() if r.upload_date else None,
            receipt_number=r.receipt_number,
            receipt_language=r.receipt_language,
            extraction_model=r.extraction_model,
            transaction_type=r.transaction_type,
            status=r.status,
            file_url=r.file_url,
            drive_file_id=r.drive_file_id,
            created_at=r.created_at.isoformat(),
        )
        for r in receipts
    ]


@router.patch("/receipts/{receipt_id}")
async def update_receipt(
    receipt_id: int,
    body: UpdateReceiptRequest,
    session: AsyncSession = Depends(get_session),
    current: dict = Depends(get_current_accountant),
):
    accountant_id = int(current["sub"])
    result = await session.execute(
        select(Receipt).where(Receipt.id == receipt_id, Receipt.accountant_id == accountant_id)
    )
    receipt = result.scalar_one_or_none()
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")

    if body.vendor is not None:
        receipt.vendor = body.vendor.strip() or receipt.vendor
    if body.cost is not None:
        receipt.cost = body.cost
    if body.tax is not None:
        receipt.tax = body.tax
    if body.tax_rate is not None:
        receipt.tax_rate = body.tax_rate
    if body.currency is not None:
        receipt.currency = body.currency.strip() or receipt.currency
    if body.date is not None:
        receipt.date = body.date.strip() or receipt.date
    if body.receipt_number is not None:
        receipt.receipt_number = body.receipt_number.strip() or None
    if body.transaction_type is not None:
        if body.transaction_type not in ("income", "expense"):
            raise HTTPException(status_code=400, detail="transaction_type must be income or expense")
        receipt.transaction_type = body.transaction_type
    if body.status is not None:
        receipt.status = body.status

    await session.commit()
    return ReceiptOut(
        id=receipt.id,
        message_sid=receipt.message_sid,
        vendor=receipt.vendor,
        cost=receipt.cost,
        tax=receipt.tax,
        tax_rate=receipt.tax_rate,
        currency=receipt.currency,
        date=receipt.date,
        upload_date=receipt.upload_date.isoformat() if receipt.upload_date else None,
        receipt_number=receipt.receipt_number,
        receipt_language=receipt.receipt_language,
        extraction_model=receipt.extraction_model,
        transaction_type=receipt.transaction_type,
        status=receipt.status,
        file_url=receipt.file_url,
        drive_file_id=receipt.drive_file_id,
        created_at=receipt.created_at.isoformat(),
    )


@router.delete("/receipts/{receipt_id}", status_code=204)
async def delete_receipt(
    receipt_id: int,
    session: AsyncSession = Depends(get_session),
    current: dict = Depends(get_current_accountant),
):
    accountant_id = int(current["sub"])
    result = await session.execute(
        select(Receipt).where(Receipt.id == receipt_id, Receipt.accountant_id == accountant_id)
    )
    receipt = result.scalar_one_or_none()
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")

    file_url = receipt.file_url
    drive_file_id = receipt.drive_file_id

    await session.delete(receipt)
    await session.commit()

    if file_url and file_url.startswith("https://storage.googleapis.com/"):
        from app.config import get_settings
        settings = get_settings()
        if settings.gcs_bucket_name:
            from app.services.gcs_storage import delete_receipt as gcs_delete
            await gcs_delete(file_url, settings.gcs_bucket_name)

    if drive_file_id:
        from app.services.google_drive import delete_drive_file
        await delete_drive_file(drive_file_id)


@router.patch("/customers/{customer_id}/profile")
async def update_customer_profile(
    customer_id: int,
    body: UpdateCustomerProfileRequest,
    session: AsyncSession = Depends(get_session),
    current: dict = Depends(get_current_accountant),
):
    accountant_id = int(current["sub"])
    result = await session.execute(
        select(Customer).where(Customer.id == customer_id, Customer.accountant_id == accountant_id)
    )
    customer = result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    if body.display_name is not None:
        customer.display_name = body.display_name.strip() or None
    if body.company_name is not None:
        customer.company_name = body.company_name.strip() or None
    if body.company_id is not None:
        customer.company_id = body.company_id.strip() or None
    if body.phone_number is not None:
        new_phone = body.phone_number.strip()
        if new_phone:
            customer.phone_number = new_phone
            if customer.source == "drive":
                customer.source = "both"
    if body.default_currency is not None:
        currency = body.default_currency.strip().upper()
        if currency in ("ILS", "USD"):
            customer.default_currency = currency
    await session.commit()
    return {"ok": True}

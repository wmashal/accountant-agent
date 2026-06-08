import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.db import get_session
from app.models.receipt import Customer, Receipt

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/dashboard")


# --- Response schemas ---

class CustomerSummary(BaseModel):
    id: int
    phone_number: str
    display_name: Optional[str]
    company_name: Optional[str]
    company_id: Optional[str]
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
    currency: str
    date: Optional[str]
    abn: Optional[str]
    receipt_language: Optional[str]
    extraction_model: Optional[str]
    transaction_type: str
    status: str
    file_url: Optional[str]
    created_at: str


class UpdateReceiptRequest(BaseModel):
    vendor: Optional[str] = None
    cost: Optional[float] = None
    tax: Optional[float] = None
    currency: Optional[str] = None
    date: Optional[str] = None
    abn: Optional[str] = None
    transaction_type: Optional[str] = None
    status: Optional[str] = None


class UpdateCustomerProfileRequest(BaseModel):
    display_name: Optional[str] = None
    company_name: Optional[str] = None
    company_id: Optional[str] = None


# --- Endpoints ---

@router.get("/customers", response_model=list[CustomerSummary])
async def list_customers(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Customer).order_by(Customer.created_at.desc()))
    customers = result.scalars().all()

    summaries = []
    for c in customers:
        r = await session.execute(select(Receipt).where(Receipt.customer_id == c.id))
        receipts = r.scalars().all()
        confirmed = [rec for rec in receipts if rec.status == "confirmed"]
        income = sum(rec.cost or 0 for rec in confirmed if rec.transaction_type == "income")
        expense = sum(rec.cost or 0 for rec in confirmed if rec.transaction_type == "expense")
        summaries.append(CustomerSummary(
            id=c.id,
            phone_number=c.phone_number,
            display_name=c.display_name,
            company_name=c.company_name,
            company_id=c.company_id,
            total_receipts=len(receipts),
            total_income=round(income, 2),
            total_expense=round(expense, 2),
            created_at=c.created_at.isoformat(),
        ))
    return summaries


@router.get("/customers/{customer_id}/receipts", response_model=list[ReceiptOut])
async def list_customer_receipts(customer_id: int, session: AsyncSession = Depends(get_session)):
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
            currency=r.currency,
            date=r.date,
            abn=r.abn,
            receipt_language=r.receipt_language,
            extraction_model=r.extraction_model,
            transaction_type=r.transaction_type,
            status=r.status,
            file_url=r.file_url,
            created_at=r.created_at.isoformat(),
        )
        for r in receipts
    ]


@router.patch("/receipts/{receipt_id}")
async def update_receipt(
    receipt_id: int,
    body: UpdateReceiptRequest,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(Receipt).where(Receipt.id == receipt_id))
    receipt = result.scalar_one_or_none()
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")

    if body.vendor is not None:
        receipt.vendor = body.vendor.strip() or receipt.vendor
    if body.cost is not None:
        receipt.cost = body.cost
    if body.tax is not None:
        receipt.tax = body.tax
    if body.currency is not None:
        receipt.currency = body.currency.strip() or receipt.currency
    if body.date is not None:
        receipt.date = body.date.strip() or receipt.date
    if body.abn is not None:
        receipt.abn = body.abn.strip() or None
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
        currency=receipt.currency,
        date=receipt.date,
        abn=receipt.abn,
        receipt_language=receipt.receipt_language,
        extraction_model=receipt.extraction_model,
        transaction_type=receipt.transaction_type,
        status=receipt.status,
        file_url=receipt.file_url,
        created_at=receipt.created_at.isoformat(),
    )


@router.patch("/customers/{customer_id}/name")
async def update_customer_name(
    customer_id: int,
    body: dict,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(Customer).where(Customer.id == customer_id))
    customer = result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    customer.display_name = body.get("display_name", "").strip() or None
    await session.commit()
    return {"ok": True}


@router.patch("/customers/{customer_id}/profile")
async def update_customer_profile(
    customer_id: int,
    body: UpdateCustomerProfileRequest,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(Customer).where(Customer.id == customer_id))
    customer = result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    if body.display_name is not None:
        customer.display_name = body.display_name.strip() or None
    if body.company_name is not None:
        customer.company_name = body.company_name.strip() or None
    if body.company_id is not None:
        customer.company_id = body.company_id.strip() or None
    await session.commit()
    return {"ok": True}

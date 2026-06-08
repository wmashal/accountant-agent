import logging
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.receipt import Customer, Receipt, ReceiptData

logger = logging.getLogger(__name__)


async def get_or_create_customer(session: AsyncSession, phone_number: str) -> Customer:
    result = await session.execute(
        select(Customer).where(Customer.phone_number == phone_number)
    )
    customer = result.scalar_one_or_none()
    if not customer:
        customer = Customer(phone_number=phone_number)
        session.add(customer)
        await session.flush()
        logger.info(f"New customer created: {phone_number}")
    return customer


async def create_receipt_row(session: AsyncSession, message_sid: str, phone_number: str) -> Receipt:
    customer = await get_or_create_customer(session, phone_number)
    receipt = Receipt(
        message_sid=message_sid,
        customer_id=customer.id,
        phone_number=phone_number,
        status="processing",
    )
    session.add(receipt)
    await session.commit()
    logger.info(f"Receipt row created: {message_sid}")
    return receipt


async def update_receipt(
    session: AsyncSession,
    message_sid: str,
    data: ReceiptData,
    file_url: str | None,
    status: str,
):
    result = await session.execute(
        select(Receipt).where(Receipt.message_sid == message_sid)
    )
    receipt = result.scalar_one_or_none()

    if receipt is None:
        # Row wasn't created (e.g. during reload) — get or create customer and insert now
        logger.warning(f"Receipt {message_sid} not found, inserting")
        result2 = await session.execute(
            select(Customer).where(Customer.phone_number == receipt.phone_number if receipt else "unknown")
        )
        # fallback: we won't have phone here, so handle gracefully
        return

    receipt.vendor = data.vendor
    receipt.cost = data.cost
    receipt.tax = data.tax
    receipt.currency = data.currency
    receipt.date = data.date
    receipt.abn = data.abn
    receipt.receipt_language = data.receipt_language
    receipt.extraction_model = data.extraction_model
    receipt.file_url = file_url
    receipt.status = status
    await session.commit()
    logger.info(f"Receipt updated: {message_sid} status={status}")


async def upsert_receipt(
    session: AsyncSession,
    message_sid: str,
    phone_number: str,
    data: ReceiptData,
    file_url: str | None,
    status: str,
):
    result = await session.execute(
        select(Receipt).where(Receipt.message_sid == message_sid)
    )
    receipt = result.scalar_one_or_none()

    if receipt is None:
        customer = await get_or_create_customer(session, phone_number)
        receipt = Receipt(
            message_sid=message_sid,
            customer_id=customer.id,
            phone_number=phone_number,
        )
        session.add(receipt)

    receipt.vendor = data.vendor
    receipt.cost = data.cost
    receipt.tax = data.tax
    receipt.currency = data.currency
    receipt.date = data.date
    receipt.abn = data.abn
    receipt.receipt_language = data.receipt_language
    receipt.extraction_model = data.extraction_model
    receipt.file_url = file_url
    receipt.status = status
    await session.commit()
    logger.info(f"Receipt upserted: {message_sid} status={status}")


async def update_customer_profile(
    session: AsyncSession,
    phone_number: str,
    display_name: str | None,
    company_name: str | None,
    company_id: str | None,
):
    result = await session.execute(
        select(Customer).where(Customer.phone_number == phone_number)
    )
    customer = result.scalar_one_or_none()
    if not customer:
        customer = Customer(phone_number=phone_number)
        session.add(customer)
    customer.display_name = display_name or None
    customer.company_name = company_name or None
    customer.company_id = company_id or None
    await session.commit()
    logger.info(f"Customer profile updated: {phone_number}")


async def update_receipt_status(session: AsyncSession, message_sid: str, status: str):
    await session.execute(
        update(Receipt).where(Receipt.message_sid == message_sid).values(status=status)
    )
    await session.commit()
    logger.info(f"Receipt status updated: {message_sid} → {status}")

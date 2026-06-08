import logging
import uuid
from sqlalchemy import select, update, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.receipt import Customer, Receipt, ReceiptData

logger = logging.getLogger(__name__)


async def find_customer_by_identity(
    session: AsyncSession,
    phone_number: str,
    company_id: str | None = None,
) -> Customer | None:
    """
    Look up a customer by phone number OR company_id (if provided and non-empty).
    Returns the first match, or None.
    """
    conditions = [Customer.phone_number == phone_number]
    if company_id:
        conditions.append(
            (Customer.company_id == company_id) & Customer.company_id.isnot(None)
        )
    result = await session.execute(
        select(Customer).where(or_(*conditions))
    )
    return result.scalars().first()


async def get_or_create_customer(session: AsyncSession, phone_number: str) -> Customer:
    customer = await find_customer_by_identity(session, phone_number)
    if not customer:
        customer = Customer(phone_number=phone_number)
        session.add(customer)
        await session.flush()
        logger.info(f"New customer created: {phone_number}")
    return customer


async def create_customer(
    session: AsyncSession,
    display_name: str | None,
    company_name: str | None,
    company_id: str | None,
    phone_number: str | None,
    drive_folder_id: str | None,
    default_currency: str = "USD",
) -> Customer:
    """Create a customer from the dashboard. Phone is optional for Drive-only customers."""
    effective_phone = phone_number or f"drive_{uuid.uuid4().hex[:12]}"
    customer = Customer(
        phone_number=effective_phone,
        display_name=display_name,
        company_name=company_name,
        company_id=company_id,
        drive_folder_id=drive_folder_id,
        source="drive" if not phone_number else "both",
        default_currency=default_currency,
    )
    session.add(customer)
    await session.commit()
    await session.refresh(customer)
    logger.info(f"Dashboard customer created: id={customer.id} name={display_name}")
    return customer


async def get_processed_drive_file_ids(session: AsyncSession, customer_id: int) -> set[str]:
    """Return all drive_file_ids already stored for this customer (for dedup)."""
    result = await session.execute(
        select(Receipt.drive_file_id).where(
            Receipt.customer_id == customer_id,
            Receipt.drive_file_id.isnot(None),
        )
    )
    return {row[0] for row in result.all()}


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
        logger.warning(f"Receipt {message_sid} not found, skipping update")
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
    receipt.transaction_type = data.transaction_type
    receipt.file_url = file_url
    receipt.status = status
    await session.commit()
    logger.info(f"Receipt upserted: {message_sid} status={status}")


async def upsert_receipt_from_drive(
    session: AsyncSession,
    message_sid: str,
    customer_id: int,
    data: ReceiptData,
    file_url: str | None,
    drive_file_id: str,
):
    """Upsert a receipt sourced from Google Drive. Auto-confirmed, no phone number needed."""
    result = await session.execute(
        select(Receipt).where(Receipt.message_sid == message_sid)
    )
    receipt = result.scalar_one_or_none()

    if receipt is None:
        receipt = Receipt(
            message_sid=message_sid,
            customer_id=customer_id,
            phone_number=f"drive_{customer_id}",
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
    receipt.transaction_type = data.transaction_type
    receipt.file_url = file_url
    receipt.drive_file_id = drive_file_id
    receipt.status = "confirmed"
    await session.commit()
    logger.info(f"Drive receipt upserted: {message_sid} drive_file_id={drive_file_id}")


async def update_customer_profile(
    session: AsyncSession,
    phone_number: str,
    display_name: str | None,
    company_name: str | None,
    company_id: str | None,
):
    # Try to find existing customer by phone OR company_id
    customer = await find_customer_by_identity(session, phone_number, company_id or None)
    if not customer:
        customer = Customer(phone_number=phone_number)
        session.add(customer)
    else:
        # If matched by company_id but phone differs, update phone and mark as both
        if customer.phone_number != phone_number:
            logger.info(f"Matched existing customer id={customer.id} via company_id={company_id}, linking phone {phone_number}")
            customer.phone_number = phone_number
            customer.source = "both"
    customer.display_name = display_name or customer.display_name or None
    customer.company_name = company_name or customer.company_name or None
    customer.company_id = company_id or customer.company_id or None
    await session.commit()
    logger.info(f"Customer profile updated: id={customer.id} phone={phone_number}")


async def update_receipt_status(session: AsyncSession, message_sid: str, status: str):
    await session.execute(
        update(Receipt).where(Receipt.message_sid == message_sid).values(status=status)
    )
    await session.commit()
    logger.info(f"Receipt status updated: {message_sid} → {status}")

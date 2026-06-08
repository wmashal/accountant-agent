import asyncio
import logging

from app.config import get_settings
from app.db import SessionLocal
from app.models.receipt import Customer
from app.pipeline.process_receipt import process_single_receipt_from_drive
from app.services.db_service import get_processed_drive_file_ids
from app.services.google_drive import RECEIPT_MIME_TYPES, download_file, list_folder_files, move_to_processed
from sqlalchemy import select

logger = logging.getLogger(__name__)


async def poll_drive_forever():
    """Background task: poll all customer Drive folders on a fixed interval."""
    settings = get_settings()
    interval = settings.drive_poll_interval_seconds
    logger.info(f"Drive poller started — interval={interval}s")
    while True:
        try:
            await poll_all_customers()
        except Exception as e:
            logger.error(f"Drive poll cycle error: {e}", exc_info=True)
        await asyncio.sleep(interval)


async def poll_all_customers():
    """Fetch all customers with a drive_folder_id and poll each one."""
    async with SessionLocal() as session:
        result = await session.execute(
            select(Customer).where(Customer.drive_folder_id.isnot(None))
        )
        customers = result.scalars().all()

    for customer in customers:
        try:
            await poll_customer_folder(customer)
        except Exception as e:
            logger.error(f"Error polling Drive folder for customer {customer.id}: {e}", exc_info=True)


async def poll_customer_folder(customer: Customer):
    """Poll one customer's Drive folder for new receipt files."""
    folder_id = customer.drive_folder_id

    # Get IDs of files we've already processed (to avoid reprocessing)
    async with SessionLocal() as session:
        already_processed = await get_processed_drive_file_ids(session, customer.id)

    # List all files in their Drive folder (sync Drive API call — run in thread)
    loop = asyncio.get_event_loop()
    files = await loop.run_in_executor(None, list_folder_files, folder_id)

    new_files = [
        f for f in files
        if f["id"] not in already_processed
        and f.get("mimeType") in RECEIPT_MIME_TYPES
    ]

    if not new_files:
        return

    logger.info(f"Customer {customer.id}: found {len(new_files)} new Drive file(s)")

    for file_info in new_files:
        file_id = file_info["id"]
        try:
            # Download the file (sync Drive API call — run in thread)
            file_bytes, content_type = await loop.run_in_executor(None, download_file, file_id)

            await process_single_receipt_from_drive(
                file_bytes=file_bytes,
                content_type=content_type,
                customer=customer,
                drive_file_id=file_id,
            )

            # Move to processed/ subfolder so the user sees what's been handled
            await move_to_processed(file_id, folder_id)

        except Exception as e:
            logger.error(f"Failed to process Drive file {file_id} for customer {customer.id}: {e}", exc_info=True)

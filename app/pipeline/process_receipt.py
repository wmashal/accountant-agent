import asyncio
import io
import json
import logging
from app.pipeline.ocr import fetch_media, ocr_pdf
from app.pipeline.extract import extract
from app.pipeline.normalize import normalize
from app.services.local_storage import upload_receipt
from app.services.db_service import upsert_receipt, upsert_receipt_from_drive, update_receipt_status
from app.services.twilio_client import send_summary, send_error, send_confirm_prompt
from app.services.redis_client import get_redis
from app.db import SessionLocal

logger = logging.getLogger(__name__)

# Grace period: wait this long after the last job finishes before sending confirm prompt.
# Handles Twilio sending separate webhook calls for each file attachment.
BATCH_SETTLE_SECONDS = 15

# Auto-confirm delay in seconds (5 minutes)
AUTO_CONFIRM_SECONDS = 5 * 60


async def _maybe_send_confirm(from_number: str):
    """Called after each receipt finishes. Waits for the batch to settle, then sends confirm prompt."""
    await asyncio.sleep(BATCH_SETTLE_SECONDS)

    redis = await get_redis()
    # Check if any jobs are still running
    remaining = await redis.get(f"processing:{from_number}")
    remaining = int(remaining) if remaining else 0
    if remaining > 0:
        logger.info(f"Batch still processing ({remaining} remaining) for {from_number}, skipping confirm")
        return

    # All done — send confirm prompt if there are pending SIDs
    pending_raw = await redis.get(f"pending:{from_number}")
    if not pending_raw:
        return

    sids = json.loads(pending_raw)
    if isinstance(sids, str):
        sids = [sids]

    logger.info(f"Batch complete for {from_number}, sending confirm prompt for {len(sids)} receipt(s)")
    send_confirm_prompt(from_number, len(sids))

    # Schedule auto-confirm after 5 minutes if user doesn't reply
    asyncio.create_task(_auto_confirm(from_number))


async def _auto_confirm(from_number: str):
    """Auto-confirm all pending receipts after AUTO_CONFIRM_SECONDS if user hasn't replied."""
    await asyncio.sleep(AUTO_CONFIRM_SECONDS)

    redis = await get_redis()
    pending_raw = await redis.get(f"pending:{from_number}")
    if not pending_raw:
        # Already confirmed/rejected by user
        return

    sids = json.loads(pending_raw)
    if isinstance(sids, str):
        sids = [sids]

    logger.info(f"Auto-confirming {len(sids)} receipt(s) for {from_number} after timeout")
    async with SessionLocal() as session:
        for sid in sids:
            await update_receipt_status(session, sid, "confirmed")

    await redis.delete(f"pending:{from_number}")

    from app.services.twilio_client import _send
    _send(from_number, f"✅ {len(sids)} receipt(s) auto-confirmed after 5 minutes.")


async def process_single_receipt(
    message_sid: str,
    from_number: str,
    file_bytes: bytes,
    content_type: str,
):
    """Process one receipt file (image or single-page PDF equivalent)."""
    logger.info(f"Processing receipt: {message_sid} type={content_type}")

    async with SessionLocal() as session:
        try:
            # Extract — PDFs go directly to Gemini Vision (no LlamaParse)
            ocr_text = None
            raw_result, model = await extract(file_bytes, content_type, ocr_text=None)
            logger.info(f"Extraction complete: model={model} vendor={raw_result.get('vendor')} cost={raw_result.get('cost')}")

            # Normalize
            data = normalize(raw_result, extraction_model=model, raw_ocr=ocr_text)
            logger.info(f"Normalized: {data.vendor} {data.cost} {data.currency}")

            # Save file
            file_url = await upload_receipt(file_bytes, from_number, message_sid, content_type)
            logger.info(f"File URL: {file_url}")

            # Upsert to Postgres
            await upsert_receipt(session, message_sid, from_number, data, file_url, "pending_confirmation")

            # WhatsApp summary (no confirm prompt — sent separately after all receipts done)
            logger.info(f"Sending WhatsApp summary to {from_number}")
            send_summary(from_number, data, file_url)

            logger.info(f"Receipt processed successfully: {message_sid}")

        except Exception as e:
            logger.error(f"Failed to process receipt {message_sid}: {e}", exc_info=True)
            try:
                await update_receipt_status(session, message_sid, "error")
                send_error(from_number)
            except Exception as inner:
                logger.error(f"Failed to send error notification: {inner}")

    # Decrement batch counter
    redis = await get_redis()
    remaining = await redis.decr(f"processing:{from_number}")
    logger.info(f"Batch counter for {from_number}: {remaining} remaining")

    # Schedule a settle-and-confirm check (runs after BATCH_SETTLE_SECONDS)
    asyncio.create_task(_maybe_send_confirm(from_number))


async def process_receipt(
    message_sid: str,
    from_number: str,
    media_url: str,
    content_type: str,
):
    """Download media and dispatch to process_single_receipt, splitting multi-page PDFs."""
    file_bytes = await fetch_media(media_url)

    if "pdf" in content_type:
        try:
            from pypdf import PdfReader, PdfWriter

            reader = PdfReader(io.BytesIO(file_bytes))
            num_pages = len(reader.pages)

            if num_pages > 1:
                logger.info(f"Multi-page PDF detected: {message_sid} ({num_pages} pages)")
                # Increase counter by extra pages (we already counted 1 for this job in webhook)
                redis = await get_redis()
                await redis.incrby(f"processing:{from_number}", num_pages - 1)
                for page_num in range(num_pages):
                    writer = PdfWriter()
                    writer.add_page(reader.pages[page_num])
                    buf = io.BytesIO()
                    writer.write(buf)
                    page_bytes = buf.getvalue()
                    page_sid = f"{message_sid}_p{page_num + 1}"
                    await process_single_receipt(page_sid, from_number, page_bytes, content_type)
                return
        except Exception as e:
            logger.warning(f"PDF page split failed ({e}), processing as single receipt")

    await process_single_receipt(message_sid, from_number, file_bytes, content_type)


async def process_single_receipt_from_drive(
    file_bytes: bytes,
    content_type: str,
    customer,
    drive_file_id: str,
):
    """Process a receipt file sourced from Google Drive.
    No Twilio messages, no Redis counter — auto-confirmed immediately.
    """
    import uuid
    message_sid = f"drive_{drive_file_id[:40]}"
    logger.info(f"Processing Drive receipt: file_id={drive_file_id} customer={customer.id} type={content_type}")

    if "pdf" in content_type:
        try:
            from pypdf import PdfReader, PdfWriter
            reader = PdfReader(io.BytesIO(file_bytes))
            num_pages = len(reader.pages)
            if num_pages > 1:
                logger.info(f"Multi-page Drive PDF: {num_pages} pages (file_id={drive_file_id})")
                for page_num in range(num_pages):
                    writer = PdfWriter()
                    writer.add_page(reader.pages[page_num])
                    buf = io.BytesIO()
                    writer.write(buf)
                    page_bytes = buf.getvalue()
                    page_sid = f"drive_{drive_file_id[:36]}_p{page_num + 1}"
                    await _process_drive_single_page(page_bytes, content_type, customer, drive_file_id, page_sid)
                return
        except Exception as e:
            logger.warning(f"Drive PDF split failed ({e}), processing as single page")

    await _process_drive_single_page(file_bytes, content_type, customer, drive_file_id, message_sid)


async def _process_drive_single_page(
    file_bytes: bytes,
    content_type: str,
    customer,
    drive_file_id: str,
    message_sid: str,
):
    """Internal: extract + save one Drive receipt page."""
    async with SessionLocal() as session:
        try:
            raw_result, model = await extract(file_bytes, content_type, ocr_text=None)
            logger.info(f"Drive extraction: model={model} vendor={raw_result.get('vendor')} cost={raw_result.get('cost')}")

            data = normalize(raw_result, extraction_model=model, raw_ocr=None)

            # Store file locally (same as WhatsApp path)
            phone_key = f"drive_{customer.id}"
            file_url = await upload_receipt(file_bytes, phone_key, message_sid, content_type)

            # Upsert — auto-confirmed, no confirmation step needed
            await upsert_receipt_from_drive(
                session=session,
                message_sid=message_sid,
                customer_id=customer.id,
                data=data,
                file_url=file_url,
                drive_file_id=drive_file_id,
            )
            logger.info(f"Drive receipt saved: {message_sid}")

        except Exception as e:
            logger.error(f"Failed to process Drive receipt {message_sid}: {e}", exc_info=True)

import asyncio
import io
import json
import logging
from app.pipeline.ocr import fetch_media, ocr_pdf
from app.pipeline.extract import extract
from app.pipeline.normalize import normalize
from app.config import get_settings as _get_settings


async def upload_receipt(file_bytes: bytes, phone_number: str, message_sid: str, content_type: str) -> str | None:
    """Route to GCS or local storage depending on config."""
    settings = _get_settings()
    if settings.gcs_bucket_name:
        from app.services.gcs_storage import upload_receipt as gcs_upload
        return await gcs_upload(file_bytes, phone_number, message_sid, content_type, settings.gcs_bucket_name)
    from app.services.local_storage import upload_receipt as local_upload
    return await local_upload(file_bytes, phone_number, message_sid, content_type)
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


async def _maybe_send_confirm(from_number: str, twilio_from_number: str, accountant_id: int):
    """Called after each receipt finishes. Waits for the batch to settle, then sends confirm prompt."""
    await asyncio.sleep(BATCH_SETTLE_SECONDS)

    redis = await get_redis()
    remaining = await redis.get(f"processing:{accountant_id}:{from_number}")
    remaining = int(remaining) if remaining else 0
    if remaining > 0:
        logger.info(f"Batch still processing ({remaining} remaining) for {from_number}, skipping confirm")
        return

    pending_raw = await redis.get(f"pending:{accountant_id}:{from_number}")
    if not pending_raw:
        return

    sids = json.loads(pending_raw)
    if isinstance(sids, str):
        sids = [sids]

    logger.info(f"Batch complete for {from_number}, sending confirm prompt for {len(sids)} receipt(s)")
    send_confirm_prompt(from_number, len(sids), twilio_from_number)

    asyncio.create_task(_auto_confirm(from_number, twilio_from_number, accountant_id))


async def _auto_confirm(from_number: str, twilio_from_number: str, accountant_id: int):
    """Auto-confirm all pending receipts after AUTO_CONFIRM_SECONDS if user hasn't replied."""
    await asyncio.sleep(AUTO_CONFIRM_SECONDS)

    redis = await get_redis()
    pending_raw = await redis.get(f"pending:{accountant_id}:{from_number}")
    if not pending_raw:
        return

    sids = json.loads(pending_raw)
    if isinstance(sids, str):
        sids = [sids]

    logger.info(f"Auto-confirming {len(sids)} receipt(s) for {from_number} after timeout")
    async with SessionLocal() as session:
        for sid in sids:
            await update_receipt_status(session, sid, "confirmed")

    await redis.delete(f"pending:{accountant_id}:{from_number}")

    from app.services.twilio_client import _send
    _send(from_number, f"✅ {len(sids)} receipt(s) auto-confirmed after 5 minutes.", twilio_from_number)


async def process_single_receipt(
    message_sid: str,
    from_number: str,
    file_bytes: bytes,
    content_type: str,
    accountant_id: int,
    twilio_from_number: str,
):
    """Process one receipt file (image or single-page PDF equivalent)."""
    logger.info(f"Processing receipt: {message_sid} type={content_type}")

    async with SessionLocal() as session:
        try:
            ocr_text = None
            raw_result, model = await extract(file_bytes, content_type, ocr_text=None)
            logger.info(f"Extraction complete: model={model} vendor={raw_result.get('vendor')} cost={raw_result.get('cost')}")

            from app.models.receipt import Customer
            from sqlalchemy import select as sa_select
            cust = await session.execute(
                sa_select(Customer).where(
                    Customer.phone_number == from_number,
                    Customer.accountant_id == accountant_id,
                )
            )
            customer = cust.scalar_one_or_none()
            default_currency = customer.default_currency if customer else "USD"
            customer_identity = {customer.company_id, customer.company_name, customer.display_name} if customer else set()

            data = normalize(raw_result, extraction_model=model, raw_ocr=ocr_text, default_currency=default_currency, customer_identity=customer_identity)
            logger.info(f"Normalized: {data.vendor} {data.cost} {data.currency}")

            file_url = await upload_receipt(file_bytes, from_number, message_sid, content_type)
            logger.info(f"File URL: {file_url}")

            await upsert_receipt(session, message_sid, from_number, data, file_url, "pending_confirmation", accountant_id)

            logger.info(f"Sending WhatsApp summary to {from_number}")
            send_summary(from_number, data, file_url, twilio_from_number)

            logger.info(f"Receipt processed successfully: {message_sid}")

        except Exception as e:
            logger.error(f"Failed to process receipt {message_sid}: {e}", exc_info=True)
            try:
                await update_receipt_status(session, message_sid, "error")
                send_error(from_number, twilio_from_number)
            except Exception as inner:
                logger.error(f"Failed to send error notification: {inner}")

    redis = await get_redis()
    remaining = await redis.decr(f"processing:{accountant_id}:{from_number}")
    logger.info(f"Batch counter for {from_number}: {remaining} remaining")

    asyncio.create_task(_maybe_send_confirm(from_number, twilio_from_number, accountant_id))


def _group_consecutive_pages(
    page_invoice_numbers: list[str | None],
    reader,
) -> list[tuple[str | None, bytes]]:
    """Group consecutive pages that share the same invoice number.

    Returns a list of (invoice_number_or_None, merged_pdf_bytes) — one entry per
    invoice group.  Pages with None invoice numbers or unique numbers are each their
    own single-page group.  Consecutive pages that share a non-None invoice number
    are merged into one multi-page PDF so the AI sees the full invoice.
    """
    from pypdf import PdfWriter

    groups: list[tuple[str | None, list[int]]] = []
    for idx, inv_num in enumerate(page_invoice_numbers):
        if inv_num and groups and groups[-1][0] == inv_num:
            groups[-1][1].append(idx)
        else:
            groups.append((inv_num, [idx]))

    result: list[tuple[str | None, bytes]] = []
    for inv_num, page_indices in groups:
        writer = PdfWriter()
        for pi in page_indices:
            writer.add_page(reader.pages[pi])
        buf = io.BytesIO()
        writer.write(buf)
        result.append((inv_num, buf.getvalue()))
    return result


async def process_receipt(
    message_sid: str,
    from_number: str,
    media_url: str,
    content_type: str,
    accountant_id: int,
    twilio_from_number: str,
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

                page_bytes_list: list[bytes] = []
                for page_num in range(num_pages):
                    writer = PdfWriter()
                    writer.add_page(reader.pages[page_num])
                    buf = io.BytesIO()
                    writer.write(buf)
                    page_bytes_list.append(buf.getvalue())

                page_invoice_numbers: list[str | None] = []
                for pb in page_bytes_list:
                    try:
                        raw, _ = await extract(pb, content_type, ocr_text=None)
                        inv_num = str(raw.get("receipt_number") or "").strip() or None
                        page_invoice_numbers.append(inv_num)
                    except Exception:
                        page_invoice_numbers.append(None)

                logger.info(f"Page invoice numbers: {page_invoice_numbers}")

                groups = _group_consecutive_pages(page_invoice_numbers, reader)
                logger.info(f"Invoice groups: {[(inv, len(b)) for inv, b in groups]}")

                if len(groups) == 1:
                    inv_label = groups[0][0] or "unknown"
                    logger.info(f"All {num_pages} pages form a single invoice '{inv_label}' → processing merged PDF")
                    await process_single_receipt(message_sid, from_number, groups[0][1], content_type, accountant_id, twilio_from_number)
                    return

                redis = await get_redis()
                await redis.incrby(f"processing:{accountant_id}:{from_number}", len(groups) - 1)
                for g_idx, (inv_num, group_bytes) in enumerate(groups):
                    group_sid = f"{message_sid}_g{g_idx + 1}"
                    logger.info(f"Processing group {g_idx + 1}/{len(groups)} invoice='{inv_num}' sid={group_sid}")
                    await process_single_receipt(group_sid, from_number, group_bytes, content_type, accountant_id, twilio_from_number)
                return
        except Exception as e:
            logger.warning(f"PDF page split failed ({e}), processing as single receipt")

    await process_single_receipt(message_sid, from_number, file_bytes, content_type, accountant_id, twilio_from_number)


async def process_single_receipt_from_drive(
    file_bytes: bytes,
    content_type: str,
    customer,
    drive_file_id: str,
    accountant_id: int,
):
    """Process a receipt file sourced from Google Drive.
    No Twilio messages, no Redis counter — auto-confirmed immediately.
    """
    message_sid = f"drive_{drive_file_id[:40]}"
    logger.info(f"Processing Drive receipt: file_id={drive_file_id} customer={customer.id} type={content_type}")

    if "pdf" in content_type:
        try:
            from pypdf import PdfReader, PdfWriter
            reader = PdfReader(io.BytesIO(file_bytes))
            num_pages = len(reader.pages)
            if num_pages > 1:
                logger.info(f"Multi-page Drive PDF: {num_pages} pages (file_id={drive_file_id})")

                page_bytes_list: list[bytes] = []
                for page_num in range(num_pages):
                    writer = PdfWriter()
                    writer.add_page(reader.pages[page_num])
                    buf = io.BytesIO()
                    writer.write(buf)
                    page_bytes_list.append(buf.getvalue())

                page_invoice_numbers: list[str | None] = []
                for pb in page_bytes_list:
                    try:
                        raw, _ = await extract(pb, content_type, ocr_text=None)
                        inv_num = str(raw.get("receipt_number") or "").strip() or None
                        page_invoice_numbers.append(inv_num)
                    except Exception:
                        page_invoice_numbers.append(None)

                logger.info(f"Drive page invoice numbers: {page_invoice_numbers}")

                groups = _group_consecutive_pages(page_invoice_numbers, reader)
                logger.info(f"Drive invoice groups: {[(inv, len(b)) for inv, b in groups]}")

                if len(groups) == 1:
                    inv_label = groups[0][0] or "unknown"
                    logger.info(f"Drive: all {num_pages} pages form single invoice '{inv_label}' → merged PDF")
                    return await _process_drive_single_page(groups[0][1], content_type, customer, drive_file_id, message_sid, accountant_id)

                last_data = None
                for g_idx, (inv_num, group_bytes) in enumerate(groups):
                    group_sid = f"drive_{drive_file_id[:36]}_g{g_idx + 1}"
                    logger.info(f"Drive group {g_idx + 1}/{len(groups)} invoice='{inv_num}' sid={group_sid}")
                    last_data = await _process_drive_single_page(group_bytes, content_type, customer, drive_file_id, group_sid, accountant_id)
                return last_data
        except Exception as e:
            logger.warning(f"Drive PDF split failed ({e}), processing as single page")

    return await _process_drive_single_page(file_bytes, content_type, customer, drive_file_id, message_sid, accountant_id)


async def _process_drive_single_page(
    file_bytes: bytes,
    content_type: str,
    customer,
    drive_file_id: str,
    message_sid: str,
    accountant_id: int,
):
    """Internal: extract + save one Drive receipt page. Returns ReceiptData (or None on error)."""
    async with SessionLocal() as session:
        try:
            raw_result, model = await extract(file_bytes, content_type, ocr_text=None)
            logger.info(f"Drive extraction: model={model} vendor={raw_result.get('vendor')} cost={raw_result.get('cost')}")

            customer_identity = {customer.company_id, customer.company_name, customer.display_name}
            raw_text = " ".join(str(v) for v in raw_result.values() if v)
            data = normalize(raw_result, extraction_model=model, raw_ocr=raw_text, default_currency=customer.default_currency, customer_identity=customer_identity)

            phone_key = f"drive_{customer.id}"
            file_url = await upload_receipt(file_bytes, phone_key, message_sid, content_type)

            await upsert_receipt_from_drive(
                session=session,
                message_sid=message_sid,
                customer_id=customer.id,
                data=data,
                file_url=file_url,
                drive_file_id=drive_file_id,
                accountant_id=accountant_id,
            )
            logger.info(f"Drive receipt saved: {message_sid}")
            return data

        except Exception as e:
            logger.error(f"Failed to process Drive receipt {message_sid}: {e}", exc_info=True)
            return None

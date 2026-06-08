import json
import logging
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from twilio.request_validator import RequestValidator

from app.config import get_settings
from app.pipeline.process_receipt import process_receipt
from app.services.db_service import (
    create_receipt_row,
    get_or_create_customer,
    update_customer_profile,
    update_receipt_status,
)
from app.services.redis_client import get_redis
from app.services.twilio_client import (
    send_registration_ask_name,
    send_registration_ask_id,
    send_registration_welcome,
)
from app.db import SessionLocal

logger = logging.getLogger(__name__)
router = APIRouter()


async def validate_twilio_signature(request: Request):
    settings = get_settings()
    if settings.environment == "development":
        return
    validator = RequestValidator(settings.twilio_auth_token)
    signature = request.headers.get("X-Twilio-Signature", "")
    url = str(request.url)
    form = await request.form()
    params = dict(form)
    if not validator.validate(url, params, signature):
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")


async def _is_registered(phone_number: str) -> bool:
    """Return True if the customer exists and has completed registration (has display_name)."""
    async with SessionLocal() as session:
        from sqlalchemy import select
        from app.models.receipt import Customer
        result = await session.execute(
            select(Customer).where(Customer.phone_number == phone_number)
        )
        customer = result.scalar_one_or_none()
        return customer is not None and customer.display_name is not None


@router.post("/webhook")
async def webhook(request: Request, background_tasks: BackgroundTasks):
    await validate_twilio_signature(request)
    form = await request.form()

    message_sid = form.get("MessageSid", "")
    from_number = form.get("From", "")
    num_media = int(form.get("NumMedia", 0))
    body = form.get("Body", "").strip()
    body_lower = body.lower()

    redis = await get_redis()

    # --- Check registration state machine ---
    reg_key = f"reg:{from_number}"
    reg_raw = await redis.get(reg_key)
    reg_state = json.loads(reg_raw) if reg_raw else None

    if reg_state:
        step = reg_state.get("step")

        # If a media file arrives while registration is in progress, just queue it silently
        if num_media > 0:
            pending_key = f"pending_media:{from_number}"
            pending_raw = await redis.get(pending_key)
            pending = json.loads(pending_raw) if pending_raw else []
            for i in range(num_media):
                pending.append({
                    "message_sid": f"{message_sid}_{i}",
                    "media_url": form.get(f"MediaUrl{i}", ""),
                    "content_type": form.get(f"MediaContentType{i}", ""),
                })
            await redis.set(pending_key, json.dumps(pending), ex=3600)
            logger.info(f"Queued {num_media} media item(s) during registration for {from_number}")
            return Response(content="", media_type="text/xml", status_code=200)

        if step == "awaiting_name":
            # Accept anything — name, company name, or both
            reg_state["name"] = body
            reg_state["step"] = "awaiting_id"
            await redis.set(reg_key, json.dumps(reg_state), ex=3600)
            send_registration_ask_id(from_number, body)
            return Response(content="", media_type="text/xml", status_code=200)

        if step == "awaiting_company":
            # Legacy step — should not occur but handle gracefully
            reg_state["company_name"] = body
            reg_state["step"] = "awaiting_id"
            await redis.set(reg_key, json.dumps(reg_state), ex=3600)
            send_registration_ask_id(from_number, reg_state.get("name", ""))
            return Response(content="", media_type="text/xml", status_code=200)

        if step == "awaiting_id":
            company_id = body if body_lower != "skip" else ""
            name = reg_state.get("name", "")

            # Save to DB — name goes into display_name; company_name left empty (user can set via dashboard)
            async with SessionLocal() as session:
                await update_customer_profile(session, from_number, name, reg_state.get("company_name", ""), company_id)

            # Delete registration key
            await redis.delete(reg_key)

            send_registration_welcome(from_number, name)

            # If they had sent a receipt before registering, process it now
            pending_key = f"pending_media:{from_number}"
            pending_raw = await redis.get(pending_key)
            if pending_raw:
                pending = json.loads(pending_raw)
                await redis.delete(pending_key)
                # Create receipt rows and fire background tasks
                sids = []
                for item in pending:
                    async with SessionLocal() as session:
                        await create_receipt_row(session, item["message_sid"], from_number)
                    sids.append(item["message_sid"])
                    background_tasks.add_task(
                        process_receipt,
                        message_sid=item["message_sid"],
                        from_number=from_number,
                        media_url=item["media_url"],
                        content_type=item["content_type"],
                    )
                # Store all SIDs as a list for bulk confirmation
                await redis.set(f"pending:{from_number}", json.dumps(sids), ex=1800)
                # Set batch counter so process_receipt knows when all are done
                await redis.set(f"processing:{from_number}", len(sids), ex=1800)

            return Response(content="", media_type="text/xml", status_code=200)

    # --- Inbound receipt ---
    if num_media > 0:
        registered = await _is_registered(from_number)

        if not registered:
            # Ensure customer record exists
            async with SessionLocal() as session:
                await get_or_create_customer(session, from_number)

            # Store all media for later processing
            pending_items = []
            for i in range(num_media):
                pending_items.append({
                    "message_sid": f"{message_sid}_{i}",
                    "media_url": form.get(f"MediaUrl{i}", ""),
                    "content_type": form.get(f"MediaContentType{i}", ""),
                })
            pending_key = f"pending_media:{from_number}"
            await redis.set(pending_key, json.dumps(pending_items), ex=3600)

            # Start registration
            reg_init = {"step": "awaiting_name"}
            await redis.set(reg_key, json.dumps(reg_init), ex=3600)
            send_registration_ask_name(from_number)
            return Response(content="", media_type="text/xml", status_code=200)

        # Already registered — process all media attachments
        sids = []
        for i in range(num_media):
            media_url = form.get(f"MediaUrl{i}", "")
            content_type = form.get(f"MediaContentType{i}", "")
            sid = f"{message_sid}_{i}" if num_media > 1 else message_sid

            logger.info(f"Receipt received: {sid} from {from_number} type={content_type} ({i+1}/{num_media})")

            async with SessionLocal() as session:
                await create_receipt_row(session, sid, from_number)

            sids.append(sid)
            background_tasks.add_task(
                process_receipt,
                message_sid=sid,
                from_number=from_number,
                media_url=media_url,
                content_type=content_type,
            )

        # Append to any existing pending SIDs (handles multiple separate webhook calls)
        existing_raw = await redis.get(f"pending:{from_number}")
        existing_sids = json.loads(existing_raw) if existing_raw else []
        if isinstance(existing_sids, str):
            existing_sids = [existing_sids]  # migrate old single-SID format
        await redis.set(f"pending:{from_number}", json.dumps(existing_sids + sids), ex=1800)
        # Increment batch counter by the number of new jobs queued
        await redis.incrby(f"processing:{from_number}", len(sids))
        await redis.expire(f"processing:{from_number}", 1800)

        return Response(content="", media_type="text/xml", status_code=200)

    # --- Confirmation reply ---
    pending_raw = await redis.get(f"pending:{from_number}")
    if pending_raw:
        pending_val = pending_raw.decode() if isinstance(pending_raw, bytes) else pending_raw
        try:
            sids = json.loads(pending_val)
            if isinstance(sids, str):
                sids = [sids]  # migrate old single-SID format
        except (json.JSONDecodeError, ValueError):
            sids = [pending_val]

        if body_lower in ("confirm", "yes", "✓", "confirmed"):
            async with SessionLocal() as session:
                for sid in sids:
                    await update_receipt_status(session, sid, "confirmed")
            await redis.delete(f"pending:{from_number}")
            logger.info(f"Confirmed {len(sids)} receipt(s) for {from_number}")
        elif body_lower in ("reject", "no", "✗", "rejected"):
            async with SessionLocal() as session:
                for sid in sids:
                    await update_receipt_status(session, sid, "rejected")
            await redis.delete(f"pending:{from_number}")
            logger.info(f"Rejected {len(sids)} receipt(s) for {from_number}")

    return Response(content="", media_type="text/xml", status_code=200)

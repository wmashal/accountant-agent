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


async def _lookup_accountant(to_number: str):
    """Return the Accountant whose twilio_from_number matches the inbound To number."""
    from sqlalchemy import select
    from app.models.accountant import Accountant
    async with SessionLocal() as session:
        result = await session.execute(
            select(Accountant).where(
                Accountant.twilio_from_number == to_number,
                Accountant.is_active == True,
            )
        )
        return result.scalar_one_or_none()


async def _is_registered(phone_number: str, accountant_id: int) -> bool:
    """Return True if the customer exists under this accountant and has completed registration."""
    async with SessionLocal() as session:
        from sqlalchemy import select
        from app.models.receipt import Customer
        result = await session.execute(
            select(Customer).where(
                Customer.phone_number == phone_number,
                Customer.accountant_id == accountant_id,
            )
        )
        customer = result.scalar_one_or_none()
        return customer is not None and customer.display_name is not None


@router.post("/webhook")
async def webhook(request: Request, background_tasks: BackgroundTasks):
    await validate_twilio_signature(request)
    form = await request.form()

    message_sid = form.get("MessageSid", "")
    from_number = form.get("From", "")
    to_raw = form.get("To", "")
    num_media = int(form.get("NumMedia", 0))
    body = form.get("Body", "").strip()
    body_lower = body.lower()

    # Strip whatsapp: prefix from the To field to get bare phone number
    to_number = to_raw.replace("whatsapp:", "").strip()

    # Route to accountant by their Twilio number
    accountant = await _lookup_accountant(to_number)
    if not accountant:
        logger.warning(f"No active accountant found for Twilio number {to_number}")
        return Response(content="", media_type="text/xml", status_code=200)

    accountant_id = accountant.id
    twilio_from_number = accountant.twilio_from_number

    redis = await get_redis()

    # Redis keys are namespaced by accountant to avoid cross-tenant collisions
    reg_key = f"reg:{accountant_id}:{from_number}"
    reg_raw = await redis.get(reg_key)
    reg_state = json.loads(reg_raw) if reg_raw else None

    if reg_state:
        step = reg_state.get("step")

        if num_media > 0:
            pending_key = f"pending_media:{accountant_id}:{from_number}"
            pending_raw = await redis.get(pending_key)
            pending = json.loads(pending_raw) if pending_raw else []
            for i in range(num_media):
                pending.append({
                    "message_sid": f"{message_sid}_{i}",
                    "media_url": form.get(f"MediaUrl{i}", ""),
                    "content_type": form.get(f"MediaContentType{i}", ""),
                })
            await redis.set(pending_key, json.dumps(pending), ex=3600)
            logger.info(f"Queued {num_media} media item(s) during registration for {from_number} (acct={accountant_id})")
            return Response(content="", media_type="text/xml", status_code=200)

        if step == "awaiting_name":
            reg_state["name"] = body
            reg_state["step"] = "awaiting_id"
            await redis.set(reg_key, json.dumps(reg_state), ex=3600)
            send_registration_ask_id(from_number, body, twilio_from_number)
            return Response(content="", media_type="text/xml", status_code=200)

        if step == "awaiting_company":
            reg_state["company_name"] = body
            reg_state["step"] = "awaiting_id"
            await redis.set(reg_key, json.dumps(reg_state), ex=3600)
            send_registration_ask_id(from_number, reg_state.get("name", ""), twilio_from_number)
            return Response(content="", media_type="text/xml", status_code=200)

        if step == "awaiting_id":
            company_id = body if body_lower != "skip" else ""
            name = reg_state.get("name", "")

            async with SessionLocal() as session:
                await update_customer_profile(session, from_number, name, reg_state.get("company_name", ""), company_id, accountant_id)

            await redis.delete(reg_key)

            send_registration_welcome(from_number, name, twilio_from_number)

            pending_key = f"pending_media:{accountant_id}:{from_number}"
            pending_raw = await redis.get(pending_key)
            if pending_raw:
                pending = json.loads(pending_raw)
                await redis.delete(pending_key)
                sids = []
                for item in pending:
                    async with SessionLocal() as session:
                        await create_receipt_row(session, item["message_sid"], from_number, accountant_id)
                    sids.append(item["message_sid"])
                    background_tasks.add_task(
                        process_receipt,
                        message_sid=item["message_sid"],
                        from_number=from_number,
                        media_url=item["media_url"],
                        content_type=item["content_type"],
                        accountant_id=accountant_id,
                        twilio_from_number=twilio_from_number,
                    )
                await redis.set(f"pending:{accountant_id}:{from_number}", json.dumps(sids), ex=1800)
                await redis.set(f"processing:{accountant_id}:{from_number}", len(sids), ex=1800)

            return Response(content="", media_type="text/xml", status_code=200)

    # --- Inbound receipt ---
    if num_media > 0:
        registered = await _is_registered(from_number, accountant_id)

        if not registered:
            async with SessionLocal() as session:
                await get_or_create_customer(session, from_number, accountant_id)

            pending_items = []
            for i in range(num_media):
                pending_items.append({
                    "message_sid": f"{message_sid}_{i}",
                    "media_url": form.get(f"MediaUrl{i}", ""),
                    "content_type": form.get(f"MediaContentType{i}", ""),
                })
            pending_key = f"pending_media:{accountant_id}:{from_number}"
            await redis.set(pending_key, json.dumps(pending_items), ex=3600)

            reg_init = {"step": "awaiting_name"}
            await redis.set(reg_key, json.dumps(reg_init), ex=3600)
            send_registration_ask_name(from_number, twilio_from_number)
            return Response(content="", media_type="text/xml", status_code=200)

        # Already registered — process all media attachments
        sids = []
        for i in range(num_media):
            media_url = form.get(f"MediaUrl{i}", "")
            content_type = form.get(f"MediaContentType{i}", "")
            sid = f"{message_sid}_{i}" if num_media > 1 else message_sid

            logger.info(f"Receipt received: {sid} from {from_number} acct={accountant_id} type={content_type} ({i+1}/{num_media})")

            async with SessionLocal() as session:
                await create_receipt_row(session, sid, from_number, accountant_id)

            sids.append(sid)
            background_tasks.add_task(
                process_receipt,
                message_sid=sid,
                from_number=from_number,
                media_url=media_url,
                content_type=content_type,
                accountant_id=accountant_id,
                twilio_from_number=twilio_from_number,
            )

        existing_raw = await redis.get(f"pending:{accountant_id}:{from_number}")
        existing_sids = json.loads(existing_raw) if existing_raw else []
        if isinstance(existing_sids, str):
            existing_sids = [existing_sids]
        await redis.set(f"pending:{accountant_id}:{from_number}", json.dumps(existing_sids + sids), ex=1800)
        await redis.incrby(f"processing:{accountant_id}:{from_number}", len(sids))
        await redis.expire(f"processing:{accountant_id}:{from_number}", 1800)

        return Response(content="", media_type="text/xml", status_code=200)

    # --- Confirmation reply ---
    pending_raw = await redis.get(f"pending:{accountant_id}:{from_number}")
    if pending_raw:
        pending_val = pending_raw.decode() if isinstance(pending_raw, bytes) else pending_raw
        try:
            sids = json.loads(pending_val)
            if isinstance(sids, str):
                sids = [sids]
        except (json.JSONDecodeError, ValueError):
            sids = [pending_val]

        if body_lower in ("confirm", "yes", "✓", "confirmed"):
            async with SessionLocal() as session:
                for sid in sids:
                    await update_receipt_status(session, sid, "confirmed")
            await redis.delete(f"pending:{accountant_id}:{from_number}")
            logger.info(f"Confirmed {len(sids)} receipt(s) for {from_number} (acct={accountant_id})")
        elif body_lower in ("reject", "no", "✗", "rejected"):
            async with SessionLocal() as session:
                for sid in sids:
                    await update_receipt_status(session, sid, "rejected")
            await redis.delete(f"pending:{accountant_id}:{from_number}")
            logger.info(f"Rejected {len(sids)} receipt(s) for {from_number} (acct={accountant_id})")

    return Response(content="", media_type="text/xml", status_code=200)

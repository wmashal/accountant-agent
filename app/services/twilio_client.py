import logging
from twilio.rest import Client
from app.config import get_settings
from app.models.receipt import ReceiptData

logger = logging.getLogger(__name__)


def _client():
    s = get_settings()
    return Client(s.twilio_account_sid, s.twilio_auth_token)


def send_summary(to: str, data: ReceiptData, drive_link: str | None):
    settings = get_settings()
    tax_str = f"{data.currency} {data.tax:.2f}" if data.tax is not None else "Not found"
    drive_line = f"Receipt saved: {drive_link}\n\n" if drive_link else ""
    body = (
        f"Receipt processed\n\n"
        f"Vendor: {data.vendor}\n"
        f"Amount: {data.currency} {data.cost:.2f}\n"
        f"Tax: {tax_str}\n"
        f"Date: {data.date}\n"
        f"ABN: {data.abn or 'Not found'}\n"
        f"Language: {data.receipt_language}\n\n"
        f"{drive_line}"
    )
    try:
        _client().messages.create(
            from_=f"whatsapp:{settings.twilio_from_number}",
            to=to,
            body=body,
        )
        logger.info(f"Summary sent to {to}")
    except Exception as e:
        logger.error(f"Failed to send summary to {to}: {e}")
        raise


def send_confirm_prompt(to: str, count: int):
    """Send a single confirmation prompt after all receipts in a batch are processed."""
    label = "receipt" if count == 1 else f"{count} receipts"
    _send(to, f"All done! {label} processed above.\n\nAre the details correct? Reply *confirm* or *reject*")


def send_error(to: str):
    settings = get_settings()
    try:
        _client().messages.create(
            from_=f"whatsapp:{settings.twilio_from_number}",
            to=to,
            body="Could not process your receipt. Please try sending it again.",
        )
    except Exception as e:
        logger.error(f"Failed to send error message to {to}: {e}")


def fetch_media_url_with_auth() -> tuple[str, str]:
    """Returns (account_sid, auth_token) for use in authenticated media downloads."""
    s = get_settings()
    return s.twilio_account_sid, s.twilio_auth_token


def _send(to: str, body: str):
    settings = get_settings()
    try:
        _client().messages.create(
            from_=f"whatsapp:{settings.twilio_from_number}",
            to=to,
            body=body,
        )
    except Exception as e:
        logger.error(f"Failed to send message to {to}: {e}")
        raise


def send_registration_ask_name(to: str):
    _send(to, "👋 Welcome! Before we process your receipts, we need a few details.\n\nWhat is your full name or company name?")


def send_registration_ask_id(to: str, name: str):
    _send(to, f"Thanks, {name}! What is your company ID or registration number? (Reply *skip* to skip)")


def send_registration_welcome(to: str, name: str):
    _send(to, f"✅ All set, {name}! You're registered.\n\nSend me a receipt photo or PDF anytime and I'll extract the data for you.")

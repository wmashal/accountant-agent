import logging
import os
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)

RECEIPTS_DIR = Path("/app/receipts")


async def upload_receipt(file_bytes: bytes, phone_number: str, message_sid: str, content_type: str) -> str | None:
    """Save receipt to local disk and return the URL path."""
    try:
        ext_map = {
            "application/pdf": "pdf",
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
        }
        ext = ext_map.get(content_type, "bin")
        safe_phone = phone_number.replace("whatsapp:", "").replace("+", "").replace(":", "")
        month = datetime.utcnow().strftime("%Y-%m")

        folder = RECEIPTS_DIR / safe_phone / month
        folder.mkdir(parents=True, exist_ok=True)

        filename = f"{message_sid}.{ext}"
        filepath = folder / filename
        filepath.write_bytes(file_bytes)

        url = f"/files/{safe_phone}/{month}/{filename}"
        logger.info(f"Saved receipt locally: {filepath} → {url}")
        return url

    except Exception as e:
        logger.warning(f"Local file save failed (non-fatal): {e}")
        return None

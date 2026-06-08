import logging
from datetime import datetime
from google.cloud import storage
from google.oauth2.service_account import Credentials
from app.config import get_settings

logger = logging.getLogger(__name__)


def _client():
    settings = get_settings()
    creds = Credentials.from_service_account_file(
        settings.google_service_account_file,
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    return storage.Client(credentials=creds)


async def upload_receipt(file_bytes: bytes, phone_number: str, message_sid: str, content_type: str) -> str | None:
    """Upload receipt to GCS and return public URL, or None if GCS not configured."""
    settings = get_settings()
    if not settings.gcs_bucket_name:
        logger.info("GCS_BUCKET_NAME not set, skipping file upload")
        return None

    try:
        client = _client()
        bucket = client.bucket(settings.gcs_bucket_name)

        ext_map = {
            "application/pdf": "pdf",
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
        }
        ext = ext_map.get(content_type, "bin")
        month = datetime.utcnow().strftime("%Y-%m")
        # Strip whatsapp: prefix from phone number for path safety
        safe_phone = phone_number.replace("whatsapp:", "").replace("+", "").replace(":", "")
        blob_name = f"receipts/{safe_phone}/{month}/{message_sid}.{ext}"

        blob = bucket.blob(blob_name)
        blob.upload_from_string(file_bytes, content_type=content_type)
        blob.make_public()

        url = blob.public_url
        logger.info(f"Uploaded to GCS: {url}")
        return url

    except Exception as e:
        logger.warning(f"GCS upload failed (non-fatal): {e}")
        return None

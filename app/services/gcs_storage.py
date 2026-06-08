import logging
from datetime import datetime
from google.cloud import storage

logger = logging.getLogger(__name__)

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = storage.Client()
    return _client


async def upload_receipt(file_bytes: bytes, phone_number: str, message_sid: str, content_type: str, bucket_name: str) -> str | None:
    """Upload receipt to GCS and return a public URL."""
    try:
        ext_map = {
            "application/pdf": "pdf",
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
            "image/heic": "heic",
            "image/gif": "gif",
        }
        ext = ext_map.get(content_type, "bin")
        safe_phone = phone_number.replace("whatsapp:", "").replace("+", "").replace(":", "")
        month = datetime.utcnow().strftime("%Y-%m")
        blob_name = f"receipts/{safe_phone}/{month}/{message_sid}.{ext}"

        client = _get_client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_name)
        blob.upload_from_string(file_bytes, content_type=content_type)

        url = f"https://storage.googleapis.com/{bucket_name}/{blob_name}"
        logger.info(f"Uploaded receipt to GCS: {url}")
        return url

    except Exception as e:
        logger.warning(f"GCS upload failed (non-fatal): {e}")
        return None

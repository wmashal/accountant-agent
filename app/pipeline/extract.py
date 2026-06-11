import asyncio
import logging
from app.services.gemini_client import extract_from_image, extract_from_text

logger = logging.getLogger(__name__)

REQUIRED_FIELDS = {"vendor", "cost"}


def is_valid(result: dict) -> bool:
    if not isinstance(result, dict):
        return False
    for field in REQUIRED_FIELDS:
        if not result.get(field):
            return False
    try:
        float(result["cost"])
    except (TypeError, ValueError):
        return False
    return True


async def extract(
    file_bytes: bytes,
    content_type: str,
    ocr_text: str = None,
) -> tuple[dict, str]:
    """
    Run extraction via Gemini. Returns (result_dict, model_name).
    Retries up to 3 times on transient errors.
    """
    result = None
    model = "gemini-2.5-flash"

    for attempt in range(3):
        try:
            if ocr_text:
                result = await extract_from_text(ocr_text)
            else:
                result = await extract_from_image(file_bytes, content_type)
            if is_valid(result):
                return result, model
            logger.warning(f"Gemini attempt {attempt + 1}: invalid result {result}")
            break  # Invalid schema — no point retrying
        except Exception as e:
            logger.warning(f"Gemini attempt {attempt + 1} failed: {e}")
            if attempt < 2:
                await asyncio.sleep(3 * (attempt + 1))  # 3s, 6s backoff

    raise ValueError(f"Extraction failed after 3 attempts: {result}")

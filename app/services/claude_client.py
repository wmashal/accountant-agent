import logging
import json
import anthropic
from app.config import get_settings
from app.services.gemini_client import EXTRACTION_PROMPT

logger = logging.getLogger(__name__)


async def extract_fallback(file_bytes: bytes, content_type: str, ocr_text: str = None) -> dict:
    """Claude Sonnet fallback — called only when Gemini extraction fails."""
    settings = get_settings()
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    if ocr_text:
        # PDF path — use OCR text
        user_content = f"Receipt text:\n{ocr_text}"
    elif "pdf" in content_type.lower():
        # PDF but no OCR text — Claude doesn't support PDF as image, skip
        raise ValueError("Claude fallback does not support PDF without OCR text")
    else:
        # Image path — encode as base64
        import base64
        b64 = base64.standard_b64encode(file_bytes).decode()
        user_content = [
            {
                "type": "image",
                "source": {"type": "base64", "media_type": content_type, "data": b64},
            },
            {"type": "text", "text": "Extract data from this receipt."},
        ]

    message = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=1024,
        system=EXTRACTION_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )

    text = message.content[0].text
    logger.info("Claude fallback extraction complete")
    return json.loads(text)

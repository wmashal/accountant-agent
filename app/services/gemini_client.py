import logging
import base64
import json
import httpx
from app.config import get_settings

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """You are a receipt data extraction assistant.
The receipt may be written in any language. Read it in its original language and return all values as described.
Return ONLY valid JSON matching this exact schema — no markdown fences, no explanation.

{
  "vendor": "string",
  "cost": 0.00,
  "tax": 0.00,
  "tax_included": false,
  "currency": "AUD",
  "date": "string",
  "abn": "string or null",
  "receipt_language": "en"
}

Rules:
- vendor: transliterate or translate to English if not Latin script
- cost: total amount including tax, as a number
- tax: the GST/VAT/tax line if explicitly shown; null if not shown
- tax_included: true if receipt says GST/tax included or equivalent in any language
- currency: ISO 4217 code; default to AUD if not shown
- date: as printed on the receipt in any format
- abn: as printed including spaces; null if not present
- receipt_language: BCP 47 code (e.g. en, ar, zh, fr, ja, he)"""


async def extract_from_image(file_bytes: bytes, mime_type: str) -> dict:
    """Send raw image to Gemini 2.5 Flash vision for extraction."""
    settings = get_settings()
    b64 = base64.b64encode(file_bytes).decode()

    payload = {
        "contents": [{
            "parts": [
                {"text": EXTRACTION_PROMPT},
                {"inlineData": {"mimeType": mime_type, "data": b64}},
            ]
        }],
        "generationConfig": {"responseMimeType": "application/json"},
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
            headers={"x-goog-api-key": settings.gemini_api_key},
            json=payload,
        )
        resp.raise_for_status()

    raw = resp.json()
    text = raw["candidates"][0]["content"]["parts"][0]["text"]
    logger.info("Gemini vision extraction complete")
    return json.loads(text)


async def extract_from_text(ocr_text: str) -> dict:
    """Send OCR markdown text to Gemini 2.5 Flash for extraction."""
    settings = get_settings()

    prompt = f"{EXTRACTION_PROMPT}\n\nReceipt text:\n{ocr_text}"

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
            headers={"x-goog-api-key": settings.gemini_api_key},
            json=payload,
        )
        resp.raise_for_status()

    raw = resp.json()
    text = raw["candidates"][0]["content"]["parts"][0]["text"]
    logger.info("Gemini text extraction complete")
    return json.loads(text)

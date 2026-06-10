import logging
import base64
import json
import httpx
from app.config import get_settings

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """You are an invoice data extraction assistant.
The invoice may be written in any language. Read it in its original language and return all values as described.
Return ONLY valid JSON matching this exact schema — no markdown fences, no explanation.

{
  "vendor": "string",
  "payer": "string or null",
  "receipt_number": "string or null",
  "cost": 0.00,
  "tax": 0.00,
  "tax_included": false,
  "tax_rate": null,
  "currency": "USD",
  "date": "string",
  "receipt_language": "en"
}

Rules:
- vendor: the business/person who issued the invoice (transliterate to English if not Latin script)
- payer: the business/person who paid or is billed — look for fields like "לכבוד", "מקור", "bill to", "client", "customer ID", "ח.פ", "ע.מ" — include any ID numbers found there; null if not shown
- receipt_number: the invoice/receipt number if shown (e.g. "קבלה מס'", "invoice #", "receipt no"); null if not present
- cost: total amount including tax, as a number
- tax: the GST/VAT/tax amount if explicitly shown as a separate line; null if not shown
- tax_included: true if invoice says tax/VAT is included in the price (e.g. "כולל מע\"מ", "VAT included", "tax inclusive")
- tax_rate: the VAT/tax rate percentage as a decimal if shown or can be inferred (e.g. 0.17 for 17%, 0.18 for 18%); null if unknown
- currency: ISO 4217 code; default to USD if not shown
- date: as printed on the invoice in any format
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

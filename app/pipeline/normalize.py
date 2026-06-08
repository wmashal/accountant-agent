import re
import logging
from typing import Optional
from dateutil import parser as dateparser
from app.models.receipt import ReceiptData

logger = logging.getLogger(__name__)


def normalize(raw: dict, extraction_model: str, raw_ocr: Optional[str] = None) -> ReceiptData:
    vendor = str(raw.get("vendor", "Unknown")).strip()
    cost = _parse_float(raw.get("cost"))
    receipt_language = raw.get("receipt_language", "unknown")

    # --- Tax / GST ---
    tax = _parse_float(raw.get("tax"))
    if tax is None and raw.get("tax_included"):
        tax = round(cost / 11, 2)

    # --- Currency ---
    currency = str(raw.get("currency") or "AUD").strip().upper()
    if currency == "$":
        currency = "AUD"

    # --- Date ---
    date = _parse_date(raw.get("date", ""))

    # --- ABN ---
    abn_raw = str(raw.get("abn") or "").strip()
    abn_digits = re.sub(r"\D", "", abn_raw)
    abn_valid = len(abn_digits) == 11 and _validate_abn(abn_digits)
    abn = abn_digits if abn_valid else None

    return ReceiptData(
        vendor=vendor,
        cost=cost,
        tax=tax,
        currency=currency,
        date=date,
        abn=abn,
        abn_raw=abn_raw if not abn_valid and abn_raw else None,
        receipt_language=receipt_language,
        extraction_model=extraction_model,
        raw_ocr=raw_ocr,
    )


def _parse_float(value) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _parse_date(value: str) -> str:
    if not value:
        return ""
    try:
        return dateparser.parse(str(value), dayfirst=True).strftime("%Y-%m-%d")
    except Exception:
        logger.warning(f"Could not parse date: {value!r}")
        return str(value)


def _validate_abn(abn: str) -> bool:
    """ATO ABN checksum validation."""
    weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    digits = [int(d) for d in abn]
    digits[0] -= 1
    return sum(d * w for d, w in zip(digits, weights)) % 89 == 0

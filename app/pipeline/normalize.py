import logging
from typing import Optional
from dateutil import parser as dateparser
from app.models.receipt import ReceiptData

logger = logging.getLogger(__name__)


def normalize(raw: dict, extraction_model: str, raw_ocr: Optional[str] = None, default_currency: str = "USD", customer_identity: set[str] | None = None) -> ReceiptData:
    vendor = str(raw.get("vendor", "Unknown")).strip()
    payer = str(raw.get("payer") or "").strip()
    receipt_number = str(raw.get("receipt_number") or "").strip() or None
    cost = _parse_float(raw.get("cost"))
    receipt_language = raw.get("receipt_language", "unknown")

    # --- Tax / VAT ---
    # Only populate tax if it is explicitly shown on the invoice.
    # If VAT-inclusive but no explicit tax line, leave tax=None.
    # tax_rate is stored so the UI can calculate tax on demand.
    tax = _parse_float(raw.get("tax"))
    tax_rate = _parse_float(raw.get("tax_rate"))
    # If tax not shown but tax_rate is known and invoice is tax-inclusive, calculate tax
    if tax is None and tax_rate is not None and raw.get("tax_included") and cost:
        # tax_rate is fraction of gross amount: tax = cost * rate / (1 + rate)
        tax = round(cost * tax_rate / (1 + tax_rate), 2)

    # --- Currency ---
    # Always use the customer's default currency — ignore AI-extracted currency
    currency = default_currency

    # --- Transaction type ---
    # Income when YOU are the vendor (you issued the receipt to someone else)
    # Expense when someone else is the vendor (you paid them) — this is the default
    transaction_type = "expense"
    if customer_identity:
        vendor_lower = vendor.lower()
        if any(identity.lower() in vendor_lower for identity in customer_identity if identity):
            transaction_type = "income"

    # --- Date ---
    date = _parse_date(raw.get("date", ""))

    return ReceiptData(
        vendor=vendor,
        cost=cost,
        tax=tax,
        tax_rate=tax_rate,
        currency=currency,
        date=date,
        receipt_number=receipt_number,
        receipt_language=receipt_language,
        extraction_model=extraction_model,
        transaction_type=transaction_type,
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


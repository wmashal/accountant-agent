import logging
from datetime import datetime
from googleapiclient.discovery import build
from google.oauth2.service_account import Credentials
from app.config import get_settings
from app.models.receipt import ReceiptData

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def _service():
    settings = get_settings()
    creds = Credentials.from_service_account_file(settings.google_service_account_file, scopes=SCOPES)
    return build("sheets", "v4", credentials=creds).spreadsheets()


async def append_initial_row(message_sid: str, from_number: str):
    settings = get_settings()
    now = datetime.utcnow().isoformat() + "Z"
    values = [[message_sid, now, "", "", "", "", "", "", "", "processing", "", "", ""]]
    try:
        _service().values().append(
            spreadsheetId=settings.google_sheets_id,
            range="Sheet1!A:M",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": values},
        ).execute()
        logger.info(f"Initial row appended: {message_sid}")
    except Exception as e:
        logger.error(f"Failed to append initial row: {e}")
        raise


async def update_row(message_sid: str, data: ReceiptData, drive_link: str, status: str):
    settings = get_settings()
    svc = _service()

    # Find the row with this MessageSid
    result = svc.values().get(
        spreadsheetId=settings.google_sheets_id,
        range="Sheet1!A:A",
    ).execute()

    rows = result.get("values", [])
    row_index = None
    for i, row in enumerate(rows):
        if row and row[0] == message_sid:
            row_index = i + 1  # Sheets rows are 1-indexed
            break

    now = datetime.utcnow().isoformat() + "Z"
    values = [[
        message_sid,
        now,
        data.vendor,
        data.cost,
        data.tax if data.tax is not None else "",
        data.currency,
        data.date,
        data.abn or "",
        drive_link,
        status,
        data.extraction_model,
        data.receipt_language,
        data.raw_ocr or "",
    ]]

    if row_index is None:
        # Row was never inserted (e.g. webhook hit during reload) — append it now
        logger.warning(f"MessageSid {message_sid} not found in sheet, appending new row")
        svc.values().append(
            spreadsheetId=settings.google_sheets_id,
            range="Sheet1!A:M",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": values},
        ).execute()
    else:
        svc.values().update(
            spreadsheetId=settings.google_sheets_id,
            range=f"Sheet1!A{row_index}:M{row_index}",
            valueInputOption="RAW",
            body={"values": values},
        ).execute()
    logger.info(f"Row upserted: {message_sid} status={status}")


async def update_status(message_sid: str, status: str):
    settings = get_settings()
    svc = _service()

    result = svc.values().get(
        spreadsheetId=settings.google_sheets_id,
        range="Sheet1!A:A",
    ).execute()

    rows = result.get("values", [])
    for i, row in enumerate(rows):
        if row and row[0] == message_sid:
            row_index = i + 1
            svc.values().update(
                spreadsheetId=settings.google_sheets_id,
                range=f"Sheet1!J{row_index}",
                valueInputOption="RAW",
                body={"values": [[status]]},
            ).execute()
            logger.info(f"Status updated: {message_sid} → {status}")
            return

    logger.warning(f"MessageSid {message_sid} not found for status update")

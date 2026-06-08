import asyncio
import io
import logging
import re
from datetime import datetime
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload, MediaIoBaseDownload
from google.oauth2.service_account import Credentials
from app.config import get_settings

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/drive"]

# MIME types we accept from Drive folders
RECEIPT_MIME_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
}


def _service():
    settings = get_settings()
    creds = Credentials.from_service_account_file(settings.google_service_account_file, scopes=SCOPES)
    return build("drive", "v3", credentials=creds)


async def upload_receipt(file_bytes: bytes, message_sid: str, content_type: str) -> str | None:
    """Upload receipt file to Google Drive and return public share link, or None on failure."""
    settings = get_settings()

    if not settings.google_drive_folder_id:
        logger.info("GOOGLE_DRIVE_FOLDER_ID not set, skipping Drive upload")
        return None

    try:
        svc = _service()

        # Build folder path: Receipts/YYYY-MM
        month_folder = datetime.utcnow().strftime("%Y-%m")
        folder_id = await _get_or_create_folder(svc, month_folder, settings.google_drive_folder_id)

        ext_map = {
            "application/pdf": "pdf",
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
        }
        ext = ext_map.get(content_type, "bin")
        filename = f"{message_sid}.{ext}"

        media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=content_type)
        file_metadata = {"name": filename, "parents": [folder_id]}

        uploaded = svc.files().create(
            body=file_metadata,
            media_body=media,
            fields="id",
            supportsAllDrives=True,
        ).execute()

        file_id = uploaded["id"]

        svc.permissions().create(
            fileId=file_id,
            body={"type": "anyone", "role": "reader"},
            supportsAllDrives=True,
        ).execute()

        link = f"https://drive.google.com/file/d/{file_id}/view"
        logger.info(f"Uploaded {filename} → {link}")
        return link

    except Exception as e:
        logger.warning(f"Drive upload failed (non-fatal): {e}")
        return None


async def create_customer_folder(display_name: str, company_id: str | None, root_folder_id: str) -> str:
    """Create Receipts/<Name_CompanyID>/ under root_folder_id. Returns the new folder's Drive ID."""
    svc = _service()

    # Ensure a top-level "Receipts" folder exists
    receipts_folder_id = await _get_or_create_folder(svc, "Receipts", root_folder_id)

    # Build a safe folder name
    safe_name = re.sub(r"[^\w]", "_", display_name or "Customer")
    safe_id = re.sub(r"[^\w]", "_", company_id or "")
    folder_name = f"{safe_name}_{safe_id}" if safe_id else safe_name

    customer_folder_id = await _get_or_create_folder(svc, folder_name, receipts_folder_id)
    logger.info(f"Customer Drive folder '{folder_name}' → {customer_folder_id}")
    return customer_folder_id


def list_folder_files(folder_id: str) -> list[dict]:
    """List all non-trashed, non-folder files in a Drive folder. Returns [{id, name, mimeType}]."""
    svc = _service()
    results = []
    page_token = None
    while True:
        params = {
            "q": (
                f"'{folder_id}' in parents "
                "and trashed=false "
                "and mimeType != 'application/vnd.google-apps.folder'"
            ),
            "fields": "nextPageToken, files(id, name, mimeType)",
            "supportsAllDrives": True,
            "includeItemsFromAllDrives": True,
        }
        if page_token:
            params["pageToken"] = page_token
        resp = svc.files().list(**params).execute()
        results.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return results


def download_file(file_id: str) -> tuple[bytes, str]:
    """Download a Drive file. Returns (file_bytes, content_type)."""
    svc = _service()
    meta = svc.files().get(fileId=file_id, fields="mimeType", supportsAllDrives=True).execute()
    content_type = meta.get("mimeType", "application/octet-stream")

    request = svc.files().get_media(fileId=file_id, supportsAllDrives=True)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue(), content_type


async def delete_drive_file(file_id: str) -> None:
    """Move a Drive file to a 'deleted/' subfolder (service account can't trash user-owned files)."""
    try:
        loop = asyncio.get_event_loop()
        svc = _service()

        # Get current parents
        meta = await loop.run_in_executor(
            None,
            lambda: svc.files().get(fileId=file_id, fields="parents", supportsAllDrives=True).execute()
        )
        parents = meta.get("parents", [])
        parent_id = parents[0] if parents else None

        if parent_id:
            deleted_id = await _get_or_create_folder(svc, "deleted", parent_id)
            await loop.run_in_executor(
                None,
                lambda: svc.files().update(
                    fileId=file_id,
                    addParents=deleted_id,
                    removeParents=parent_id,
                    supportsAllDrives=True,
                    fields="id, parents",
                ).execute()
            )
            logger.info(f"Moved Drive file {file_id} → deleted/")
        else:
            logger.warning(f"Drive file {file_id} has no parent, cannot move to deleted/")
    except Exception as e:
        logger.warning(f"Drive delete failed (non-fatal): {e}")


async def move_to_processed(file_id: str, parent_folder_id: str, receipt_date: str = "") -> None:
    """Move a file to a 'processed/YYYY-MM/' subfolder inside parent_folder_id."""
    try:
        svc = _service()
        # Determine YYYY-MM from receipt date, fall back to current month
        if receipt_date and len(receipt_date) >= 7:
            month_label = receipt_date[:7]  # e.g. "2026-06"
        else:
            from datetime import datetime
            month_label = datetime.utcnow().strftime("%Y-%m")

        processed_id = await _get_or_create_folder(svc, "processed", parent_folder_id)
        month_id = await _get_or_create_folder(svc, month_label, processed_id)
        svc.files().update(
            fileId=file_id,
            addParents=month_id,
            removeParents=parent_folder_id,
            supportsAllDrives=True,
            fields="id, parents",
        ).execute()
        logger.info(f"Moved file {file_id} → processed/{month_label}/")
    except Exception as e:
        logger.warning(f"Could not move file {file_id} to processed/: {e}")


async def _get_or_create_folder(svc, name: str, parent_id: str) -> str:
    """Get or create a subfolder by name under parent_id."""
    query = (
        f"name='{name}' and mimeType='application/vnd.google-apps.folder' "
        f"and '{parent_id}' in parents and trashed=false"
    )
    result = svc.files().list(
        q=query, fields="files(id)", supportsAllDrives=True, includeItemsFromAllDrives=True
    ).execute()
    files = result.get("files", [])
    if files:
        return files[0]["id"]

    folder = svc.files().create(
        body={
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        },
        fields="id",
        supportsAllDrives=True,
    ).execute()
    return folder["id"]

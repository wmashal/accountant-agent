import logging
from datetime import datetime
from googleapiclient.discovery import build
from google.oauth2.service_account import Credentials
from app.config import get_settings

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/drive"]


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

        # Determine file extension
        ext_map = {
            "application/pdf": "pdf",
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
        }
        ext = ext_map.get(content_type, "bin")
        filename = f"{message_sid}.{ext}"

        # Upload
        from googleapiclient.http import MediaIoBaseUpload
        import io
        media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=content_type)
        file_metadata = {"name": filename, "parents": [folder_id]}

        uploaded = svc.files().create(
            body=file_metadata,
            media_body=media,
            fields="id",
            supportsAllDrives=True,
        ).execute()

        file_id = uploaded["id"]

        # Set link sharing
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

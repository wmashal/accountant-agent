import asyncio
import logging
import httpx
from app.config import get_settings

logger = logging.getLogger(__name__)

POLL_INTERVAL = 5   # seconds between status checks
MAX_POLLS = 12      # 12 × 5s = 60s max


async def ocr_pdf(file_bytes: bytes) -> str:
    """Upload PDF to LlamaParse and return markdown OCR text."""
    settings = get_settings()
    headers = {"Authorization": f"Bearer {settings.llama_cloud_api_key}"}

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.cloud.llamaindex.ai/api/parsing/upload",
            headers=headers,
            files={"file": ("receipt.pdf", file_bytes, "application/pdf")},
            data={"preset": "invoice", "high_quality_mode": "true"},
        )
        resp.raise_for_status()
        job_id = resp.json()["id"]
        logger.info(f"LlamaParse job submitted: {job_id}")

    # Poll for completion
    async with httpx.AsyncClient(timeout=15) as client:
        for attempt in range(MAX_POLLS):
            await asyncio.sleep(POLL_INTERVAL)
            status_resp = await client.get(
                f"https://api.cloud.llamaindex.ai/api/parsing/job/{job_id}/result/markdown",
                headers=headers,
            )
            data = status_resp.json()
            if data.get("status") == "SUCCESS":
                logger.info(f"LlamaParse job complete: {job_id}")
                return data["markdown"]
            if data.get("status") == "ERROR":
                raise RuntimeError(f"LlamaParse job failed: {data}")
            logger.debug(f"LlamaParse poll {attempt + 1}/{MAX_POLLS}: {data.get('status')}")

    raise TimeoutError(f"LlamaParse job timed out after {MAX_POLLS * POLL_INTERVAL}s")


async def fetch_media(media_url: str) -> bytes:
    """Download media file from Twilio URL, following CDN redirects."""
    settings = get_settings()
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
        # First request with auth — Twilio returns 307 redirect to CDN
        resp = await client.get(
            media_url,
            auth=(settings.twilio_account_sid, settings.twilio_auth_token),
        )

    if resp.status_code in (301, 302, 307, 308):
        # Follow redirect to CDN without auth (CDN URL is pre-signed)
        cdn_url = resp.headers["location"]
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            resp = await client.get(cdn_url)

    resp.raise_for_status()
    return resp.content

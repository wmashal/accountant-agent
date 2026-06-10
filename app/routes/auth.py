import bcrypt
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.middleware.auth import create_token
from app.config import get_settings
from app.models.accountant import Accountant

logger = logging.getLogger(__name__)
router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    accountant_id: int | None = None
    display_name: str | None = None


@router.post("/api/auth/login", response_model=LoginResponse)
async def accountant_login(body: LoginRequest, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(Accountant).where(Accountant.username == body.username)
    )
    accountant = result.scalar_one_or_none()

    if not accountant or not accountant.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not bcrypt.checkpw(body.password.encode(), accountant.password_hash.encode()):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_token(
        accountant_id=accountant.id,
        username=accountant.username,
        is_admin=False,
        expires_hours=24,
    )
    return LoginResponse(
        access_token=token,
        accountant_id=accountant.id,
        display_name=accountant.display_name,
    )


@router.post("/api/admin/login", response_model=LoginResponse)
async def admin_login(body: LoginRequest):
    settings = get_settings()
    if body.username != settings.admin_username or body.password != settings.admin_password:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_token(
        accountant_id=0,
        username=body.username,
        is_admin=True,
        expires_hours=8,
    )
    return LoginResponse(access_token=token)

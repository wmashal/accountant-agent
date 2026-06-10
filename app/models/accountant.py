from datetime import datetime, timezone
from typing import Optional

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Accountant(Base):
    __tablename__ = "accountants"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(sa.String(100), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(sa.String(255))
    display_name: Mapped[Optional[str]] = mapped_column(sa.String(200), nullable=True)
    company_name: Mapped[Optional[str]] = mapped_column(sa.String(200), nullable=True)
    logo_url: Mapped[Optional[str]] = mapped_column(sa.String(500), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(sa.String(200), nullable=True)
    google_drive_root_folder_id: Mapped[Optional[str]] = mapped_column(sa.String(200), nullable=True)
    twilio_from_number: Mapped[Optional[str]] = mapped_column(sa.String(50), nullable=True, index=True)
    gemini_api_key: Mapped[Optional[str]] = mapped_column(sa.String(200), nullable=True)
    default_currency: Mapped[str] = mapped_column(sa.String(10), default="USD")
    is_active: Mapped[bool] = mapped_column(sa.Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

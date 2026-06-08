from dataclasses import dataclass
from typing import Optional
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


# --- SQLAlchemy ORM models ---

class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True)
    phone_number: Mapped[str] = mapped_column(sa.String(50), unique=True, index=True)
    display_name: Mapped[Optional[str]] = mapped_column(sa.String(200), nullable=True)
    company_name: Mapped[Optional[str]] = mapped_column(sa.String(200), nullable=True)
    company_id: Mapped[Optional[str]] = mapped_column(sa.String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


class Receipt(Base):
    __tablename__ = "receipts"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_sid: Mapped[str] = mapped_column(sa.String(100), unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(sa.ForeignKey("customers.id"), index=True)
    phone_number: Mapped[str] = mapped_column(sa.String(50), index=True)

    vendor: Mapped[Optional[str]] = mapped_column(sa.String(300), nullable=True)
    cost: Mapped[Optional[float]] = mapped_column(sa.Float, nullable=True)
    tax: Mapped[Optional[float]] = mapped_column(sa.Float, nullable=True)
    currency: Mapped[str] = mapped_column(sa.String(10), default="AUD")
    date: Mapped[Optional[str]] = mapped_column(sa.String(20), nullable=True)
    abn: Mapped[Optional[str]] = mapped_column(sa.String(20), nullable=True)
    receipt_language: Mapped[str] = mapped_column(sa.String(20), default="unknown")
    extraction_model: Mapped[str] = mapped_column(sa.String(50), default="")

    transaction_type: Mapped[str] = mapped_column(sa.String(20), default="expense")
    status: Mapped[str] = mapped_column(sa.String(30), default="processing")
    file_url: Mapped[Optional[str]] = mapped_column(sa.String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


# --- Dataclass used inside the pipeline ---

@dataclass
class ReceiptData:
    vendor: str
    cost: float
    tax: Optional[float]
    currency: str
    date: str
    abn: Optional[str]
    abn_raw: Optional[str]
    receipt_language: str
    extraction_model: str
    raw_ocr: Optional[str] = None

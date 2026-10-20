"""Send privacy-preserving transactional notifications through Resend.

Only the recipient address leaves Physics House; the subject and message are
fixed and contain no student, guardian, timetable, or financial details. A
successful response means Resend accepted the message, not that Gmail placed
it in the recipient's inbox. This module never sends without both production
environment variables and never logs credentials or provider response bodies.

Caller contract: send_update_email(recipient_email, event_id=<stable DB event id>)
returns MailResult. Reuse the same event id when retrying the *same* notice.
Resend's idempotency retention is 24 hours, so persistent outbox workers should
record acceptance and retry uncertain outcomes promptly.
"""

from __future__ import annotations

import hashlib
import http.client
import json
import os
import re
import ssl
from dataclasses import dataclass


_API_HOST = "api.resend.com"
_API_PATH = "/emails"
_TIMEOUT_SECONDS = 5.0
_SUBJECT = "Physics House: มีข้อมูลอัปเดตในระบบ"
_MESSAGE = (
    "มีข้อมูลอัปเดตในระบบ Physics House\n"
    "กรุณาเข้าสู่เว็บไซต์ Physics House ด้วยตนเองเพื่อตรวจสอบรายละเอียด\n"
    "หากไม่ได้คาดว่าจะได้รับอีเมลนี้ โปรดละเลยข้อความนี้"
)
_LOCAL_RE = re.compile(r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+\Z", re.ASCII)
_DOMAIN_LABEL_RE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\Z", re.ASCII)
_API_KEY_RE = re.compile(r"re_[A-Za-z0-9_-]{8,256}\Z", re.ASCII)


@dataclass(frozen=True)
class MailResult:
    """Result suitable for an outbox: `sent` means provider-accepted only."""

    sent: bool
    code: str
    retryable: bool = False
    provider_id: str | None = None
    status: int | None = None
    retry_after_seconds: int | None = None


def _email_address(value: object) -> str | None:
    if not isinstance(value, str) or len(value) > 254 or not value.isascii():
        return None
    value = value.strip()
    if value.count("@") != 1:
        return None
    local, domain = value.split("@")
    if not (1 <= len(local) <= 64) or not _LOCAL_RE.fullmatch(local):
        return None
    if local.startswith(".") or local.endswith(".") or ".." in local:
        return None
    labels = domain.split(".")
    if len(labels) < 2 or any(not _DOMAIN_LABEL_RE.fullmatch(label) for label in labels):
        return None
    if len(labels[-1]) < 2:
        return None
    return f"{local}@{domain.lower()}"


def _retry_after(value: str | None) -> int | None:
    if value is None or not value.isdecimal() or len(value) > 4:
        return None
    return min(int(value), 3600)


def send_update_email(recipient_email: str, *, event_id: str) -> MailResult:
    """Ask Resend to email one recipient about one committed database update.

    `event_id` must uniquely identify this notification. Supply the same ID
    on retries. The function makes at most one HTTPS request and returns a
    non-secret status that a caller can persist or use to schedule a retry.
    It must be called after committing the business transaction; email
    failure must not undo the saved update.
    """

    recipient = _email_address(recipient_email)
    if recipient is None:
        return MailResult(False, "invalid_recipient")
    if not isinstance(event_id, str) or not 1 <= len(event_id) <= 256 or any(
        ord(character) < 32 or ord(character) == 127 for character in event_id
    ):
        return MailResult(False, "invalid_event_id")

    api_key = os.getenv("RESEND_API_KEY", "")
    sender_value = os.getenv("PH_EMAIL_FROM", "")
    if not api_key or not sender_value:
        return MailResult(False, "not_configured")
    sender = _email_address(sender_value)
    if sender is None or not _API_KEY_RE.fullmatch(api_key):
        return MailResult(False, "invalid_configuration")

    # Hash the database event ID and address so neither appears in an HTTP
    # header. A single event sent to several recipients gets distinct keys.
    unique = f"{event_id}\x00{recipient.casefold()}".encode("utf-8")
    idempotency_key = "ph-" + hashlib.sha256(unique).hexdigest()
    payload = json.dumps(
        {"from": sender, "to": [recipient], "subject": _SUBJECT, "text": _MESSAGE},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")

    connection = None
    try:
        connection = http.client.HTTPSConnection(
            _API_HOST, timeout=_TIMEOUT_SECONDS, context=ssl.create_default_context()
        )
        connection.request(
            "POST", _API_PATH, body=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/json",
                "Idempotency-Key": idempotency_key,
            },
        )
        response = connection.getresponse()
        status = response.status
        retry_after = _retry_after(response.getheader("Retry-After"))
        # Never return, print, or log provider response text. Keep reads bounded.
        raw = response.read(4096)
        if 200 <= status < 300:
            try:
                provider_id = json.loads(raw).get("id")
            except (ValueError, AttributeError):
                provider_id = None
            if isinstance(provider_id, str) and 1 <= len(provider_id) <= 128:
                return MailResult(True, "accepted", provider_id=provider_id, status=status)
            return MailResult(False, "ambiguous_response", retryable=True, status=status)
        if status == 429 or status == 408 or status >= 500:
            return MailResult(False, "temporary_failure", retryable=True,
                              status=status, retry_after_seconds=retry_after)
        if status == 409:
            try:
                name = json.loads(raw).get("name")
            except (ValueError, AttributeError):
                name = None
            if name == "concurrent_idempotent_requests":
                return MailResult(False, "temporary_failure", retryable=True, status=status)
        return MailResult(False, "provider_rejected", status=status)
    except (OSError, TimeoutError, http.client.HTTPException):
        return MailResult(False, "temporary_failure", retryable=True)
    finally:
        if connection is not None:
            connection.close()

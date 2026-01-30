from __future__ import annotations

import crypt
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from . import db

LOCKOUT_THRESHOLD = 4
LOCKOUT_DURATION = timedelta(minutes=30)


@dataclass(frozen=True)
class AuthResult:
    success: bool
    message: str


class LockedOutError(RuntimeError):
    pass


def _ensure_bcrypt_supported() -> None:
    if not hasattr(crypt, "METHOD_BLOWFISH"):
        raise RuntimeError("bcrypt hashing is not supported on this system.")


def hash_pin(pin: str) -> str:
    _ensure_bcrypt_supported()
    salt = crypt.mksalt(crypt.METHOD_BLOWFISH)
    return crypt.crypt(pin, salt)


def verify_pin_hash(pin: str, pin_hash: str) -> bool:
    return crypt.crypt(pin, pin_hash) == pin_hash


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value).astimezone(timezone.utc)


def authenticate_user(
    conn,
    *,
    user_id: int,
    pin: str,
    now: datetime | None = None,
) -> AuthResult:
    current_time = now if now is not None else datetime.now(tz=timezone.utc)
    user = db.fetch_user(conn, user_id)
    if user is None:
        return AuthResult(False, "User not found.")

    lockout_until = _parse_ts(user["lockout_until_utc"])
    if lockout_until and lockout_until > current_time:
        raise LockedOutError(
            f"Account is locked until {lockout_until.isoformat()}."
        )
    if lockout_until and lockout_until <= current_time:
        db.update_user_security(
            conn,
            user_id=user_id,
            failed_attempts=0,
            lockout_until_utc=None,
            now=current_time,
        )
        user = db.fetch_user(conn, user_id)

    if not user["is_active"]:
        return AuthResult(False, "User is inactive.")

    if verify_pin_hash(pin, user["pin_hash"]):
        db.update_user_security(
            conn,
            user_id=user_id,
            failed_attempts=0,
            lockout_until_utc=None,
            now=current_time,
        )
        return AuthResult(True, "Authenticated.")

    failed_attempts = int(user["failed_attempts"]) + 1
    lockout_until_utc = None
    if failed_attempts >= LOCKOUT_THRESHOLD:
        lockout_until_utc = db.utc_iso(current_time + LOCKOUT_DURATION)
    db.update_user_security(
        conn,
        user_id=user_id,
        failed_attempts=failed_attempts,
        lockout_until_utc=lockout_until_utc,
        now=current_time,
    )
    if lockout_until_utc:
        raise LockedOutError(
            f"Account is locked until {lockout_until_utc}."
        )
    return AuthResult(False, "Invalid PIN.")

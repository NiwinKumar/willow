"""Check-in reminders: the schedule a person chose (users/{uid}.profile.checkin), a repeating
calendar event for it, and Web Push (VAPID) sent by POST /v1/internal/reminders, which Cloud
Scheduler calls every 15 minutes (docs/CONTRACT.md section 3).

The schedule is `{days: [0..6] (0 = Monday), time: "HH:MM", tz: IANA name}`. All of it works in
the person's own time zone: a reminder is due when the scheduled local time on a scheduled day falls
inside the run's window, and "checked in today" means a session on that local day.
"""

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.settings import Settings
from app.store import Doc

log = logging.getLogger("willow.reminders")

BYDAY = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")

# Push services the browsers use. Subscriptions pointing anywhere else are refused, so the api never
# posts to an address a client made up.
PUSH_HOSTS = (
    "fcm.googleapis.com",  # Chrome, Edge on Android, Samsung Internet
    "updates.push.services.mozilla.com",  # Firefox
    "web.push.apple.com",  # Safari (macOS 13+, iOS 16.4+ installed web apps)
    ".push.apple.com",
    ".notify.windows.com",  # Edge on Windows
)

TEST_CAP_PER_DAY = 10
# A reminder that could not be delivered within a few hours is no longer useful.
PUSH_TTL_SECONDS = 4 * 3600


@dataclass(frozen=True)
class Checkin:
    days: tuple[int, ...]
    time: time
    tz: ZoneInfo

    @property
    def tz_name(self) -> str:
        return self.tz.key


def checkin_of(profile: Doc | None) -> Checkin | None:
    """The stored schedule, or None when there is none or it cannot be read."""
    raw = (profile or {}).get("checkin")
    if not isinstance(raw, dict):
        return None
    days = raw.get("days")
    if not isinstance(days, list) or not days:
        return None
    if not all(isinstance(d, int) and not isinstance(d, bool) and 0 <= d <= 6 for d in days):
        return None
    try:
        hh, mm = str(raw.get("time", "")).split(":")
        at = time(int(hh), int(mm))
        tz = ZoneInfo(str(raw.get("tz") or "UTC"))
    except (ValueError, ZoneInfoNotFoundError):
        return None
    return Checkin(tuple(sorted(set(days))), at, tz)


def scheduled_at(c: Checkin, day: date) -> datetime:
    """The scheduled time on a local day, as a UTC instant.

    A wall time the clocks skip (spring forward, e.g. 02:30) is read with the offset from before the
    jump, so it lands the same distance after it (03:30). A wall time that happens twice (fall back)
    is the first one. Either way there is exactly one instant per scheduled day.
    """
    return datetime.combine(day, c.time).replace(tzinfo=c.tz).astimezone(UTC)


def due_day(c: Checkin, now: datetime, window: timedelta) -> date | None:
    """The local day whose reminder falls in [scheduled, scheduled + window) at `now`, if any.

    Yesterday is checked too: a 23:50 reminder is still due at 00:05 the next local day."""
    today = now.astimezone(c.tz).date()
    for day in (today, today - timedelta(days=1)):
        if day.weekday() in c.days:
            at = scheduled_at(c, day)
            if at <= now < at + window:
                return day
    return None


def _as_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    return None


def checked_in_on(sessions: list[tuple[str, Doc]], tz: ZoneInfo, day: date) -> bool:
    """Any check-in (not failed) started on this local day, whatever the place photographed."""
    for _, doc in sessions:
        at = _as_datetime(doc.get("created_at"))
        if at and doc.get("status") != "failed" and at.astimezone(tz).date() == day:
            return True
    return False


def first_day_from(c: Checkin, start: date) -> date:
    return next(start + timedelta(days=i) for i in range(7) if (start.weekday() + i) % 7 in c.days)


# ---- calendar (.ics) ----


def _esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line: str) -> str:
    """RFC 5545 3.1: lines longer than 75 octets continue on the next line after a space."""
    out, cur = [], b""
    for ch in line:
        b = ch.encode()
        if len(cur) + len(b) > (75 if not out else 74):
            out.append(cur.decode())
            cur = b""
        cur += b
    out.append(cur.decode())
    return "\r\n ".join(out)


def _offset(td: timedelta | None) -> str:
    minutes = int((td or timedelta()).total_seconds() // 60)
    sign = "+" if minutes >= 0 else "-"
    return f"{sign}{abs(minutes) // 60:02d}{abs(minutes) % 60:02d}"


def _transitions(tz: ZoneInfo, start: datetime, end: datetime) -> list[datetime]:
    """UTC instants where the zone's offset changes, found day by day then to the second."""
    found = []
    day = start
    while day < end:
        nxt = day + timedelta(days=1)
        if day.astimezone(tz).utcoffset() != nxt.astimezone(tz).utcoffset():
            lo, hi = day, nxt
            while hi - lo > timedelta(seconds=1):
                mid = lo + (hi - lo) / 2
                if mid.astimezone(tz).utcoffset() == lo.astimezone(tz).utcoffset():
                    lo = mid
                else:
                    hi = mid
            found.append(hi.replace(microsecond=0))
        day = nxt
    return found


def vtimezone(tz: ZoneInfo, start: date, years: int = 10) -> list[str]:
    """A VTIMEZONE for `years` from `start` (RFC 5545 asks for one per TZID used); each kind of
    change (to daylight time, to standard time) is one component listing every date it happens."""
    begin = datetime.combine(start, time()).replace(tzinfo=UTC)
    changes = _transitions(tz, begin, begin + timedelta(days=366 * years))
    lines = ["BEGIN:VTIMEZONE", f"TZID:{tz.key}"]
    if not changes:
        off = _offset(begin.astimezone(tz).utcoffset())
        name = begin.astimezone(tz).tzname() or tz.key
        return [
            *lines,
            "BEGIN:STANDARD",
            "DTSTART:19700101T000000",
            f"TZOFFSETFROM:{off}",
            f"TZOFFSETTO:{off}",
            f"TZNAME:{_esc(name)}",
            "END:STANDARD",
            "END:VTIMEZONE",
        ]
    groups: dict[tuple[str, str, str, bool], list[str]] = {}
    for at in changes:
        before, after = (at - timedelta(seconds=1)).astimezone(tz), at.astimezone(tz)
        key = (
            _offset(before.utcoffset()),
            _offset(after.utcoffset()),
            after.tzname() or "",
            bool(after.dst()),
        )
        # DTSTART of an observance is the change's instant on the clock from before it
        local = (at + (before.utcoffset() or timedelta())).replace(tzinfo=None)
        groups.setdefault(key, []).append(local.strftime("%Y%m%dT%H%M%S"))
    for (frm, to, name, dst), stamps in groups.items():
        kind = "DAYLIGHT" if dst else "STANDARD"
        lines += [f"BEGIN:{kind}", f"DTSTART:{stamps[0]}"]
        if len(stamps) > 1:
            lines.append(f"RDATE:{','.join(stamps[1:])}")
        lines += [f"TZOFFSETFROM:{frm}", f"TZOFFSETTO:{to}"]
        if name:
            lines.append(f"TZNAME:{_esc(name)}")
        lines.append(f"END:{kind}")
    return [*lines, "END:VTIMEZONE"]


def calendar(c: Checkin, uid: str, app_url: str, now: datetime | None = None) -> str:
    """One repeating event on the scheduled days at the scheduled time, alerting at that time."""
    now = now or datetime.now(UTC)
    start = first_day_from(c, now.astimezone(c.tz).date())
    url = app_url.rstrip("/") + "/home"
    days = ",".join(BYDAY[d] for d in c.days)
    stamp = now.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
    event_uid = hashlib.sha256(f"willow-checkin:{uid}".encode()).hexdigest()[:24]
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Willow//Check-in reminder//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        *vtimezone(c.tz, start - timedelta(days=366)),  # observances from before DTSTART
        "BEGIN:VEVENT",
        f"UID:{event_uid}@willow",
        f"DTSTAMP:{stamp}",
        f"DTSTART;TZID={c.tz_name}:{start.strftime('%Y%m%d')}T{c.time.strftime('%H%M')}00",
        "DURATION:PT10M",
        f"RRULE:FREQ=WEEKLY;BYDAY={days}",
        "SUMMARY:Willow check-in",
        "DESCRIPTION:"
        + _esc(f"Face photos by the same window light as last time. Open Willow: {url}"),
        f"URL:{url}",
        "TRANSP:TRANSPARENT",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:Willow check-in",
        "TRIGGER:PT0M",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"


# ---- Web Push ----


def push_enabled(settings: Settings) -> bool:
    return bool(settings.vapid_public_key and settings.vapid_private_key and settings.vapid_subject)


def subscription_id(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode()).hexdigest()[:32]


def allowed_endpoint(endpoint: str) -> bool:
    parts = urlsplit(endpoint)
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not host or parts.port not in (None, 443):
        return False
    return any(host == h or (h.startswith(".") and host.endswith(h)) for h in PUSH_HOSTS)


def payload(kind: str) -> dict[str, str]:
    """What the notification says. Calm, no numbers, no measurement."""
    if kind == "test":
        return {
            "title": "Willow reminders are on",
            "body": "This is a test. Check-in reminders will reach this device.",
            "url": "/home",
            "tag": "willow-test",
        }
    return {
        "title": "Check-in day",
        "body": "A few face photos by the same window light keeps results comparable.",
        "url": "/home",
        "tag": "willow-checkin",
    }


_vapid_cache: dict[str, Any] = {}


def _vapid(settings: Settings):
    from py_vapid import Vapid

    key = settings.vapid_private_key or ""
    if key not in _vapid_cache:
        _vapid_cache.clear()
        _vapid_cache[key] = Vapid.from_string(private_key=key)
    return _vapid_cache[key]


def send_push(sub: Doc, message: dict[str, str], settings: Settings) -> int:
    """Send one push; answers the push service's HTTP status (0 when it could not be reached)."""
    from pywebpush import WebPushException, webpush

    info = {"endpoint": sub["endpoint"], "keys": sub["keys"]}
    try:
        res = webpush(
            info,
            data=json.dumps(message),
            vapid_private_key=_vapid(settings),
            vapid_claims={"sub": settings.vapid_subject or ""},
            ttl=PUSH_TTL_SECONDS,
            timeout=10,
            headers={"Urgency": "normal"},
        )
        return int(getattr(res, "status_code", 201))
    except WebPushException as exc:
        status = getattr(exc.response, "status_code", None)
        log.warning("push failed: %s", status)
        return int(status or 0)
    except Exception:  # network error, bad key material
        log.exception("push failed")
        return 0


def gone(status: int) -> bool:
    """The push service says this subscription no longer exists: forget it."""
    return status in (404, 410)

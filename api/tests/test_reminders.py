"""Check-in reminders: schedule maths (time zones, DST), the calendar file, push subscriptions,
the scheduler run (dedupe, dead subscriptions) and its OIDC guard."""

import base64
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app import reminders
from app.main import app
from app.settings import Settings, get_settings

FCM = "https://fcm.googleapis.com/fcm/send/abc123"
SUB = {"endpoint": FCM, "keys": {"p256dh": "B" * 87, "auth": "a" * 22}}
WINDOW = timedelta(minutes=30)


def _c(days, at="08:30", tz="Europe/London") -> reminders.Checkin:
    c = reminders.checkin_of({"checkin": {"days": days, "time": at, "tz": tz}})
    assert c is not None
    return c


@pytest.fixture
def settings():
    """Push on (fake VAPID values; sending is replaced in each test that sends)."""
    s = Settings(vapid_public_key="pub", vapid_private_key="priv", vapid_subject="mailto:t@x")
    app.dependency_overrides[get_settings] = lambda: s
    yield s
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
def sent(monkeypatch):
    """Record pushes instead of sending; a test sets statuses[endpoint] to fake a push service."""
    calls: list[tuple[str, dict]] = []
    statuses: dict[str, int] = {}

    def fake(sub, message, _settings):
        calls.append((sub["endpoint"], message))
        return statuses.get(sub["endpoint"], 201)

    monkeypatch.setattr(reminders, "send_push", fake)
    fake.calls, fake.statuses = calls, statuses  # type: ignore[attr-defined]
    return fake


# ---- schedule maths ----


def test_checkin_parsing_rejects_bad_values():
    assert reminders.checkin_of(None) is None
    assert reminders.checkin_of({"checkin": None}) is None
    assert reminders.checkin_of({"checkin": {"days": [], "time": "08:00", "tz": "UTC"}}) is None
    assert reminders.checkin_of({"checkin": {"days": [7], "time": "08:00", "tz": "UTC"}}) is None
    assert reminders.checkin_of({"checkin": {"days": [1], "time": "25:00", "tz": "UTC"}}) is None
    assert reminders.checkin_of({"checkin": {"days": [1], "time": "08:00", "tz": "Mars/X"}}) is None
    c = _c([4, 0, 2, 2])
    assert c.days == (0, 2, 4) and c.tz_name == "Europe/London"


def test_due_in_the_persons_own_time_zone():
    c = _c([3], "09:00", "Asia/Kolkata")  # Thursday 09:00 IST = 03:30 UTC
    thu = datetime(2026, 10, 15, 3, 30, tzinfo=UTC)
    assert reminders.due_day(c, thu, WINDOW) == date(2026, 10, 15)
    assert reminders.due_day(c, thu + timedelta(minutes=29), WINDOW) == date(2026, 10, 15)
    assert reminders.due_day(c, thu + timedelta(minutes=30), WINDOW) is None
    assert reminders.due_day(c, thu - timedelta(minutes=1), WINDOW) is None
    assert reminders.due_day(c, thu + timedelta(days=1), WINDOW) is None  # Friday: not scheduled


def test_late_evening_reminder_still_due_after_local_midnight():
    c = _c([3], "23:50", "America/New_York")  # Thursday 23:50 EDT
    after_midnight = datetime(2026, 10, 16, 4, 5, tzinfo=UTC)  # Friday 00:05 EDT
    assert reminders.due_day(c, after_midnight, WINDOW) == date(2026, 10, 15)


def test_dst_spring_forward_skipped_time_fires_once_after_the_jump():
    # 14 Mar 2027 (Sunday) New York jumps 02:00 -> 03:00; 02:30 does not exist.
    c = _c([6], "02:30", "America/New_York")
    at = reminders.scheduled_at(c, date(2027, 3, 14))
    assert at == datetime(2027, 3, 14, 7, 30, tzinfo=UTC)  # 03:30 EDT
    runs = [datetime(2027, 3, 14, 5, 0, tzinfo=UTC) + timedelta(minutes=15 * i) for i in range(24)]
    assert sum(reminders.due_day(c, r, timedelta(minutes=15)) is not None for r in runs) == 1


def test_dst_fall_back_repeated_time_is_the_first_one():
    # 1 Nov 2026 (Sunday) New York: 01:30 happens twice (EDT, then EST).
    c = _c([6], "01:30", "America/New_York")
    assert reminders.scheduled_at(c, date(2026, 11, 1)) == datetime(2026, 11, 1, 5, 30, tzinfo=UTC)
    second = datetime(2026, 11, 1, 6, 30, tzinfo=UTC)  # the repeated 01:30 EST
    assert reminders.due_day(c, second, timedelta(minutes=15)) is None


def test_dst_keeps_the_local_time_across_the_change():
    c = _c([0], "08:00", "Europe/London")
    summer = reminders.scheduled_at(c, date(2026, 10, 19))  # BST
    winter = reminders.scheduled_at(c, date(2026, 10, 26))  # GMT
    assert (summer.hour, winter.hour) == (7, 8)


def test_checked_in_uses_the_local_day_and_ignores_failed():
    tz = ZoneInfo("Asia/Kolkata")
    late_utc = datetime(2026, 10, 15, 20, 0, tzinfo=UTC)  # 16 Oct 01:30 IST
    sessions = [("s1", {"created_at": late_utc, "status": "done"})]
    assert reminders.checked_in_on(sessions, tz, date(2026, 10, 16))
    assert not reminders.checked_in_on(sessions, tz, date(2026, 10, 15))
    failed = [("s2", {"created_at": "2026-10-16T05:00:00Z", "status": "failed"})]
    assert not reminders.checked_in_on(failed, tz, date(2026, 10, 16))


def test_push_endpoints_are_limited_to_browser_push_services():
    assert reminders.allowed_endpoint(FCM)
    assert reminders.allowed_endpoint("https://web.push.apple.com/QF2x")
    assert reminders.allowed_endpoint("https://updates.push.services.mozilla.com/wpush/v2/x")
    assert reminders.allowed_endpoint("https://wns2-db5p.notify.windows.com/w/?token=x")
    assert not reminders.allowed_endpoint("http://fcm.googleapis.com/x")
    assert not reminders.allowed_endpoint("https://evil.example/fcm.googleapis.com")
    assert not reminders.allowed_endpoint("https://fcm.googleapis.com.evil.example/x")
    assert not reminders.allowed_endpoint("https://169.254.169.254/latest")
    assert not reminders.allowed_endpoint("https://fcm.googleapis.com:8443/x")


# ---- calendar ----


def test_calendar_is_a_weekly_event_with_alert_and_time_zone(client, fake):
    assert client.get("/v1/me/reminder.ics").status_code == 404
    fake.store.user_merge(
        "u_test",
        {"profile": {"checkin": {"days": [0, 2, 4], "time": "07:45", "tz": "America/New_York"}}},
    )
    res = client.get("/v1/me/reminder.ics")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/calendar")
    body = res.text
    assert body.startswith("BEGIN:VCALENDAR\r\n") and body.endswith("END:VCALENDAR\r\n")
    assert "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR" in body
    assert "DTSTART;TZID=America/New_York:" in body and "T074500" in body
    assert "BEGIN:VALARM" in body and "TRIGGER:PT0M" in body
    assert "URL:https://willow-511508.web.app/home" in body
    assert "TZID:America/New_York" in body and "BEGIN:DAYLIGHT" in body
    assert "TZOFFSETTO:-0400" in body and "TZOFFSETTO:-0500" in body
    assert all(len(line.encode()) <= 75 for line in body.split("\r\n"))
    assert "u_test" not in body  # the event id is a hash


def test_calendar_starts_on_the_next_scheduled_day_and_handles_no_dst_zones():
    c = _c([5], "10:00", "Asia/Kolkata")
    now = datetime(2026, 10, 15, 6, 0, tzinfo=UTC)  # Thursday
    body = reminders.calendar(c, "u", "https://app.example", now)
    assert "DTSTART;TZID=Asia/Kolkata:20261017T100000" in body  # Saturday
    assert "TZOFFSETTO:+0530" in body and "DAYLIGHT" not in body


def test_vtimezone_change_times_are_on_the_clock_before_the_change():
    lines = reminders.vtimezone(ZoneInfo("America/New_York"), date(2026, 10, 15), years=1)
    text = "\n".join(lines)
    assert "BEGIN:STANDARD\nDTSTART:20261101T020000" in text  # 02:00 EDT -> 01:00 EST
    assert "BEGIN:DAYLIGHT\nDTSTART:20270314T020000" in text  # 02:00 EST -> 03:00 EDT


# ---- push subscriptions ----


def test_push_is_off_without_vapid_keys(client, fake):
    assert client.get("/v1/me/push/key").json() == {"enabled": False, "public_key": None}
    assert client.post("/v1/me/push", json=SUB).status_code == 503
    assert client.post("/v1/me/push/test").status_code == 503
    run = client.post("/v1/internal/reminders").json()
    assert run["enabled"] is False and run["sent"] == 0


def test_subscribe_is_idempotent_and_unsubscribe_forgets(client, fake, settings):
    assert client.get("/v1/me/push/key").json() == {"enabled": True, "public_key": "pub"}
    first = client.post("/v1/me/push", json=SUB).json()
    again = client.post("/v1/me/push", json=SUB).json()
    assert first["id"] == again["id"] == reminders.subscription_id(FCM)
    subs = fake.store.push_list("u_test")
    assert len(subs) == 1 and subs[0][1]["keys"] == SUB["keys"]
    bad = client.post("/v1/me/push", json={**SUB, "endpoint": "https://evil.example/x"})
    assert bad.status_code == 422
    assert client.request("DELETE", "/v1/me/push", json={"endpoint": FCM}).status_code == 204
    assert fake.store.push_list("u_test") == []


def test_unsubscribe_without_body_forgets_every_device(client, fake, settings):
    client.post("/v1/me/push", json=SUB)
    client.post("/v1/me/push", json={**SUB, "endpoint": "https://web.push.apple.com/x"})
    assert len(fake.store.push_list("u_test")) == 2
    assert client.delete("/v1/me/push").status_code == 204
    assert fake.store.push_list("u_test") == []


def test_test_notification_reaches_devices_and_drops_dead_ones(client, fake, settings, sent):
    client.post("/v1/me/push", json=SUB)
    client.post("/v1/me/push", json={**SUB, "endpoint": "https://web.push.apple.com/gone"})
    sent.statuses["https://web.push.apple.com/gone"] = 410
    res = client.post("/v1/me/push/test").json()
    assert res == {"sent": 1, "removed": 1, "failed": 0}
    assert [e for e, _ in sent.calls] and sent.calls[0][1]["tag"] == "willow-test"
    assert len(fake.store.push_list("u_test")) == 1


def test_test_notifications_are_capped(client, fake, settings, sent):
    client.post("/v1/me/push", json=SUB)
    codes = [client.post("/v1/me/push/test").status_code for _ in range(11)]
    assert codes[:10] == [200] * 10 and codes[10] == 429


def test_deleting_the_account_forgets_subscriptions(client, fake, settings):
    client.post("/v1/me/push", json=SUB)
    client.delete("/v1/me")
    assert fake.store.push_list("u_test") == []


# ---- the scheduler run ----


class _Clock(datetime):
    now_value = datetime(2026, 10, 15, 7, 35, tzinfo=UTC)  # Thu 08:35 BST

    @classmethod
    def now(cls, tz=None):
        return cls.now_value if tz else cls.now_value.replace(tzinfo=None)


@pytest.fixture
def clock(monkeypatch):
    from app.routes import reminders_routes

    monkeypatch.setattr(reminders_routes, "datetime", _Clock)
    monkeypatch.setattr(_Clock, "now_value", datetime(2026, 10, 15, 7, 35, tzinfo=UTC))
    return _Clock


def _person(fake, uid, days=(3,), at="08:30", tz="Europe/London", endpoint=FCM):
    fake.store.user_merge(uid, {"profile": {"checkin": {"days": list(days), "time": at, "tz": tz}}})
    fake.store.push_set(uid, reminders.subscription_id(endpoint), {**SUB, "endpoint": endpoint})


def test_run_sends_once_per_day(client, fake, settings, sent, clock):
    _person(fake, "due")
    _person(fake, "other_day", days=(4,), endpoint="https://web.push.apple.com/o")
    _person(fake, "later", at="12:00", endpoint="https://web.push.apple.com/l")
    first = client.post("/v1/internal/reminders").json()
    assert first == {"enabled": True, "due": 1, "sent": 1, "skipped": 0, "removed": 0, "failed": 0}
    assert sent.calls == [(FCM, reminders.payload("checkin"))]
    clock.now_value = clock.now_value + timedelta(minutes=15)  # next run, still in the window
    second = client.post("/v1/internal/reminders").json()
    assert second["sent"] == 0 and second["skipped"] == 1
    assert len(sent.calls) == 1


def test_run_skips_people_who_checked_in_today_or_have_no_device(
    client, fake, settings, sent, clock
):
    _person(fake, "checked")
    fake.store.session_set(
        "checked",
        "s_20261015_aaaaaaaa",
        {
            "site": "face_full",
            "status": "done",
            "created_at": datetime(2026, 10, 15, 6, 0, tzinfo=UTC),
        },
    )
    fake.store.user_merge(
        "no_device", {"profile": {"checkin": {"days": [3], "time": "08:30", "tz": "Europe/London"}}}
    )
    res = client.post("/v1/internal/reminders").json()
    assert res["due"] == 2 and res["skipped"] == 2 and res["sent"] == 0
    assert sent.calls == []
    # skipped people are not marked as reminded: a later run the same day could still send
    assert fake.store.reminders_sent == {}


def test_run_removes_dead_subscriptions(client, fake, settings, sent, clock):
    _person(fake, "due")
    sent.statuses[FCM] = 404
    res = client.post("/v1/internal/reminders").json()
    assert res["removed"] == 1 and res["sent"] == 0
    assert fake.store.push_list("due") == []


def test_run_uses_each_persons_time_zone(client, fake, settings, sent, clock):
    # 07:35 UTC = 13:05 IST: a 13:00 Kolkata Thursday reminder is due, an 08:30 one is not.
    _person(fake, "kolkata", at="13:00", tz="Asia/Kolkata")
    _person(
        fake,
        "kolkata_morning",
        at="08:30",
        tz="Asia/Kolkata",
        endpoint="https://web.push.apple.com/k",
    )
    res = client.post("/v1/internal/reminders").json()
    assert res["sent"] == 1 and sent.calls[0][0] == FCM


# ---- the scheduler guard (production auth mode) ----


@pytest.fixture
def prod(settings):
    s = settings.model_copy(
        update={
            "auth_mode": "firebase",
            "reminders_audience": "https://api.example/v1/internal/reminders",
        }
    )
    app.dependency_overrides[get_settings] = lambda: s
    return s


def test_scheduler_route_needs_a_token(client, fake, prod):
    assert client.post("/v1/internal/reminders").status_code == 401


def test_scheduler_route_is_closed_until_configured(client, fake, prod):
    unset = prod.model_copy(update={"reminders_audience": None})
    app.dependency_overrides[get_settings] = lambda: unset
    assert client.post("/v1/internal/reminders").status_code == 503


def test_scheduler_route_checks_audience_and_service_account(client, fake, prod, monkeypatch, sent):
    from google.oauth2 import id_token

    seen = {}

    def verify(token, _request, audience=None):
        seen["audience"] = audience
        if token == "bad":
            raise ValueError("wrong audience")
        email = "sa-scheduler@willow-511508.iam.gserviceaccount.com" if token == "ok" else "x@y"
        return {"email": email, "email_verified": True}

    monkeypatch.setattr(id_token, "verify_oauth2_token", verify)
    h = lambda t: {"Authorization": f"Bearer {t}"}  # noqa: E731
    assert client.post("/v1/internal/reminders", headers=h("bad")).status_code == 401
    assert client.post("/v1/internal/reminders", headers=h("someone")).status_code == 403
    ok = client.post("/v1/internal/reminders", headers=h("ok"))
    assert ok.status_code == 200 and ok.json()["enabled"] is True
    assert seen["audience"] == "https://api.example/v1/internal/reminders"


# ---- the real sender, against a fake push service ----


def test_send_push_encrypts_and_signs_with_vapid(monkeypatch):
    import requests
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    def b64(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    server = ec.generate_private_key(ec.SECP256R1())
    browser = ec.generate_private_key(ec.SECP256R1())
    point = serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    s = Settings(
        vapid_private_key=b64(server.private_numbers().private_value.to_bytes(32, "big")),
        vapid_public_key=b64(server.public_key().public_bytes(*point)),
        vapid_subject="mailto:test@example.com",
    )
    sub = {
        "endpoint": FCM,
        "keys": {"p256dh": b64(browser.public_key().public_bytes(*point)), "auth": b64(b"0" * 16)},
    }
    captured = {}

    class Res:
        status_code = 201
        reason = "Created"
        text = ""
        headers: dict = {}

    def post(url, data=None, headers=None, timeout=None, **_):
        captured.update(url=url, headers=headers, data=data)
        return Res()

    monkeypatch.setattr(requests, "post", post)
    assert reminders.send_push(sub, reminders.payload("checkin"), s) == 201
    assert captured["url"] == FCM
    auth = captured["headers"]["authorization"]
    assert auth.startswith("vapid t=") and s.vapid_public_key in auth
    assert captured["headers"]["content-encoding"] == "aes128gcm"
    assert b"Check-in" not in captured["data"]  # the payload is encrypted

    class Gone:
        status_code = 410
        reason = "Gone"
        text = ""
        headers: dict = {}

    monkeypatch.setattr(requests, "post", lambda *a, **k: Gone())
    assert reminders.send_push(sub, reminders.payload("checkin"), s) == 410

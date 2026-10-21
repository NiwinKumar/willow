"""Copy survey responses into a Google Sheet (docs/SURVEY.md).

Firestore is the record; the sheet is a readable copy for the founders. Rows are appended with
the Sheets API as the api service account (the same impersonation as URL signing, so it works on
Cloud Run and on a laptop), with RAW input so an answer starting with "=" stays text. The sheet
must be shared with that account as an editor, and needs two tabs: "Responses" and "Contacts".
A failed append never fails the response; scripts/survey_sync.py copies anything left behind.
"""

import logging
import time
from functools import lru_cache
from typing import Any
from urllib.parse import quote

import google.auth
from google.auth import impersonated_credentials
from google.auth.transport.requests import AuthorizedSession

from app import survey
from app.settings import get_settings

log = logging.getLogger("willow.survey")

_SCOPE = "https://www.googleapis.com/auth/spreadsheets"
_API = "https://sheets.googleapis.com/v4/spreadsheets"
RESPONSES = "Responses"
CONTACTS = "Contacts"
_LEAD = [
    "submitted_at",
    "response_id",
    "version",
    "source",
    "duration_s",
    "screened_out",
    "suspect",
]
CONTACT_HEADER = ["submitted_at", "response_id", "email", "pilot", "chat"]


def enabled() -> bool:
    return bool(get_settings().survey_sheet_id)


@lru_cache
def _session() -> AuthorizedSession:
    s = get_settings()
    source, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    creds = impersonated_credentials.Credentials(
        source_credentials=source,
        target_principal=s.signing_service_account,
        target_scopes=[_SCOPE],
        lifetime=3600,
    )
    return AuthorizedSession(creds)


def response_header() -> list[str]:
    return _LEAD + [q["id"] for q in survey.answer_columns()]


def response_row(rid: str, doc: dict[str, Any]) -> list[str]:
    answers = doc["answers"]
    lead = [
        doc["submitted_at"].isoformat(timespec="seconds"),
        rid,
        doc["version"],
        doc["source"],
        str(doc["duration_s"]),
        doc["screened_out"] or "",
        ", ".join(doc["suspect"]),
    ]
    cells = [
        survey.label(q["id"], answers[q["id"]]) if q["id"] in answers else ""
        for q in survey.answer_columns()
    ]
    return lead + cells


def contact_row(contact: dict[str, Any]) -> list[str]:
    return [
        contact["consented_at"].isoformat(timespec="seconds"),
        contact["response_id"],
        contact["email"],
        survey.label("pilot", contact["pilot"]) if contact.get("pilot") else "",
        survey.label("chat", contact["chat"]) if contact.get("chat") else "",
    ]


def _call(method: str, url: str, **kw: Any) -> dict[str, Any]:
    for attempt in range(3):
        res = _session().request(method, url, timeout=8, **kw)
        if res.status_code == 429 or res.status_code >= 500:
            time.sleep(0.6 * (attempt + 1))
            continue
        res.raise_for_status()
        return res.json()
    res.raise_for_status()
    return res.json()


_headed: set[str] = set()


def _ensure_header(tab: str, header: list[str]) -> None:
    """Write the header row once into an empty tab (checked once per process)."""
    if tab in _headed:
        return
    sid = get_settings().survey_sheet_id
    got = _call("GET", f"{_API}/{sid}/values/{quote(tab)}!1:1")
    if not got.get("values"):
        _call(
            "PUT",
            f"{_API}/{sid}/values/{quote(tab)}!A1",
            params={"valueInputOption": "RAW"},
            json={"values": [header]},
        )
    _headed.add(tab)


def append(tab: str, header: list[str], rows: list[list[str]]) -> None:
    sid = get_settings().survey_sheet_id
    _ensure_header(tab, header)
    _call(
        "POST",
        f"{_API}/{sid}/values/{quote(tab)}!A1:append",
        params={"valueInputOption": "RAW", "insertDataOption": "INSERT_ROWS"},
        json={"values": rows},
    )


def copy(rid: str, doc: dict[str, Any], contact: dict[str, Any] | None) -> bool:
    """Append one response (and its contact) to the sheet. False when it did not get there."""
    if not enabled():
        return False
    try:
        append(RESPONSES, response_header(), [response_row(rid, doc)])
        if contact:
            append(CONTACTS, CONTACT_HEADER, [contact_row(contact)])
        return True
    except Exception:  # the response is safe in Firestore; the sync script retries
        log.exception("survey %s: sheet append failed", rid)
        return False

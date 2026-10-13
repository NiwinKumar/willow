"""Contract error codes (docs/CONTRACT.md 2.7) and their HTTP statuses."""

STATUS = {
    "bad_request": 400,
    "unsupported_format": 415,
    "frame_unreadable": 422,
    "gcs_access_denied": 403,
    "internal": 500,
}


class EngineError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = STATUS[code]

    def body(self) -> dict:
        return {"error": {"code": self.code, "message": self.message}}

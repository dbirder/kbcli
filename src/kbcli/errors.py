class KBError(Exception):
    def __init__(self, code: str, message: str, **details):
        super().__init__(message)
        self.code = code
        self.details = details

    def result(self):
        return {
            "protocol_version": 1,
            "ok": False,
            "error": {"code": self.code, "message": str(self), "details": self.details},
        }


def result(**values):
    return {"protocol_version": 1, "ok": True, **values}

"""Observe local SQLite state without creating databases, locks or recovery writes."""

import sqlite3
import stat
from contextlib import contextmanager


def state_file_exists(path):
    try:
        information = path.stat()
    except FileNotFoundError:
        return False
    if not stat.S_ISREG(information.st_mode):
        raise OSError("运行状态路径不是常规文件")
    return True


@contextmanager
def readonly_database(path):
    db = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=2)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA query_only=ON")
        yield db
    finally:
        db.close()

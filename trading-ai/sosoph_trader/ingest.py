"""Stream the r/wallstreetbets export into normalised post records.

The CSV has embedded newlines inside `body`, so it must go through the csv
module rather than a line reader. 53k posts is small enough to materialise, but
the reader stays a generator so a larger dump works the same way.
"""

from __future__ import annotations

import csv
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

REQUIRED_COLUMNS = {"title", "score", "id", "comms_num", "created", "body"}


@dataclass(frozen=True)
class Post:
    post_id: str
    created: datetime  # tz-aware UTC
    title: str
    body: str
    score: int
    comments: int


def _to_int(value: str | None) -> int:
    if not value:
        return 0
    try:
        return int(float(value))
    except ValueError:
        return 0


def _to_utc(created: str | None, timestamp: str | None) -> datetime | None:
    """`created` is a unix epoch; `timestamp` is the same instant as UTC text."""
    if created:
        try:
            return datetime.fromtimestamp(float(created), tz=timezone.utc)
        except (ValueError, OSError, OverflowError):
            pass
    if timestamp:
        try:
            return datetime.fromisoformat(timestamp.strip()).replace(
                tzinfo=timezone.utc
            )
        except ValueError:
            pass
    return None


def read_posts(path: str | Path) -> Iterator[Post]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(
            f"{p} not found. Put the Reddit export there, or pass --reddit-csv."
        )

    with p.open(newline="", encoding="utf-8", errors="replace") as fh:
        reader = csv.DictReader(fh)
        cols = set(reader.fieldnames or [])
        missing = REQUIRED_COLUMNS - cols
        if missing:
            raise ValueError(
                f"{p} is missing expected column(s): {sorted(missing)}. "
                f"Found: {sorted(cols)}"
            )

        seen: set[str] = set()
        for row in reader:
            created = _to_utc(row.get("created"), row.get("timestamp"))
            if created is None:
                continue
            pid = (row.get("id") or "").strip()
            if pid and pid in seen:
                continue
            if pid:
                seen.add(pid)
            yield Post(
                post_id=pid,
                created=created,
                title=(row.get("title") or "").strip(),
                body=row.get("body") or "",
                score=_to_int(row.get("score")),
                comments=_to_int(row.get("comms_num")),
            )

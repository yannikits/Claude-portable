"""
parser.py — Parse Claude Code JSONL session transcripts.

Callers: miner.py (parse_transcripts, parse_single_session), src/graph.py (receives SessionEntry)
"""

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Dict, Optional


SKIP_TYPES = {
    "attachment", "file-history-snapshot", "system",
    "permission-mode", "last-prompt", "summary",
}


@dataclass
class SessionEntry:
    session_id: str
    title: str
    timestamp: str   # ISO 8601, e.g. "2026-04-29T15:00:31.253Z"
    messages: List[Dict]  # [{"role": "user"|"assistant", "content": str}]
    cwd: str


def _extract_content(content) -> str:
    """Flatten content field — string or list of {type, text} objects."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(item.get("text", ""))
        return "\n".join(parts)
    return ""


def _parse_file(path: Path) -> Optional[SessionEntry]:
    """Parse a single JSONL file into a SessionEntry."""
    messages = []
    title = ""
    first_timestamp = ""
    first_cwd = ""
    session_id = path.stem  # filename stem as fallback

    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for raw_line in f:
                raw_line = raw_line.strip()
                if not raw_line:
                    continue
                try:
                    obj = json.loads(raw_line)
                except json.JSONDecodeError:
                    continue

                msg_type = obj.get("type", "")

                if msg_type in SKIP_TYPES:
                    continue

                # Grab session_id from any record
                sid = obj.get("sessionId")
                if sid and session_id == path.stem:
                    session_id = sid

                if msg_type == "ai-title":
                    title = obj.get("aiTitle", "")
                    continue

                if msg_type not in ("user", "assistant"):
                    continue

                timestamp = obj.get("timestamp", "")
                cwd = obj.get("cwd", "")

                if not first_timestamp and timestamp:
                    first_timestamp = timestamp
                if not first_cwd and cwd:
                    first_cwd = cwd

                message = obj.get("message", {})
                role = message.get("role", msg_type)
                content_raw = message.get("content", "")
                content = _extract_content(content_raw)

                if content.strip():
                    messages.append({"role": role, "content": content})

    except (OSError, IOError):
        return None

    if not messages and not title:
        return None

    if not title:
        for m in messages:
            if m["role"] != "user":
                continue
            for line in m["content"].splitlines():
                line = line.strip()
                if line and not line.startswith("<") and not line.startswith("[") and not line.startswith("/"):
                    title = line[:60]
                    break
            if title:
                break
        if not title:
            title = path.stem

    return SessionEntry(
        session_id=session_id,
        title=title,
        timestamp=first_timestamp,
        messages=messages,
        cwd=first_cwd,
    )


def parse_transcripts(transcripts_path: str) -> List[SessionEntry]:
    """
    Parse all top-level .jsonl files in transcripts_path.
    Returns list of SessionEntry, skipping empty files.
    """
    base = Path(transcripts_path)
    if not base.exists():
        return []

    files = sorted(base.glob("*.jsonl"))
    entries = []
    for f in files:
        entry = _parse_file(f)
        if entry is not None:
            entries.append(entry)

    return entries


def parse_single_session(transcripts_path: str, session_id: str) -> Optional[SessionEntry]:
    """Parse a single session by ID."""
    base = Path(transcripts_path)
    target = base / f"{session_id}.jsonl"
    if not target.exists():
        return None
    return _parse_file(target)

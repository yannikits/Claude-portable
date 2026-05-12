"""
chat_import.py — Importiert claude.ai Chat-Export (ZIP) nach Obsidian.

Export-Quelle: claude.ai → Settings → Privacy → Export data
ZIP enthält conversations.json mit allen Chats.

Ausgabe: <vault>/Claude-Chat/<datum> - <titel>.md
"""

import json
import re
import zipfile
from datetime import datetime
from pathlib import Path
from typing import List, Optional


def _safe_filename(name: str, max_len: int = 80) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', name)
    name = name.strip('. ')
    return name[:max_len] or "Unnamed"


def _date_prefix(iso: str) -> str:
    if not iso:
        return "0000-00-00"
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        return iso[:10]


def _load_conversations(zip_path: str) -> List[dict]:
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()
        candidates = [n for n in names if n.endswith("conversations.json")]
        if not candidates:
            raise FileNotFoundError(
                f"Keine conversations.json in {zip_path}. Dateien: {names}"
            )
        with z.open(candidates[0]) as f:
            return json.load(f)


def _extract_text(msg: dict) -> str:
    """Extrahiert nur type='text' Blöcke aus content (überspringt thinking-Blöcke)."""
    content = msg.get("content", [])
    if isinstance(content, list):
        parts = [
            block.get("text", "").strip()
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        ]
        text = "\n\n".join(p for p in parts if p)
        if text:
            return text
    # Fallback: top-level text Feld
    return msg.get("text", "").strip()


def _write_conversation(conv: dict, output_dir: Path) -> Optional[Path]:
    title = conv.get("name") or conv.get("uuid", "Unnamed")[:8]
    created = conv.get("created_at", "")
    updated = conv.get("updated_at", "")
    uuid = conv.get("uuid", "")
    summary = conv.get("summary", "")

    date_str = _date_prefix(created)
    safe_title = _safe_filename(title)
    file_path = output_dir / f"{date_str} - {safe_title}.md"

    messages = conv.get("chat_messages", [])

    lines = [
        "---",
        f"uuid: {uuid}",
        f"date: {date_str}",
        f"updated: {_date_prefix(updated)}",
        f"title: \"{safe_title}\"",
        "source: claude-chat",
        "tags: [claude-chat, session]",
        "---",
        "",
        f"# {safe_title}",
        "",
    ]

    if summary:
        lines += ["## Zusammenfassung", "", summary[:600].strip(), "", "---", ""]

    lines.append("## Chat")
    lines.append("")

    for msg in messages:
        sender = msg.get("sender", "")
        text = _extract_text(msg)
        if not text:
            continue
        label = "**Du:**" if sender == "human" else "**Claude:**"
        lines.append(f"{label}")
        lines.append("")
        lines.append(text)
        lines.append("")
        lines.append("---")
        lines.append("")

    file_path.write_text("\n".join(lines), encoding="utf-8")
    return file_path


def _write_project(proj: dict, output_dir: Path) -> Optional[Path]:
    name = proj.get("name") or proj.get("uuid", "Unnamed")[:8]
    description = proj.get("description", "")
    created = proj.get("created_at", "")
    updated = proj.get("updated_at", "")
    uuid = proj.get("uuid", "")
    prompt = proj.get("prompt_template", "")
    docs = proj.get("docs", [])

    date_str = _date_prefix(created)
    safe_name = _safe_filename(name)
    file_path = output_dir / f"{safe_name}.md"

    lines = [
        "---",
        f"uuid: {uuid}",
        f"date: {date_str}",
        f"updated: {_date_prefix(updated)}",
        f"title: \"{safe_name}\"",
        "source: claude-project",
        "tags: [claude-project]",
        "---",
        "",
        f"# {safe_name}",
        "",
    ]

    if description:
        lines += ["## Beschreibung", "", description.strip(), ""]

    if prompt:
        lines += ["## System Prompt", "", f"```\n{prompt.strip()}\n```", ""]

    if docs:
        lines += ["## Dokumente", ""]
        for doc in docs:
            doc_name = doc.get("filename", "Unnamed")
            content = doc.get("content", "").strip()
            lines += [f"### {doc_name}", "", content, ""]

    file_path.write_text("\n".join(lines), encoding="utf-8")
    return file_path


def import_projects(zip_path: str, vault_path: str) -> List[str]:
    """Importiert projects/*.json aus dem ZIP nach <vault>/Claude-Projects/."""
    output_dir = Path(vault_path) / "Claude-Projects"
    output_dir.mkdir(parents=True, exist_ok=True)

    written = []
    with zipfile.ZipFile(zip_path) as z:
        proj_entries = [e for e in z.namelist() if e.startswith("projects/") and e.endswith(".json")]
        print(f"[chat-import] {len(proj_entries)} Projekt(e) gefunden")
        for entry in proj_entries:
            try:
                with z.open(entry) as f:
                    proj = json.load(f)
                path = _write_project(proj, output_dir)
                if path:
                    written.append(str(path))
            except Exception as e:
                print(f"[chat-import] Fehler bei Projekt '{entry}': {e}")

    return written


def import_chats(zip_path: str, vault_path: str) -> List[str]:
    """
    Importiert alle Conversations aus dem ZIP nach <vault>/Claude-Chat/.
    Gibt Liste der geschriebenen Dateipfade zurück.
    """
    output_dir = Path(vault_path) / "Claude-Chat"
    output_dir.mkdir(parents=True, exist_ok=True)

    conversations = _load_conversations(zip_path)
    print(f"[chat-import] {len(conversations)} Conversation(s) gefunden")

    written = []
    skipped = 0
    for conv in conversations:
        try:
            path = _write_conversation(conv, output_dir)
            if path:
                written.append(str(path))
        except Exception as e:
            print(f"[chat-import] Fehler bei '{conv.get('name', '?')}': {e}")
            skipped += 1

    if skipped:
        print(f"[chat-import] {skipped} Conversation(s) übersprungen")

    return written

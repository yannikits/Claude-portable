"""
obsidian.py — Generate Obsidian markdown notes from the knowledge graph.

Callers: miner.py (ObsidianWriter.sync_all)
Reads:   KnowledgeGraph.get_all_sessions, get_session_insights, get_session_links,
         get_themes, get_lessons_learned
Writes:  <vault>/Sessions/*.md, <vault>/Themes/*.md, <vault>/Lessons Learned.md
"""

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Optional

from src.graph import KnowledgeGraph


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


def _wikilink(title: str) -> str:
    return f"[[{title}]]"


def _session_note_title(session: dict) -> str:
    date = _date_prefix(session.get("timestamp", ""))
    title = session.get("title") or session["session_id"][:8]
    return f"{date} - {_safe_filename(title)}"


class ObsidianWriter:
    def __init__(self, vault_path: str, graph: KnowledgeGraph):
        self._vault = Path(vault_path)
        self._graph = graph
        self._sessions_dir = self._vault / "Sessions"
        self._themes_dir = self._vault / "Themes"
        self._vault.mkdir(parents=True, exist_ok=True)
        self._sessions_dir.mkdir(exist_ok=True)
        self._themes_dir.mkdir(exist_ok=True)

    def sync_claude_memory(self, memory_dir: str) -> List[str]:
        """Copy auto-memory *.md files (except MEMORY.md index) to <vault>/Claude-Memory/."""
        src = Path(memory_dir)
        if not src.exists():
            return []
        dst = self._vault / "Claude-Memory"
        dst.mkdir(exist_ok=True)
        written = []
        for f in sorted(src.glob("*.md")):
            if f.name.upper() == "MEMORY.MD":
                continue
            target = dst / f.name
            target.write_text(f.read_text(encoding="utf-8"), encoding="utf-8")
            written.append(str(target))
        return written

    def sync_all(self) -> List[str]:
        """Write/update all notes. Returns list of written file paths."""
        written = []
        sessions = self._graph.get_all_sessions()
        themes = self._graph.get_themes()

        id_to_title = {s["session_id"]: _session_note_title(s) for s in sessions}

        for session in sessions:
            path = self._write_session_note(session, id_to_title, themes)
            if path:
                written.append(str(path))

        for theme in themes:
            path = self._write_theme_note(theme, id_to_title)
            if path:
                written.append(str(path))

        path = self._write_lessons_learned(id_to_title)
        if path:
            written.append(str(path))

        return written

    def _write_session_note(
        self, session: dict, id_to_title: Dict[str, str], themes: List[dict]
    ) -> Optional[Path]:
        note_title = id_to_title.get(session["session_id"], "Unknown")
        file_path = self._sessions_dir / f"{note_title}.md"

        insights = self._graph.get_session_insights(session["session_id"])
        links = self._graph.get_session_links(session["session_id"])

        problems  = [i for i in insights if i["type"] == "problem"]
        solutions = [i for i in insights if i["type"] == "solution"]
        commands  = [i for i in insights if i["type"] == "command"]
        frictions = [i for i in insights if i["type"] == "friction"]

        session_themes = [
            t for t in themes
            if session["session_id"] in t.get("session_ids", [])
        ]

        lines = [
            "---",
            f"session_id: {session['session_id']}",
            f"date: {_date_prefix(session.get('timestamp', ''))}",
            f"cwd: {session.get('cwd', '')}",
            "tags: [claude-code, session]",
            "---",
            "",
            f"# {note_title}",
            "",
        ]

        summary = session.get("summary", "")
        if summary:
            lines += ["## Zusammenfassung / Summary", "", summary[:400], ""]

        if problems or solutions:
            lines += ["## Gelöste Probleme / Problems Solved", ""]
            for p in problems:
                kws = p.get("keywords", [])
                matching_themes = [
                    t for t in session_themes
                    if any(k in t.get("keywords", []) for k in kws)
                ]
                theme_links = " ".join(
                    _wikilink(f"Themes/{_safe_filename(t['name'])}") for t in matching_themes
                )
                lines.append(f"- **Problem:** {p['content']}")
                if theme_links:
                    lines.append(f"  → {theme_links}")
            for s in solutions:
                lines.append(f"- **Lösung / Solution:** {s['content']}")
            lines.append("")

        if commands:
            lines += ["## Verwendete Befehle / Commands Used", ""]
            seen: set = set()
            for c in commands[:8]:
                text = c["content"][:200]
                if text not in seen:
                    seen.add(text)
                    lines.append(f"- {text}")
            lines.append("")

        if frictions:
            lines += ["## Friction / Probleme", ""]
            for f in frictions[:5]:
                lines.append(f"- {f['content'][:200]}")
            lines.append("")

        if links:
            lines += ["## Verknüpfte Sessions / Related Sessions", ""]
            for link in links[:5]:
                other_title = id_to_title.get(link["to_session"], link["to_session"])
                score_pct = int(link["score"] * 100)
                reason = link.get("reason", "")
                lines.append(
                    f"- {_wikilink(f'Sessions/{other_title}')} ({score_pct}% — {reason})"
                )
            lines.append("")

        if session_themes:
            lines += ["## Muster / Themes", ""]
            for t in session_themes:
                tname = _safe_filename(t["name"])
                lines.append(f"- {_wikilink('Themes/' + tname)}")
            lines.append("")

        file_path.write_text("\n".join(lines), encoding="utf-8")
        return file_path

    def _write_theme_note(self, theme: dict, id_to_title: Dict[str, str]) -> Optional[Path]:
        name = _safe_filename(theme["name"])
        file_path = self._themes_dir / f"{name}.md"

        session_ids = theme.get("session_ids", [])
        keywords = theme.get("keywords", [])

        all_solutions = []
        for sid in session_ids:
            insights = self._graph.get_session_insights(sid)
            all_solutions.extend(i["content"] for i in insights if i["type"] == "solution")

        lines = [
            f"# {name}",
            "",
            f"**Keywords:** {', '.join(keywords)}",
            "",
            "## Vorkommen / Occurrences",
            "",
        ]
        for sid in session_ids:
            note_title = id_to_title.get(sid, sid[:8])
            lines.append(f"- {_wikilink(f'Sessions/{note_title}')}")
        lines.append("")

        if all_solutions:
            lines += ["## Bekannte Lösung / Known Solution", "", all_solutions[0][:400], ""]

        file_path.write_text("\n".join(lines), encoding="utf-8")
        return file_path

    def _write_lessons_learned(self, id_to_title: Dict[str, str]) -> Optional[Path]:
        file_path = self._vault / "Lessons Learned.md"
        lessons = self._graph.get_lessons_learned()
        themes = self._graph.get_themes()
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        lines = [
            "# Lessons Learned — Claude Code Sessions",
            "",
            f"Letzte Aktualisierung / Last updated: {now}",
            f"Gesamt / Total: {len(lessons)} Erkenntnisse aus {len(id_to_title)} Sessions",
            "",
        ]

        if themes:
            lines += ["## Nach Thema / By Theme", ""]
            for theme in themes:
                name = theme["name"]
                sids = theme.get("session_ids", [])
                kws = theme.get("keywords", [])
                theme_lessons = [l for l in lessons if l["session_id"] in sids]
                if not theme_lessons:
                    continue
                lines.append(f"### {name}")
                lines.append("")
                if kws:
                    lines += [f"**Keywords:** {', '.join(kws)}", ""]
                for lesson in theme_lessons[:3]:
                    lines.append(f"- **Problem:** {lesson['problem'][:200]}")
                    if lesson.get("solution"):
                        lines.append(f"  **Lösung:** {lesson['solution'][:200]}")
                    note_title = id_to_title.get(lesson["session_id"], lesson["session_id"][:8])
                    lines.append(f"  Session: {_wikilink(f'Sessions/{note_title}')}")
                lines.append("")

        if lessons:
            lines += ["## Alle Erkenntnisse / All Lessons", ""]
            for lesson in lessons:
                note_title = id_to_title.get(lesson["session_id"], lesson["session_id"][:8])
                lines += [
                    f"### {note_title}",
                    f"- **Problem:** {lesson['problem'][:300]}",
                ]
                if lesson.get("solution"):
                    lines.append(f"- **Lösung / Solution:** {lesson['solution'][:300]}")
                lines += [f"- **Session:** {_wikilink(f'Sessions/{note_title}')}", ""]

        file_path.write_text("\n".join(lines), encoding="utf-8")
        return file_path

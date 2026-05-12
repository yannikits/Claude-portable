"""
graph.py — SQLite knowledge graph for sessions, insights, themes, and links.

Callers:
  miner.py         — KnowledgeGraph for mine/search/report/themes/lessons commands
  src/obsidian.py  — get_all_sessions, get_session_insights, get_session_links,
                     get_themes, get_lessons_learned
  src/hook_context.py — find_related_sessions(query)

DB: data/knowledge.db
  sessions  (session_id TEXT PK, title TEXT, timestamp TEXT ISO8601, cwd TEXT, summary TEXT)
  insights  (id INT PK AUTOINCREMENT, session_id TEXT FK, type TEXT, content TEXT,
             keywords TEXT JSON-array, lang TEXT)
  themes    (id INT PK AUTOINCREMENT, name TEXT, keywords TEXT JSON-array,
             session_ids TEXT JSON-array)
  links     (from_session TEXT, to_session TEXT, reason TEXT, score REAL 0.0-1.0)
"""

import json
import sqlite3
from collections import Counter
from pathlib import Path
from typing import List, Dict

from src.parser import SessionEntry
from src.extractor import Insight
from src.embedder import Embedder


DDL = """
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    title TEXT,
    timestamp TEXT,
    cwd TEXT,
    summary TEXT
);
CREATE TABLE IF NOT EXISTS insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    type TEXT,
    content TEXT,
    keywords TEXT,
    lang TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
CREATE TABLE IF NOT EXISTS themes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    keywords TEXT,
    session_ids TEXT
);
CREATE TABLE IF NOT EXISTS links (
    from_session TEXT,
    to_session TEXT,
    reason TEXT,
    score REAL
);
"""


class KnowledgeGraph:
    def __init__(self, db_path: str, embedder: Embedder):
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._embedder = embedder
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._connect() as conn:
            conn.executescript(DDL)

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def add_session(self, entry: SessionEntry, insights: List[Insight]):
        """Insert or replace session + insights, then update themes and links."""
        summary = self._make_summary(entry)
        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO sessions VALUES (?,?,?,?,?)",
                (entry.session_id, entry.title, entry.timestamp, entry.cwd, summary),
            )
            conn.execute("DELETE FROM insights WHERE session_id=?", (entry.session_id,))
            for ins in insights:
                conn.execute(
                    "INSERT INTO insights (session_id, type, content, keywords, lang)"
                    " VALUES (?,?,?,?,?)",
                    (ins.session_id, ins.type, ins.content,
                     json.dumps(ins.keywords), ins.lang),
                )
        self._update_links(entry.session_id)
        self._cluster_themes()

    def _make_summary(self, entry: SessionEntry) -> str:
        title_part = entry.title or entry.session_id
        first_user = next(
            (m["content"] for m in entry.messages if m.get("role") == "user"), ""
        )
        snippet = first_user[:200].replace("\n", " ").strip()
        return f"{title_part}. {snippet}" if snippet else title_part

    def _update_links(self, session_id: str):
        with self._connect() as conn:
            others = conn.execute(
                "SELECT session_id, title, summary FROM sessions WHERE session_id != ?",
                (session_id,),
            ).fetchall()
            current = conn.execute(
                "SELECT summary FROM sessions WHERE session_id=?", (session_id,)
            ).fetchone()

        if not others or not current:
            return

        query_text = current["summary"] or ""
        corpus = [r["summary"] or r["title"] or "" for r in others]
        results = self._embedder.find_similar(query_text, corpus, top_k=3)

        with self._connect() as conn:
            conn.execute(
                "DELETE FROM links WHERE from_session=? OR to_session=?",
                (session_id, session_id),
            )
            for idx, score in results:
                if score < 0.3:
                    continue
                other_id = others[idx]["session_id"]
                other_title = others[idx]["title"] or ""
                reason = f"similar content: {other_title[:50]}"
                conn.execute(
                    "INSERT INTO links VALUES (?,?,?,?)",
                    (session_id, other_id, reason, round(score, 4)),
                )

    def _cluster_themes(self):
        """Greedy similarity clustering of problem/friction insights into themes."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, session_id, content, keywords FROM insights"
                " WHERE type IN ('problem','friction')"
            ).fetchall()

        if not rows:
            return

        texts = [r["content"] for r in rows]
        threshold = 0.7
        assigned = [False] * len(rows)
        clusters: List[List[int]] = []

        for i in range(len(rows)):
            if assigned[i]:
                continue
            cluster = [i]
            assigned[i] = True
            for j in range(i + 1, len(rows)):
                if assigned[j]:
                    continue
                if self._embedder.similarity(texts[i], texts[j]) >= threshold:
                    cluster.append(j)
                    assigned[j] = True
            clusters.append(cluster)

        with self._connect() as conn:
            conn.execute("DELETE FROM themes")
            for cluster in clusters:
                members = [rows[i] for i in cluster]
                all_kw = []
                for m in members:
                    try:
                        all_kw.extend(json.loads(m["keywords"] or "[]"))
                    except (json.JSONDecodeError, TypeError):
                        pass
                top_kws = [kw for kw, _ in Counter(all_kw).most_common(5)]
                theme_name = " / ".join(top_kws[:3]) if top_kws else "General"
                session_ids = list({m["session_id"] for m in members})
                conn.execute(
                    "INSERT INTO themes (name, keywords, session_ids) VALUES (?,?,?)",
                    (theme_name, json.dumps(top_kws), json.dumps(session_ids)),
                )

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def find_related_sessions(self, query: str, top_k: int = 3) -> List[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT session_id, title, summary FROM sessions"
            ).fetchall()
        if not rows:
            return []
        corpus = [r["summary"] or r["title"] or "" for r in rows]
        results = self._embedder.find_similar(query, corpus, top_k=top_k)
        out = []
        for idx, score in results:
            r = rows[idx]
            out.append({
                "session_id": r["session_id"],
                "title": r["title"],
                "summary": r["summary"],
                "score": round(score, 4),
            })
        return out

    def get_themes(self) -> List[dict]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM themes ORDER BY id").fetchall()
        result = []
        for r in rows:
            try:
                kws = json.loads(r["keywords"] or "[]")
                sids = json.loads(r["session_ids"] or "[]")
            except (json.JSONDecodeError, TypeError):
                kws, sids = [], []
            result.append({"id": r["id"], "name": r["name"],
                           "keywords": kws, "session_ids": sids})
        return result

    def get_lessons_learned(self) -> List[dict]:
        with self._connect() as conn:
            problems = conn.execute(
                "SELECT * FROM insights WHERE type='problem' ORDER BY session_id"
            ).fetchall()
        lessons = []
        for prob in problems:
            with self._connect() as conn:
                sol = conn.execute(
                    "SELECT content FROM insights WHERE type='solution'"
                    " AND session_id=? LIMIT 1",
                    (prob["session_id"],),
                ).fetchone()
            lessons.append({
                "session_id": prob["session_id"],
                "problem": prob["content"],
                "solution": sol["content"] if sol else None,
                "keywords": json.loads(prob["keywords"] or "[]"),
                "lang": prob["lang"],
            })
        return lessons

    def search(self, query: str) -> List[dict]:
        q = f"%{query}%"
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT i.*, s.title FROM insights i"
                " JOIN sessions s ON i.session_id=s.session_id"
                " WHERE i.content LIKE ? OR s.title LIKE ? OR s.summary LIKE ?"
                " ORDER BY i.id DESC LIMIT 20",
                (q, q, q),
            ).fetchall()
        return [{"session_id": r["session_id"], "title": r["title"],
                 "type": r["type"], "content": r["content"], "lang": r["lang"]}
                for r in rows]

    def stats(self) -> dict:
        with self._connect() as conn:
            n_sessions = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
            n_insights = conn.execute("SELECT COUNT(*) FROM insights").fetchone()[0]
            n_themes = conn.execute("SELECT COUNT(*) FROM themes").fetchone()[0]
            n_links = conn.execute("SELECT COUNT(*) FROM links").fetchone()[0]
            by_type = conn.execute(
                "SELECT type, COUNT(*) as cnt FROM insights GROUP BY type"
            ).fetchall()
        return {
            "sessions": n_sessions,
            "insights": n_insights,
            "themes": n_themes,
            "links": n_links,
            "by_type": {r["type"]: r["cnt"] for r in by_type},
        }

    def get_all_sessions(self) -> List[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM sessions ORDER BY timestamp"
            ).fetchall()
        return [dict(r) for r in rows]

    def get_session_insights(self, session_id: str) -> List[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM insights WHERE session_id=?", (session_id,)
            ).fetchall()
        return [{"type": r["type"], "content": r["content"],
                 "keywords": json.loads(r["keywords"] or "[]"), "lang": r["lang"]}
                for r in rows]

    def get_session_links(self, session_id: str) -> List[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM links WHERE from_session=? ORDER BY score DESC",
                (session_id,),
            ).fetchall()
        return [dict(r) for r in rows]

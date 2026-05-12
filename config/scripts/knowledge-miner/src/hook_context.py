"""
hook_context.py — Pre-session context injector for UserPromptSubmit hook.

Called by Claude Code hook as a subprocess. Reads user prompt from
CLAUDE_USER_PROMPT env var or stdin JSON {"prompt": "..."}.
Searches the knowledge graph and prints relevant past solutions to stdout
(Claude Code injects hook stdout as system context).
"""

import json
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from src.config import load_config
from src.embedder import Embedder
from src.graph import KnowledgeGraph


def _load_config() -> dict:
    return load_config(BASE_DIR)


def _get_prompt() -> str:
    prompt = os.environ.get("CLAUDE_USER_PROMPT", "").strip()
    if prompt:
        return prompt
    try:
        raw = sys.stdin.read().strip()
        if raw:
            data = json.loads(raw)
            return data.get("prompt", "")
    except Exception:
        pass
    return ""


def main():
    cfg = _load_config()
    data_dir = cfg.get("data_dir", str(BASE_DIR / "data"))
    db_path = str(Path(data_dir) / "knowledge.db")
    threshold = float(cfg.get("similarity_threshold", 0.6))
    max_results = int(cfg.get("max_context_results", 3))
    max_chars = int(cfg.get("max_context_chars", 500))

    if not Path(db_path).exists():
        return

    prompt = _get_prompt()
    if not prompt or len(prompt) < 5:
        return

    try:
        cache_path = str(Path(data_dir) / "embeddings.pkl")
        embedder = Embedder(cache_path=cache_path)
        graph = KnowledgeGraph(db_path=db_path, embedder=embedder)
        results = graph.find_related_sessions(prompt, top_k=max_results)
    except Exception:
        return

    filtered = [r for r in results if r["score"] >= threshold]
    if not filtered:
        return

    lines = ["[Knowledge Miner] Ähnliche vergangene Situationen / Similar past situations:", ""]
    char_count = len(lines[0]) + 1

    for i, r in enumerate(filtered, 1):
        score_pct = int(r["score"] * 100)
        title = r.get("title", r["session_id"][:8])
        summary = (r.get("summary") or "")[:150]
        entry = f"{i}. **{title}** ({score_pct}%)\n   {summary}"
        if char_count + len(entry) > max_chars:
            break
        lines.append(entry)
        char_count += len(entry)

    if len(lines) > 2:
        print("\n".join(lines))


if __name__ == "__main__":
    main()

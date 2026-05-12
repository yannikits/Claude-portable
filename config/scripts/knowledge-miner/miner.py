"""
miner.py — CLI entry point for the Session Knowledge Miner.

Usage:
  python miner.py mine                    # Parse all transcripts, update graph + notes
  python miner.py mine --session <id>     # Mine single session
  python miner.py search "PATH error"     # Query knowledge graph
  python miner.py report                  # Stats + top themes
  python miner.py themes                  # List all detected themes
  python miner.py lessons                 # Print Lessons Learned
  python miner.py context --prompt "..."  # Simulate pre-session hook output
"""

import argparse
import json
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from src.chat_import import import_chats
from src.config import load_config
from src.embedder import Embedder
from src.extractor import extract_insights
from src.graph import KnowledgeGraph
from src.obsidian import ObsidianWriter
from src.parser import parse_transcripts, parse_single_session


def _load_config() -> dict:
    return load_config(BASE_DIR)


def _make_graph(cfg: dict) -> KnowledgeGraph:
    data_dir = cfg.get("data_dir", str(BASE_DIR / "data"))
    Path(data_dir).mkdir(parents=True, exist_ok=True)
    db_path = str(Path(data_dir) / "knowledge.db")
    cache_path = str(Path(data_dir) / "embeddings.pkl")
    embedder = Embedder(cache_path=cache_path)
    print(f"[miner] Embedding backend: {embedder.backend()}")
    return KnowledgeGraph(db_path=db_path, embedder=embedder)


def cmd_mine(cfg: dict, session_id: str = None):
    transcripts_path = cfg.get("transcripts_path", "")
    if not transcripts_path:
        print("[miner] ERROR: transcripts_path not set in config.json", file=sys.stderr)
        return

    graph = _make_graph(cfg)

    if session_id:
        entry = parse_single_session(transcripts_path, session_id)
        if entry is None:
            print(f"[miner] Session {session_id} not found.", file=sys.stderr)
            return
        entries = [entry]
    else:
        entries = parse_transcripts(transcripts_path)

    print(f"[miner] Parsed {len(entries)} session(s)")

    total_insights = 0
    for entry in entries:
        insights = extract_insights(entry)
        graph.add_session(entry, insights)
        total_insights += len(insights)
        date = entry.timestamp[:10] if entry.timestamp else "?"
        print(f"  [{date}] {entry.title[:60]} — {len(insights)} insights")

    print(f"[miner] Total insights extracted: {total_insights}")
    stats = graph.stats()
    print(f"[miner] Graph: {stats['sessions']} sessions, "
          f"{stats['themes']} themes, {stats['links']} links")

    vault_path = cfg.get("obsidian_vault_path", "")
    if vault_path:
        writer = ObsidianWriter(vault_path=vault_path, graph=graph)
        written = writer.sync_all()
        print(f"[miner] Obsidian: {len(written)} note(s) written to {vault_path}")
        for p in written[:10]:
            print(f"  {p}")
        if len(written) > 10:
            print(f"  ... and {len(written) - 10} more")

        memory_path = cfg.get("claude_memory_path", "")
        if memory_path:
            mem_written = writer.sync_claude_memory(memory_path)
            print(f"[miner] Claude-Memory: {len(mem_written)} file(s) synced")
    else:
        print("[miner] obsidian_vault_path not set — skipping Obsidian notes")


def cmd_search(cfg: dict, query: str):
    graph = _make_graph(cfg)
    results = graph.search(query)
    if not results:
        print(f"Keine Ergebnisse / No results for: {query!r}")
        return
    print(f"\nSuchergebnisse / Search results for: {query!r}\n")
    for r in results:
        print(f"  [{r['type'].upper()}] {r['title']}")
        print(f"  {r['content'][:200]}")
        print()


def cmd_report(cfg: dict):
    graph = _make_graph(cfg)
    stats = graph.stats()
    print("\n=== Knowledge Miner Report ===\n")
    print(f"Sessions:  {stats['sessions']}")
    print(f"Insights:  {stats['insights']}")
    print(f"Themes:    {stats['themes']}")
    print(f"Links:     {stats['links']}")
    if stats.get("by_type"):
        print("\nInsights by type:")
        for t, c in sorted(stats["by_type"].items()):
            print(f"  {t:<12} {c}")
    themes = graph.get_themes()
    if themes:
        print("\nTop themes:")
        for t in themes[:5]:
            print(f"  [{len(t['session_ids'])} sessions] {t['name']}")


def cmd_themes(cfg: dict):
    graph = _make_graph(cfg)
    themes = graph.get_themes()
    if not themes:
        print("Keine Themen gefunden / No themes found.")
        return
    print(f"\n=== Themes ({len(themes)}) ===\n")
    for t in themes:
        kws = ", ".join(t["keywords"][:5])
        print(f"  {t['name']}")
        print(f"    Keywords: {kws}")
        print(f"    Sessions: {len(t['session_ids'])}")
        print()


def cmd_lessons(cfg: dict):
    graph = _make_graph(cfg)
    lessons = graph.get_lessons_learned()
    if not lessons:
        print("Keine Erkenntnisse / No lessons learned yet.")
        return
    print(f"\n=== Lessons Learned ({len(lessons)}) ===\n")
    for lesson in lessons:
        print(f"  Problem:  {lesson['problem'][:200]}")
        if lesson.get("solution"):
            print(f"  Lösung:   {lesson['solution'][:200]}")
        kws = ", ".join(lesson.get("keywords", [])[:5])
        if kws:
            print(f"  Keywords: {kws}")
        print()


def cmd_chat_import(cfg: dict, zip_path: str):
    vault_path = cfg.get("obsidian_vault_path", "")
    if not vault_path:
        print("[chat-import] ERROR: obsidian_vault_path nicht in config.json gesetzt", file=sys.stderr)
        return
    written = import_chats(zip_path=zip_path, vault_path=vault_path)
    print(f"[chat-import] {len(written)} Conversation(en) nach {vault_path}/Claude-Chat/ geschrieben")
    for p in written[:5]:
        print(f"  {p}")
    if len(written) > 5:
        print(f"  ... und {len(written) - 5} weitere")

    from src.chat_import import import_projects
    proj_written = import_projects(zip_path=zip_path, vault_path=vault_path)
    print(f"[chat-import] {len(proj_written)} Projekt(e) nach {vault_path}/Claude-Projects/ geschrieben")
    for p in proj_written:
        print(f"  {p}")


def cmd_context(cfg: dict, prompt: str):
    import os
    os.environ["CLAUDE_USER_PROMPT"] = prompt
    from src.hook_context import main as hook_main
    hook_main()


def main():
    parser = argparse.ArgumentParser(description="Session Knowledge Miner CLI")
    sub = parser.add_subparsers(dest="command")

    p_mine = sub.add_parser("mine", help="Parse transcripts, update knowledge graph + Obsidian")
    p_mine.add_argument("--session", help="Mine a single session by ID")

    p_search = sub.add_parser("search", help="Search the knowledge graph")
    p_search.add_argument("query", help="Search query")

    sub.add_parser("report", help="Print stats and top themes")
    sub.add_parser("themes", help="List all detected themes")
    sub.add_parser("lessons", help="Print Lessons Learned")

    p_chat = sub.add_parser("chat-import", help="Claude Chat Export ZIP nach Obsidian importieren")
    p_chat.add_argument("--zip", required=True, help="Pfad zur claude.ai Export-ZIP-Datei")

    p_ctx = sub.add_parser("context", help="Simulate pre-session hook output")
    p_ctx.add_argument("--prompt", required=True, help="Prompt to simulate")

    args = parser.parse_args()
    cfg = _load_config()

    commands = {
        "mine":        lambda: cmd_mine(cfg, session_id=getattr(args, "session", None)),
        "search":      lambda: cmd_search(cfg, args.query),
        "report":      lambda: cmd_report(cfg),
        "themes":      lambda: cmd_themes(cfg),
        "lessons":     lambda: cmd_lessons(cfg),
        "chat-import": lambda: cmd_chat_import(cfg, args.zip),
        "context":     lambda: cmd_context(cfg, args.prompt),
    }

    if args.command in commands:
        commands[args.command]()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()

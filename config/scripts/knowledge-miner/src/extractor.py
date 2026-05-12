"""
extractor.py — Extract structured insights from session messages using pattern matching.

Callers: miner.py (extract_insights), src/graph.py (receives Insight objects)
"""

import re
from dataclasses import dataclass, field
from typing import List

from src.parser import SessionEntry


GERMAN_WORDS = {
    "und", "die", "der", "das", "ist", "mit", "auf", "in", "von",
    "zu", "nicht", "kann", "ich", "du", "wir", "sie", "es", "ein",
    "eine", "einer", "einem", "einen", "wird", "wurde", "haben",
    "hat", "hatte", "sein", "war", "sind", "aber", "oder", "wenn",
    "dann", "auch", "noch", "schon", "wie", "was", "wer", "wo",
    "sehr", "mehr", "alle", "nach", "hier", "dort", "beim", "fur",
    "konnte", "mochte", "musste", "wurde", "bitte", "jetzt", "immer",
}

PROBLEM_PATTERNS = re.compile(
    r'\b(fehler|error|failed|fail|funktioniert\s*nicht|blocked|issue|problem|'
    r'exception|traceback|crash|denied|timeout|nicht\s*gefunden|'
    r'konnte\s*nicht|cannot|can\'t|unable|invalid|broken|missing)\b',
    re.IGNORECASE,
)

SOLUTION_PATTERNS = re.compile(
    r'\b(fixed|behoben|gel[oö]st|the\s*fix|l[oö]sung|try\s*this|'
    r'solution|fixed\s*by|resolved|repariert|funktioniert\s*jetzt|'
    r'works\s*now|i\s*fixed|here\'s\s*the|verwende|use\s*instead)\b',
    re.IGNORECASE,
)

FRICTION_PATTERNS = re.compile(
    r'\b(blocked|denied|timeout|timed?\s*out|failed\s*to\s*connect|'
    r'reconnect|auth|credit|permission|unauthorized|403|401|500|'
    r'connection\s*refused|rate\s*limit|quota)\b',
    re.IGNORECASE,
)

CODE_BLOCK_RE = re.compile(r'```[\w]*\n?(.*?)```|`([^`\n]+)`', re.DOTALL)

KEYWORD_RE = re.compile(
    r'\b('
    r'[A-Z][a-zA-Z0-9]{2,}'
    r'|[a-z][a-zA-Z0-9]*(?:[._\-][a-zA-Z0-9]+)+'
    r'|[a-zA-Z0-9_\-]*\.(?:py|ps1|js|ts|json|yaml|yml|md|sh|bat|exe|cmd)'
    r'|npm|pip|git|node|python|powershell|cmd|wsl|venv'
    r')\b',
    re.IGNORECASE,
)


@dataclass
class Insight:
    type: str           # "problem", "solution", "command", "friction", "pattern"
    content: str        # extracted text, 1-3 sentences max
    keywords: List[str]
    session_id: str
    lang: str           # "de" | "en" | "mixed"


def _detect_language(text: str) -> str:
    words = re.findall(r'\b[a-zA-ZäöüÄÖÜß]+\b', text.lower())
    if not words:
        return "en"
    normalised = [
        w.replace("ä", "a").replace("ö", "o").replace("ü", "u").replace("ß", "ss")
        for w in words
    ]
    german_count = sum(1 for w in normalised if w in GERMAN_WORDS)
    ratio = german_count / len(words)
    if ratio > 0.30:
        return "de"
    if ratio > 0.10:
        return "mixed"
    return "en"


def _extract_keywords(text: str) -> List[str]:
    found = KEYWORD_RE.findall(text)
    seen = set()
    result = []
    for kw in found:
        kw = kw.strip("\"'")
        if kw and kw not in seen and len(kw) > 2:
            seen.add(kw)
            result.append(kw)
    return result[:10]


def _trim_to_sentences(text: str, max_sentences: int = 3) -> str:
    text = text.strip()
    sentences = re.split(r'(?<=[.!?])\s+|\n', text)
    sentences = [s.strip() for s in sentences if s.strip()]
    return " ".join(sentences[:max_sentences])


def _extract_commands(content: str, session_id: str, lang: str) -> List[Insight]:
    insights = []
    for match in CODE_BLOCK_RE.finditer(content):
        code = (match.group(1) or match.group(2) or "").strip()
        if not code or len(code) < 3:
            continue
        start = max(0, match.start() - 120)
        end = min(len(content), match.end() + 120)
        context = content[start:end].replace("\n", " ").strip()
        insight_text = _trim_to_sentences(context, 2)
        keywords = _extract_keywords(code + " " + insight_text)
        insights.append(Insight(
            type="command",
            content=insight_text,
            keywords=keywords,
            session_id=session_id,
            lang=lang,
        ))
    return insights


def extract_insights(entry: SessionEntry) -> List[Insight]:
    """Extract all insights from a SessionEntry's messages."""
    insights: List[Insight] = []
    messages = entry.messages
    last_problem_idx = -1

    for i, msg in enumerate(messages):
        role = msg.get("role", "")
        content = msg.get("content", "")
        lang = _detect_language(content)

        if role == "user":
            if PROBLEM_PATTERNS.search(content):
                text = _trim_to_sentences(content, 3)
                keywords = _extract_keywords(content)
                insights.append(Insight(
                    type="problem",
                    content=text,
                    keywords=keywords,
                    session_id=entry.session_id,
                    lang=lang,
                ))
                last_problem_idx = i

            if FRICTION_PATTERNS.search(content):
                text = _trim_to_sentences(content, 2)
                keywords = _extract_keywords(content)
                insights.append(Insight(
                    type="friction",
                    content=text,
                    keywords=keywords,
                    session_id=entry.session_id,
                    lang=lang,
                ))

        elif role == "assistant":
            if last_problem_idx >= 0 and i > last_problem_idx:
                if SOLUTION_PATTERNS.search(content):
                    text = _trim_to_sentences(content, 3)
                    keywords = _extract_keywords(content)
                    insights.append(Insight(
                        type="solution",
                        content=text,
                        keywords=keywords,
                        session_id=entry.session_id,
                        lang=lang,
                    ))
                    last_problem_idx = -1

            cmd_insights = _extract_commands(content, entry.session_id, lang)
            insights.extend(cmd_insights)

    return insights

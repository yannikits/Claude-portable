# Plan: Claude Agent OS

## Context
Yannik braucht ein zentrales Dashboard zum Verwalten von AI-Agenten (Claude, Codex, Gemini) auf
Windows — für den persönlichen Einsatz und als Team-Tool auf der Arbeit.
Kein existierendes Projekt. Neuaufbau in `C:\Users\reapertakashi\Documents\ClaudeCode\claude-agent-os\`.

## Entscheidungen (bestätigt)
- Interface: Web-Dashboard (Python FastAPI + Browser, http://localhost:8000)
- AI-Integration: Direkte API-Calls (Anthropic SDK, Codex CLI, Gemini CLI)
- Team-Modus: SQLite lokal (default) + per config.json auf PostgreSQL umschaltbar

## Design System
- Colors: Primary #1E3A5F (Navy), Secondary #2563EB (Blue), Accent #059669 (Green)
- Font: Inter (Google Fonts CDN)
- Icons: Heroicons (CDN)
- Style: Micro-interactions, professionell

## Projektstruktur
```
claude-agent-os/
├── src/
│   ├── main.py
│   ├── api/agents.py, tasks.py, projects.py, memory.py, team.py
│   ├── agents/claude_agent.py, codex_agent.py, gemini_agent.py, router.py
│   ├── models/task.py, project.py, agent_run.py, user.py
│   ├── db/database.py, init_db.py
│   └── templates/base.html, dashboard.html, agents.html, tasks.html, projects.html, settings.html
├── static/js/app.js
├── config/config.example.json
├── tests/test_api.py
├── docker-compose.yml, Dockerfile
├── start.bat, requirements.txt, CLAUDE.md
```

## Tech Stack
FastAPI, Jinja2, Tailwind CDN, Alpine.js CDN, SQLAlchemy, Anthropic SDK, subprocess, Uvicorn, SSE

## Verifikation
```
start.bat → http://localhost:8000
pytest tests/ -v
```

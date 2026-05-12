# config.py — Shared config loader with dynamic path resolution.
# Tokens supported in config.json string values:
#   ~              -> current user home directory
#   {projects_dir} -> Claude Code project dir derived from home (C:\Users\alice -> C--Users-alice)

import json
from pathlib import Path


def load_config(base_dir: Path) -> dict:
    cfg_path = base_dir / "config.json"
    try:
        with open(cfg_path, encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        return {}
    return _resolve(cfg)


def _resolve(cfg: dict) -> dict:
    home = Path.home()
    # Claude Code derives project dir name by replacing : and separators with -
    proj_dir = str(home).replace(":", "-").replace("\\", "-").replace("/", "-")

    def expand(v):
        if not isinstance(v, str):
            return v
        v = v.replace("~", str(home))
        v = v.replace("{projects_dir}", proj_dir)
        return str(Path(v).expanduser().resolve())

    return {k: expand(v) for k, v in cfg.items()}

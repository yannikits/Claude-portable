#!/bin/sh
#
# claude-os container entrypoint.
#
# Pre-flight checks:
#  - $CLAUDE_OS_AUTH_TOKEN must be set (the server refuses to boot otherwise)
#  - /data structure exists (vault, config, anthropic-auth-dir)
#  - $ANTHROPIC_CONFIG_DIR points into the volume so `claude auth login`
#    survives container restarts
#
# Then exec the headless server. Signals from tini are propagated to node
# which triggers the graceful-shutdown path in src/server/index.ts.
set -e

if [ -z "${CLAUDE_OS_AUTH_TOKEN}" ]; then
  cat >&2 <<'EOM'
FATAL: $CLAUDE_OS_AUTH_TOKEN is not set.

Generate a token with:
  openssl rand -hex 32

Set it in your environment (docker-compose .env file or `docker run -e`)
before starting the container.
EOM
  exit 2
fi

# Volume-backed directories
DATA_DIR="${CLAUDE_OS_DATA_DIR:-/data/config}"
VAULT_DIR="${CLAUDE_OS_VAULT_PATH:-/data/vault}"
ANTHROPIC_DIR="${ANTHROPIC_CONFIG_DIR:-/data/anthropic}"

mkdir -p "${DATA_DIR}" "${VAULT_DIR}" "${ANTHROPIC_DIR}"

# resolveRoot() needs either $CLAUDE_OS_ROOT or a .claude-os-root marker
# file in some ancestor directory. We pin both to /data so the marker
# (and everything else) survives container restarts via the volume.
ROOT_DIR="${CLAUDE_OS_ROOT:-/data}"
mkdir -p "${ROOT_DIR}"
touch "${ROOT_DIR}/.claude-os-root"
export CLAUDE_OS_ROOT="${ROOT_DIR}"

# Export so the node process picks them up
export CLAUDE_OS_DATA_DIR="${DATA_DIR}"
export CLAUDE_OS_VAULT_PATH="${VAULT_DIR}"
export ANTHROPIC_CONFIG_DIR="${ANTHROPIC_DIR}"

# ── claude-CLI credentials persistence ──────────────────────────────
#
# The `claude` CLI hardcodes `~/.claude/.credentials.json` and uses
# atomic-rename (unlink + write) when storing tokens — that destroys
# any symlink we put in place. v1.7.6 tried the "symlink from
# /root/.claude into the volume" pattern and lost the credentials at
# the first re-write.
#
# v1.7.7+: `/root/.claude/` MUST be mounted as a persistent volume by
# docker-compose.yml (see docker-compose.example.yml). The .credentials.json
# then lives **as a real file** in that volume. We then provide a
# READ-ONLY convenience symlink at ${ANTHROPIC_CONFIG_DIR}/.credentials.json
# so the Settings page (which only reads, never writes through it)
# still finds it under the documented path.
#
# Migration step: if a previous container wrote .credentials.json into
# /data/anthropic/ (v1.7.5 or earlier symlink-based setup), move it to
# /root/.claude/ on first boot with the new volume mount.
mkdir -p /root/.claude
chmod 700 /root/.claude

# Forward-migration from /data/anthropic/.credentials.json (when the user
# had a previous deployment that wrote there because we tried the inverse
# symlink direction).
if [ -f "${ANTHROPIC_DIR}/.credentials.json" ] && [ ! -L "${ANTHROPIC_DIR}/.credentials.json" ]; then
  if [ ! -e /root/.claude/.credentials.json ]; then
    echo "==> migrating ${ANTHROPIC_DIR}/.credentials.json → /root/.claude/"
    mv "${ANTHROPIC_DIR}/.credentials.json" /root/.claude/.credentials.json
    chmod 600 /root/.claude/.credentials.json
  else
    # New volume already has credentials — drop the stale legacy copy.
    rm "${ANTHROPIC_DIR}/.credentials.json"
  fi
fi

# Read-only convenience symlink so $ANTHROPIC_CONFIG_DIR/.credentials.json
# resolves to the real file. claude-CLI never touches this path, only the
# Settings page (read-only). Idempotent: ln -sf overwrites any prior link.
ln -sf /root/.claude/.credentials.json "${ANTHROPIC_DIR}/.credentials.json"

# Warn if /root/.claude is NOT a mounted volume — the user has an older
# docker-compose.yml from pre-v1.7.7. Credentials will still work for the
# current container lifetime but will be lost on --force-recreate.
if ! mountpoint -q /root/.claude 2>/dev/null; then
  echo "==> WARNING: /root/.claude is not a mounted volume — credentials will be" >&2
  echo "             lost on container recreation. See docker-compose.example.yml" >&2
  echo "             for the required additional volume entry (v1.7.7+)." >&2
fi

# Restore /root/.claude.json (main config) from latest backup if missing.
# The claude-CLI hardcodes /root/.claude.json (NOT inside /root/.claude/) for
# its main config (MCP clients, project history, settings). That path is in
# the RootFS — lost on container recreation. claude-CLI auto-backups the
# config to /root/.claude/backups/ on every write, and THAT lives in the
# persistent volume.
#
# So on every boot: if the live config is gone, restore from the newest
# backup. claude-CLI then sees a valid config and the user doesn't have to
# re-login or re-add MCP clients.
if [ ! -f /root/.claude.json ]; then
  latest_backup="$(ls -t /root/.claude/backups/.claude.json.backup.* 2>/dev/null | head -1)"
  if [ -n "${latest_backup}" ]; then
    echo "==> restoring /root/.claude.json from backup: ${latest_backup}"
    cp "${latest_backup}" /root/.claude.json
    chmod 600 /root/.claude.json
  fi
fi

# Optional: log to stdout so docker logs captures everything
export CLAUDE_OS_LOG_LEVEL="${CLAUDE_OS_LOG_LEVEL:-info}"

echo "==> claude-os server starting"
echo "    root:      ${ROOT_DIR}"
echo "    vault:     ${VAULT_DIR}"
echo "    data:      ${DATA_DIR}"
echo "    anthropic: ${ANTHROPIC_DIR}"
echo "    static:    ${CLAUDE_OS_STATIC_DIR:-/app/gui/dist}"
echo "    port:      ${PORT:-3000}"
echo "    host:      ${HOST:-0.0.0.0}"

# Pre-flight: doctor --json catches mis-configured secrets backend,
# unmounted vault, and other server-env drift BEFORE the server tries
# to boot and crashes later with cryptic ENOENT/EACCES. The check
# fails-loud — container exits 1 instead of staying in a half-started
# state. Skipped if $CLAUDE_OS_SKIP_DOCTOR=1 (escape hatch for debugging).
if [ "${CLAUDE_OS_SKIP_DOCTOR:-0}" != "1" ]; then
  echo "==> running pre-flight doctor"
  if ! node /app/dist/cli/index.js doctor --json > /tmp/doctor-preflight.json 2>&1; then
    echo "FATAL: claude-os doctor pre-flight failed" >&2
    cat /tmp/doctor-preflight.json >&2
    echo "" >&2
    echo "Set CLAUDE_OS_SKIP_DOCTOR=1 to bypass (debugging only)." >&2
    exit 1
  fi
fi

exec node /app/dist/cli/index.js serve \
  --host "${HOST:-0.0.0.0}" \
  --port "${PORT:-3000}"

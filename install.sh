#!/bin/bash
# Build expert-chat, put it on PATH with `npm link` and install the Claude Code skill as a symlink.
# Usage: ./install.sh [--force]   (--force moves an existing ~/.claude/skills/expert-chat aside first)
set -euo pipefail

repo=$(cd "$(dirname "$0")" && pwd -P)
skills_dir="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
skill="$skills_dir/expert-chat"
force=false
[ "${1:-}" = "--force" ] && force=true

fail() { echo "error: $*" >&2; exit 1; }
warn() { echo "warning: $*" >&2; }

[ "$(uname)" = "Darwin" ] || fail "expert-chat opens its window in iTerm2, so it needs macOS"
command -v node >/dev/null || fail "Node.js 22 or newer is required"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || fail "Node.js 22 or newer is required, found $(node -v)"
[ -d /Applications/iTerm.app ] || warn "iTerm2 was not found in /Applications; the chat window needs it"
command -v claude >/dev/null || warn "the claude CLI is not on PATH; the Claude expert will fail"
command -v codex >/dev/null || warn "the codex CLI is not on PATH; the GPT expert will fail"
command -v jq >/dev/null || warn "jq is not on PATH; the skill uses it to pick the models"

cd "$repo"
npm ci --no-audit --no-fund
npm run build
npm link --no-audit --no-fund

mkdir -p "$skills_dir"
if [ -L "$skill" ] && [ "$(readlink "$skill")" = "$repo/skills/expert-chat" ]; then
  :
elif [ -e "$skill" ] || [ -L "$skill" ]; then
  $force || fail "$skill already exists; rerun with --force to move it aside"
  # Kept outside the skills folder, where Claude Code would load it as a second skill.
  backup="$(dirname "$skills_dir")/skill-backups/expert-chat-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$(dirname "$backup")"
  mv "$skill" "$backup"
  echo "moved the old skill to $backup"
fi
ln -sfn "$repo/skills/expert-chat" "$skill"

echo "installed: $(command -v expert-chat)"
echo "skill:     $skill -> $repo/skills/expert-chat"
echo "In Claude Code say \"open a chat with the experts\" or run /expert-chat."

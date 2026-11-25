#!/bin/bash
# Open an expert-chat room in a new iTerm2 window: open_room.sh <roomDir>
set -euo pipefail

[ $# -eq 1 ] || { echo "usage: open_room.sh <roomDir>" >&2; exit 2; }
room=$(cd "$1" 2>/dev/null && pwd -P) || { echo "room directory does not exist: $1" >&2; exit 1; }
app=$(command -v expert-chat) || { echo "expert-chat is not on PATH: run ./install.sh in the expert-chat repository" >&2; exit 1; }

# The window starts outside this shell: pin this PATH and the node that `npm link` used (nvm may differ there).
node="$(dirname "$app")/node"
[ -x "$node" ] || node=$(command -v node)
# iTerm splits its command string on spaces and quotes, so only this script's path goes through it;
# mktemp names it from a safe alphabet, and everything else is quoted inside the script.
launch=$(mktemp "${TMPDIR:-/tmp}/expert-chat-launch.XXXXXX")
[[ "$launch" =~ ^[A-Za-z0-9/._-]+$ ]] || { echo "unsafe temporary path: $launch" >&2; exit 1; }
{
  printf '#!/bin/bash\n'
  printf 'rm -f -- "$0"\n'
  printf 'export PATH=%q\n' "$PATH"
  # A failed start drops into a shell, so the error stays on screen.
  printf '%q %q %q || exec "${SHELL:-/bin/zsh}" -l\n' "$node" "$(realpath "$app")" "$room"
} > "$launch"

window=$(osascript - "/bin/bash $launch" <<'OSA'
on run argv
  tell application "iTerm2"
    set chat to (create window with default profile command (item 1 of argv))
    return id of chat
  end tell
end run
OSA
)
echo "window_id=$window"
echo "room=$room"

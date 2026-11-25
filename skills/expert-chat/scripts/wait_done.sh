#!/bin/bash
# Wait until the expert-chat app writes <roomDir>/done, then print its word (and the reason, if any).
# Run as one tracked background task; its completion notification is the wait.
set -u
ROOM=$1
BACKSTOP=$((4 * 3600))
start=$(date +%s)
until [ -f "$ROOM/done" ]; do
  if [ $(( $(date +%s) - start )) -ge $BACKSTOP ]; then
    echo "done=timeout"
    exit 0
  fi
  sleep 5
done
echo "done=$(cat "$ROOM/done")"
[ -f "$ROOM/done-reason.txt" ] && echo "reason=$(cat "$ROOM/done-reason.txt")"
[ -f "$ROOM/decision.md" ] && echo "decision=$ROOM/decision.md"
exit 0

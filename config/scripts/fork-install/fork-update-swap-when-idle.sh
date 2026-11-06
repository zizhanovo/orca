#!/bin/bash
# Replace /Applications/Orca.app with the staged Orca.app.next once no agent is working.
# The watcher runs under launchd, outside Orca's process tree, so quitting Orca cannot kill it.
#   start | stop | status | busy | selftest | rollback
set -euo pipefail

APP="/Applications/Orca.app"
NEXT="$APP.next"
PREV="$APP.prev"
APP_BIN="$APP/Contents/MacOS/Orca"
ORCA_CLI="$APP/Contents/Resources/bin/orca"
USERDATA="$HOME/Library/Application Support/orca"
STATE_DIR="$HOME/Library/Application Support/orca-fork-sync"
LABEL="com.zizhanovo.orca-fork-swap"
PLIST="$STATE_DIR/$LABEL.plist"
LOG="$STATE_DIR/swap.log"
LOCK="$STATE_DIR/swap.lock"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

POLL_SECONDS="${POLL_SECONDS:-60}"
IDLE_POLLS="${IDLE_POLLS:-3}"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-21600}"
QUIT_TIMEOUT_SECONDS="${QUIT_TIMEOUT_SECONDS:-600}"
RELAUNCH_TIMEOUT_SECONDS="${RELAUNCH_TIMEOUT_SECONDS:-180}"

mkdir -p "$STATE_DIR/reports"
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
notify() { osascript -e "display notification \"$1\" with title \"Orca fork update\"" 2>/dev/null || true; }
die() { log "ERROR $*"; notify "$*"; echo "swap: $*" >&2; exit 1; }

# Prints "IDLE", "BUSY <n>" followed by names, or "UNKNOWN <why>". Unknown is never treated as idle.
agent_activity() {
  local out
  out="$("$ORCA_CLI" worktree ps --json 2>/dev/null)" || { echo "UNKNOWN cli-failed"; return 0; }
  node -e '
let s = ""
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let j
  try { j = JSON.parse(s) } catch { console.log("UNKNOWN bad-json"); return }
  if (!j || j.ok !== true || !j.result || !Array.isArray(j.result.worktrees)) { console.log("UNKNOWN bad-shape"); return }
  const busy = []
  for (const w of j.result.worktrees) {
    for (const a of w.agents || []) {
      const programState = a.programStatus && a.programStatus.state
      const subagentBusy = (a.subagents || []).some((x) => x.state === "working")
      if (a.state === "working" || programState === "working" || subagentBusy) {
        busy.push((a.conversationName || a.paneKey) + " [" + (w.displayName || "") + "]")
      }
    }
  }
  console.log(busy.length ? "BUSY " + busy.length + "\n" + busy.join("\n") : "IDLE")
})' <<< "$out"
}

# One line per live agent pane, for before/after comparison.
pane_list() {
  "$ORCA_CLI" worktree ps --json | node -e '
let s = ""
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const j = JSON.parse(s)
  const rows = []
  for (const w of j.result.worktrees) for (const a of w.agents || []) rows.push(a.paneKey + "\t" + a.agentType + "\t" + (a.conversationName || ""))
  console.log(rows.sort().join("\n"))
})'
}

app_running() {
  local comms
  comms="$(ps -axo comm=)"
  grep -Fxq "$APP_BIN" <<< "$comms"
}

# First line of agent_activity, read without closing the pipe early.
activity_state() {
  local out
  out="$(agent_activity)"
  echo "${out%%$'\n'*}"
}

wait_until_idle() {
  local idle=0 waited=0 first
  while :; do
    first="$(activity_state)"
    case "$first" in
      IDLE) idle=$((idle + 1)) ;;
      *) idle=0; log "waiting: $first" ;;
    esac
    [ "$idle" -ge "$IDLE_POLLS" ] && return 0
    if [ "$waited" -ge "$MAX_WAIT_SECONDS" ]; then
      log "gave up after ${waited}s; still busy:"; agent_activity >> "$LOG"
      notify "No idle window in $((MAX_WAIT_SECONDS / 3600))h; update not applied (run: busy)"
      exit 3
    fi
    sleep "$POLL_SECONDS"; waited=$((waited + POLL_SECONDS))
  done
}

graceful_quit() {
  local bundle_id waited=0
  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")"
  osascript -e "tell application id \"$bundle_id\" to quit" >/dev/null 2>&1 || true
  while app_running; do
    [ "$waited" -ge "$QUIT_TIMEOUT_SECONDS" ] && die "Orca did not quit within ${QUIT_TIMEOUT_SECONDS}s; nothing was replaced and nothing was killed"
    sleep 2; waited=$((waited + 2))
  done
}

# Move, never copy over: copying onto an existing directory nests it instead of replacing it.
swap_bundles() {
  local ts="$1"
  [ -d "$NEXT" ] || die "no staged build at $NEXT"
  [ ! -e "$PREV" ] || mv "$PREV" "$APP.prev-$ts"
  mv "$APP" "$PREV"
  if ! mv "$NEXT" "$APP"; then
    mv "$PREV" "$APP"
    die "could not move the staged build into place; the old app was restored"
  fi
}

backup_userdata() {
  local ts="$1"
  local backup="$USERDATA.bak-$ts"
  [ -d "$USERDATA" ] || return 0
  cp -cR "$USERDATA" "$backup"
  [ "$(find "$USERDATA" | wc -l)" -eq "$(find "$backup" | wc -l)" ] || die "data backup is incomplete: $backup"
  echo "$backup" > "$STATE_DIR/last-backup"
  log "data backed up to $backup"
}

wait_runtime_ready() {
  local waited=0 out
  while [ "$waited" -lt "$RELAUNCH_TIMEOUT_SECONDS" ]; do
    out="$("$ORCA_CLI" status --json 2>/dev/null || true)"
    grep -q '"state": "ready"' <<< "$out" && return 0
    sleep 3; waited=$((waited + 3))
  done
  return 1
}

watch() {
  mkdir "$LOCK" 2>/dev/null || { log "another watcher holds $LOCK"; exit 0; }
  trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
  local ts report before after
  [ -d "$NEXT" ] || die "no staged build at $NEXT"
  log "watching: ${IDLE_POLLS} idle polls of ${POLL_SECONDS}s needed"
  while :; do
    wait_until_idle
    # One more look right before quitting: an agent may have started since the last poll.
    [ "$(activity_state)" = "IDLE" ] && break
  done
  ts="$(date +%Y%m%d-%H%M%S)"
  report="$STATE_DIR/reports/swap-$ts.md"
  before="$STATE_DIR/reports/swap-$ts.before.tsv"
  pane_list > "$before"
  log "idle; quitting Orca ($(wc -l < "$before" | tr -d ' ') panes recorded)"
  graceful_quit
  backup_userdata "$ts"
  swap_bundles "$ts"
  open "$APP"
  if ! wait_runtime_ready; then
    die "new build did not become ready in ${RELAUNCH_TIMEOUT_SECONDS}s; roll back with: $SELF rollback"
  fi
  sleep 90
  after="$STATE_DIR/reports/swap-$ts.after.tsv"
  pane_list > "$after" || true
  {
    echo "# Orca fork update $ts"
    echo "- version: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
    echo "- old app kept at: $PREV"
    echo "- data backup: $(cat "$STATE_DIR/last-backup" 2>/dev/null || echo none)"
    echo "- panes before: $(wc -l < "$before" | tr -d ' '), after: $(wc -l < "$after" | tr -d ' ')"
    echo "## Panes missing after the restart"
    comm -23 <(cut -f1,3 "$before" | sort) <(cut -f1,3 "$after" | sort)
  } > "$report"
  log "done; report $report"
  notify "Updated. Panes missing after restart: $(comm -23 <(cut -f1 "$before" | sort) <(cut -f1 "$after" | sort) | wc -l | tr -d ' ')"
}

start() {
  [ -d "$NEXT" ] || { echo "nothing staged at $NEXT; run fork-update-stage.sh first" >&2; exit 1; }
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$SELF</string><string>_watch</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
EOF
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "watching for an idle window (log: $LOG); stop with: $SELF stop"
}

stop() { launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && echo stopped || echo "not running"; }

status() {
  [ -f "$STATE_DIR/staged.json" ] && cat "$STATE_DIR/staged.json" || echo "nothing staged"
  launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state =|last exit" || echo "watcher: not loaded"
  tail -5 "$LOG" 2>/dev/null || true
}

rollback() {
  app_running && die "quit Orca first; rollback does not close a running app"
  [ -d "$PREV" ] || die "no previous app at $PREV"
  local ts; ts="$(date +%Y%m%d-%H%M%S)"
  mv "$APP" "$APP.failed-$ts"
  mv "$PREV" "$APP"
  echo "restored the previous app; the failed one is at $APP.failed-$ts"
  echo "data backup (the new build may have migrated the live data): $(cat "$STATE_DIR/last-backup" 2>/dev/null || echo none)"
}

# Read-only: proves each probe works against what is running right now.
selftest() {
  local ok=1 first
  check() { if eval "$2" >/dev/null 2>&1; then echo "PASS $1"; else echo "FAIL $1"; ok=0; fi; }
  check "orca cli present" "[ -x '$ORCA_CLI' ]"
  check "node present" "command -v node"
  check "bundle id readable" "/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' '$APP/Contents/Info.plist'"
  check "running app is detected" "app_running"
  first="$(activity_state)"
  case "$first" in UNKNOWN*) echo "FAIL activity probe ($first)"; ok=0 ;; *) echo "PASS activity probe ($first)" ;; esac
  check "launchctl usable" "launchctl print gui/$(id -u)"
  check "staged build present" "[ -d '$NEXT' ]"
  [ "$ok" -eq 1 ]
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  busy) agent_activity ;;
  selftest) selftest ;;
  rollback) rollback ;;
  _watch) watch ;;
  *) echo "usage: $0 start|stop|status|busy|selftest|rollback" >&2; exit 2 ;;
esac

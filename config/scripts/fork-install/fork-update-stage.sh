#!/bin/bash
# Download the newest fork build and stage it as /Applications/Orca.app.next.
# Never touches the running app: swapping is fork-update-swap-when-idle.sh's job.
set -euo pipefail

REPO_SLUG="zizhanovo/orca"
BRANCH="claude-config-dirs"
WORKFLOW="fork-mac-build.yml"
ARTIFACT="orca-mac-arm64"
APP="/Applications/Orca.app"
NEXT="$APP.next"
STATE_DIR="$HOME/Library/Application Support/orca-fork-sync"

run_id=""
allow_stale=0
while [ $# -gt 0 ]; do
  case "$1" in
    --run-id) run_id="${2:?--run-id needs a value}"; shift 2 ;;
    --allow-stale) allow_stale=1; shift ;;
    *) echo "usage: $0 [--run-id <id>] [--allow-stale]" >&2; exit 2 ;;
  esac
done

fail() { echo "stage: $*" >&2; exit 1; }

command -v gh >/dev/null || fail "gh is required"
[ "$(uname -m)" = "arm64" ] || fail "the fork build is arm64 only"

remote_head="$(gh api "repos/$REPO_SLUG/branches/$BRANCH" --jq .commit.sha)"
[ -n "$remote_head" ] || fail "cannot read the head of $BRANCH"

if [ -z "$run_id" ]; then
  read -r run_id run_sha < <(gh run list --repo "$REPO_SLUG" --workflow "$WORKFLOW" \
    --branch "$BRANCH" --status success --limit 1 \
    --json databaseId,headSha --jq '.[0] | "\(.databaseId) \(.headSha)"')
else
  run_sha="$(gh run view "$run_id" --repo "$REPO_SLUG" --json headSha --jq .headSha)"
fi
[ -n "${run_id:-}" ] && [ "$run_id" != "null" ] || fail "no successful $WORKFLOW run on $BRANCH"

# A missing build for the branch head means "not built yet", never "use the old one".
if [ "$run_sha" != "$remote_head" ] && [ "$allow_stale" -ne 1 ]; then
  cat >&2 <<EOF
stage: newest successful build is for ${run_sha:0:12}, but $BRANCH is at ${remote_head:0:12}.
  Build the head:  gh workflow run $WORKFLOW --repo $REPO_SLUG --ref $BRANCH
  Or stage the older build anyway with --allow-stale.
EOF
  exit 1
fi

# Downloaded content stays in its own new directory.
dest="$STATE_DIR/downloads/$run_id-$(date +%s)"
mkdir -p "$dest"
gh run download "$run_id" --repo "$REPO_SLUG" --name "$ARTIFACT" --dir "$dest/artifact"

zips=("$dest"/artifact/*.zip)
[ "${#zips[@]}" -eq 1 ] && [ -f "${zips[0]}" ] || fail "expected exactly one zip in the artifact"
ditto -x -k "${zips[0]}" "$dest/extracted"

apps=("$dest"/extracted/*.app)
[ "${#apps[@]}" -eq 1 ] && [ -d "${apps[0]}" ] || fail "expected exactly one .app in the zip"
staged_app="${apps[0]}"

plist="$staged_app/Contents/Info.plist"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")"
bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")"
current_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")"
[ "$bundle_id" = "$current_id" ] || fail "bundle id $bundle_id differs from the installed $current_id"
lipo -archs "$staged_app/Contents/MacOS/Orca" | grep -qw arm64 || fail "staged binary has no arm64 slice"

xattr -dr com.apple.quarantine "$staged_app" 2>/dev/null || true
if ! codesign --verify --deep "$staged_app" 2>/dev/null; then
  echo "stage: warning: codesign --verify failed; the fork build may be unsigned" >&2
fi

if [ -e "$NEXT" ]; then
  mkdir -p "$STATE_DIR/superseded"
  mv "$NEXT" "$STATE_DIR/superseded/Orca.app.next-$(date +%s)"
fi
mv "$staged_app" "$NEXT"

node -e '
const [file, runId, sha, version] = process.argv.slice(1)
require("node:fs").writeFileSync(file, JSON.stringify({ runId, sha, version, stagedAt: new Date().toISOString() }, null, 2))
' "$STATE_DIR/staged.json" "$run_id" "$run_sha" "$version"

echo "staged $version (run $run_id, commit ${run_sha:0:12}) at $NEXT"
echo "next: $(dirname "$0")/fork-update-swap-when-idle.sh start"

#!/bin/bash
# Merge an upstream release tag into the current branch so that only fork-owned files differ from it.
# Upstream tags are sibling branches that move and delete files, so a path-by-path conflict loop
# loses the moved copies; merge with -X theirs, then reset every non-fork-owned file to the tag.
#   usage: fork-merge-upstream-tag.sh <ref>      (e.g. refs/tags/v1.4.251)
#   exit 0  merged and committed (or already contained)
#   exit 10 a fork-owned file needs a human; the tree is restored, "needs-human: ..." lines on stdout
#   exit 2  bad input or dirty tree
set -eEuo pipefail

ref="${1:?usage: $0 <ref>}"
PERSONAL_LIST="${PERSONAL_LIST:-config/upstream-sync-personal-files.txt}"
tag="${ref##*/}"

[ -z "$(GIT_OPTIONAL_LOCKS=0 git status --porcelain)" ] || { echo "dirty working tree" >&2; exit 2; }
git rev-parse -q --verify "$ref^{commit}" >/dev/null || { echo "unknown ref $ref" >&2; exit 2; }
if git merge-base --is-ancestor "$ref" HEAD; then
  echo "$tag is already merged"
  exit 0
fi

personal="$(mktemp)"
listing="$(mktemp)"
trap 'rm -f "$personal" "$listing"' EXIT
# Never leave a half-finished merge behind, whatever step fails.
abort_half_merge() {
  local status=$?
  if git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    git merge --abort 2>/dev/null || git reset -q --hard HEAD
  fi
  exit "$status"
}
trap abort_half_merge ERR
grep -v '^[[:space:]]*#' "$PERSONAL_LIST" | sed '/^[[:space:]]*$/d' | sort -u > "$personal"
is_personal() { grep -Fxq -- "$1" "$personal"; }
in_ref() { git cat-file -e "$ref:$1" 2>/dev/null; }

# A fork-owned path that the previous upstream tag had and this one lacks was moved or deleted
# upstream; the list must be updated by a person before the fork's edits can follow it.
previous="$(git tag --merged HEAD --list 'v[0-9]*' --list 'upstream-v[0-9]*' --sort=-v:refname | head -1)"
needs_human=()
if [ -n "$previous" ]; then
  while IFS= read -r file; do
    if git cat-file -e "$previous:$file" 2>/dev/null && ! in_ref "$file"; then
      needs_human+=("$file (moved or deleted upstream since $previous; update $PERSONAL_LIST)")
    fi
  done < "$personal"
fi
if [ "${#needs_human[@]}" -gt 0 ]; then
  printf 'needs-human: %s\n' "${needs_human[@]}"
  exit 10
fi

git merge -X theirs --no-commit --no-ff "$ref" >/dev/null 2>&1 || true
git rev-parse -q --verify MERGE_HEAD >/dev/null || { echo "merge did not start" >&2; exit 2; }

# What -X theirs cannot decide: modify/delete conflicts.
git diff --name-only --diff-filter=U -z > "$listing"
while IFS= read -r -d '' file; do
  if is_personal "$file"; then
    needs_human+=("$file (modify/delete conflict)")
  elif in_ref "$file"; then
    git checkout "$ref" -- "$file"
  else
    git rm -q -f -- "$file"
  fi
done < "$listing"
if [ "${#needs_human[@]}" -gt 0 ]; then
  git merge --abort
  printf 'needs-human: %s\n' "${needs_human[@]}"
  exit 10
fi

# Stale copies of upstream files (the previous tag's versions) survive an automatic merge;
# everything that is not fork-owned must equal the tag.
git diff --cached --name-only -z "$ref" > "$listing"
while IFS= read -r -d '' file; do
  is_personal "$file" && continue
  if in_ref "$file"; then
    git checkout "$ref" -- "$file"
  else
    git rm -q -f -- "$file"
  fi
done < "$listing"

git commit -q -m "merge: upstream Orca $tag into $(git branch --show-current)"
echo "merged $tag"

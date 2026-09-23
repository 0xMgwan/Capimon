#!/usr/bin/env bash
# Decides whether a push is worth a build.
#
# Vercel builds every commit on the production branch, and a build is the
# largest line on this project's bill by an order of magnitude — the functions
# it produces cost cents, the compiling costs dollars. A commit that changes
# only prose has nothing to compile.
#
# Exit 0 to skip the build, 1 to run it. Anything unexpected runs the build:
# a missed deploy is worse than a wasted one.
set -u

changed=$(git diff --name-only HEAD^ HEAD 2>/dev/null) || exit 1
[ -z "$changed" ] && exit 1

# Anything outside this set means a real change.
if echo "$changed" | grep -qvE '^(README\.md|AGENTS\.md|CLAUDE\.md|\.env\.example|docs/|scripts/should-build\.sh)$'; then
  exit 1
fi

echo "Only documentation changed — skipping the build."
exit 0

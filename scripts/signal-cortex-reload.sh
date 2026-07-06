#!/usr/bin/env bash
# Lifecycle postinstall step 1: the running cortex daemon learns about the
# freshly dropped agents.d/example-agent.yaml fragment.
#
# Ordering invariant: reload BEFORE creds issue — the daemon must know the agent
# id it is minting credentials for.
#
# Tolerant: no cortex on PATH or no running daemon is a soft skip (fresh
# machine; the principal boots cortex later and the fragment is picked up at
# boot), but a cortex that IS present and fails the reload is a real error.
set -euo pipefail

if ! command -v cortex >/dev/null 2>&1; then
  echo "example-agent postinstall: cortex not on PATH — skipping reload (fragment loads at next cortex boot)"
  exit 0
fi

if cortex agents reload; then
  echo "example-agent postinstall: cortex agents reload — ok"
else
  echo "example-agent postinstall: cortex agents reload FAILED" >&2
  exit 1
fi

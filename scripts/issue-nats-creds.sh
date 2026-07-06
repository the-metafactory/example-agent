#!/usr/bin/env bash
# Lifecycle postinstall step 2: mint the daemon brain's scoped NATS creds —
# addressable, revocable via `cortex creds revoke example-agent`, never the
# stack key. Runs AFTER signal-cortex-reload.sh per the ordering invariant.
set -euo pipefail

if ! command -v cortex >/dev/null 2>&1; then
  echo "example-agent postinstall: cortex not on PATH — skipping creds issue (run 'cortex creds issue example-agent' after cortex install)"
  exit 0
fi

if cortex creds issue example-agent; then
  echo "example-agent postinstall: cortex creds issue example-agent — ok"
else
  echo "example-agent postinstall: cortex creds issue example-agent FAILED" >&2
  exit 1
fi

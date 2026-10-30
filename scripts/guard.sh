#!/bin/sh
# Fails if the public repo picks up anything that must stay private:
# Stripe code (this repo is PayPal-only) or real people's data folders.
set -e
cd "$(dirname "$0")/.."
if git grep -n -i -E "(^|[^a-z])stripe([^a-z]|$)|@stripe/|stripe_" -- ':!pnpm-lock.yaml' ':!scripts/guard.sh' ':!docs/*' ':!README.md'; then
  echo "guard: Stripe reference found (this repo is PayPal-only)" >&2
  exit 1
fi
for dir in outreach .demo-data .claude; do
  if [ -n "$(git ls-files "$dir")" ]; then
    echo "guard: $dir/ must never be committed" >&2
    exit 1
  fi
done
echo "guard: ok"

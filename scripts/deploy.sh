#!/bin/sh
# Deploys the committed HEAD to Vercel production.
# The build runs on this machine: it needs about 8.7 GB of RAM (Turbopack + Bryntum), above the 8 GB of
# Vercel's build containers, so Vercel only receives the prebuilt output.
# Needs: the Vercel CLI logged in to the Margins team, and a clean commit (uncommitted changes are not deployed).
set -e
cd "$(dirname "$0")/.."
OUT="${TMPDIR:-/tmp}/kitoko-receptionist-deploy"
rm -rf "$OUT" && mkdir -p "$OUT"
git archive HEAD | tar -x -C "$OUT"
mkdir -p "$OUT/.vercel"
cat > "$OUT/.vercel/project.json" <<'JSON'
{"projectId":"prj_jEBO5lBmwIKliryXx409xiuZktcd","orgId":"team_A8mjQRT5Htz7yuZBsXFc54wE","projectName":"kitoko-receptionist"}
JSON
cd "$OUT"
pnpm install --frozen-lockfile
vercel pull --yes --environment=production --scope margins-ba39f49e
vercel build --prod --scope margins-ba39f49e
vercel deploy --prebuilt --prod --archive=tgz --yes --scope margins-ba39f49e

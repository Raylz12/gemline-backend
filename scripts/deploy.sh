#!/bin/bash
# Gemline production deploy
cd "$(dirname "$0")/.."
export VERCEL_PROJECT_ID=prj_dDBhiYPkrTycXq0pl7CCTsbw9k5D
export VERCEL_ORG_ID=a5vahxw4IbDSk2fhCloB6dgK
TOKEN=$(cat ~/.vercel-token 2>/dev/null)
exec /home/ubuntu/.npm-global/bin/vercel --prod --yes --token "$TOKEN"

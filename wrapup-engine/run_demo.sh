#!/bin/bash
# מפעיל את שתי המערכות לדמו: מערכת הבנק (9000) ו-WrapUpAI (8000)
cd "$(dirname "$0")"
pkill -f "uvicorn app:app --app-dir mock_crm" 2>/dev/null
pkill -f "uvicorn main:app --app-dir app" 2>/dev/null
sleep 1
.venv/bin/uvicorn app:app --app-dir mock_crm --port 9000 > mock_crm.log 2>&1 &
.venv/bin/uvicorn main:app --app-dir app --port 8000 > wrapup.log 2>&1 &
sleep 3
# טוענים את התקנון של הבנק ל-Policy Guard
python3 -c "import json;print(json.dumps({'text':open('samples/policy_bank.txt',encoding='utf-8').read()}))" \
  | curl -s -X PUT -H 'Content-Type: application/json' -d @- localhost:8000/api/policy > /dev/null
echo "🏦 מערכת הבנק:  http://localhost:9000"
echo "🤖 WrapUpAI:     http://localhost:8000"
# open http://localhost:9000 http://localhost:8000 2>/dev/null

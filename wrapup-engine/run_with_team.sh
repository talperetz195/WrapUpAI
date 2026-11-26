#!/bin/bash
# דמו משולב: מערכת המרכזייה (שורש הריפו, פורט 3000) + WrapUpAI כמערכת החיצונית (8000)
# דרישות: .env בתיקייה הזו (ראו .env.example) ו-.env בשורש הריפו עם INTERNAL_BRIDGE_SECRET זהה ל-TEAM_BRIDGE_SECRET
cd "$(dirname "$0")"
pkill -f "uvicorn main:app" 2>/dev/null; pkill -f "tsx server.ts" 2>/dev/null; sleep 1
BUSINESS_NAME="מוסד תגמולים וביטוח" .venv/bin/uvicorn main:app --app-dir app --port 8000 > wrapup.log 2>&1 &
(cd .. && npm run dev > wrapup-engine/team.log 2>&1 &)
sleep 10
echo "🏛️  מרכזייה: http://localhost:3000    🤖 WrapUpAI: http://localhost:8000"

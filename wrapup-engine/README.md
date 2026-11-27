# 📞 עוזר שיחות: הקלטה מהמרכזייה → תמלול → ניתוח AI → תיק לקוח → דוחות

הכלי רץ על השרת של העסק ועוקב אחרי תיקיית ההקלטות של המרכזייה.
כל הקלטה חדשה מעובדת אוטומטית, בלי שהנציג עושה כלום.

## הרצה
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # ממלאים מפתחות (בלי מפתחות = מצב דמו)
.venv/bin/uvicorn main:app --app-dir app
```
פותחים: http://localhost:8000

## 🎬 דמו אינטגרציה (מומלץ)
```bash
./run_demo.sh
```
מפעיל שתי מערכות נפרדות:
- 🏦 **http://localhost:9000**: "מערכת המוקד של בנק השרון" (מערכת דמה של העסק, עם API מאובטח)
- 🤖 **http://localhost:8000**: WrapUpAI, שמחובר לבנק דרך `app/connectors.py`

לוחצים במערכת הבנק "סיום שיחה". WrapUpAI מושך את ההקלטה לבד, מתמלל, מנתח, ומחזיר את הסיכום לתיק הלקוח בבנק.
הקלטות לדמו: `mock_crm/pool/` (מספר טלפון של לקוח בשם הקובץ = שיוך ללקוח).

## בדיקה ידנית
מעתיקים קובץ לתיקייה `recordings/` (נוצרת אוטומטית) וצופים בממשק:
- `samples/bank_call_0521234567.wav`: הקלטת שמע בעברית (צריך Azure Speech)
- `samples/bank_call.txt`: תמלול מוכן (עובד גם בלי Azure Speech)

מספר טלפון בשם הקובץ (כמו שמרכזיות שומרות) משמש לזיהוי הלקוח.

## הזרימה
| שלב | קובץ |
|---|---|
| מעקב אחרי תיקיית ההקלטות | `app/watcher.py` |
| תמלול עברית (Azure Speech, עם הפרדת דוברים) | `app/transcribe.py` |
| סינון ת"ז / כרטיס / סיסמאות לפני ה-AI | `app/redact.py` |
| ניתוח (Claude דרך Azure Foundry) | `app/analyzer.py` + `app/schema.py` |
| שיוך לתיק לקוח ושמירה | `app/db.py` |
| דוח ללקוח + דוח לעסק, שמירה/מייל | `app/deliver.py` |
| כל הצינור יחד | `app/pipeline.py` |
| מחברים למערכות עסק (API) | `app/connectors.py` |
| מערכת דמה של בנק | `mock_crm/` |
| שרת + ממשק | `app/main.py`, `static/index.html` |

## 🔌 חיבור למרכזיית הצוות (השורש של הריפו הזה)
WrapUpAI משמש כ"מערכת התמלול החיצונית המבודדת" במקום מנוע Gemini:
1. `cd wrapup-engine && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cp .env.example .env`
2. ממלאים מפתחות Azure ב-`wrapup-engine/.env`, וקובעים סוד משותף:
   - `wrapup-engine/.env`: `TEAM_BRIDGE_SECRET=<סוד>`
   - `.env` בשורש הריפו: `INTERNAL_BRIDGE_SECRET=<אותו סוד>` ו-`EXTERNAL_ANALYTICS_URL=http://127.0.0.1:8000/api/external/analyze`
3. `npm install --legacy-peer-deps` בשורש, ואז `./wrapup-engine/run_with_team.sh`
4. במרכזייה: מעלים הקלטה ← "העברה למערכת החיצונית" ← הדוח, ה-PDF והמייל חוזרים לכרטיס הלקוח.

אבטחה: טוקן HMAC חד-פעמי (120 שניות) נבדק בצד WrapUpAI; הדוח חוזר חתום HMAC; שם ומייל הלקוח משמשים רק למסירה ולא נשלחים למודל ה-AI.

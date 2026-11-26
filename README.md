WrapUp
AI Venture Night | Hackaton

# מערכת מרכזיה, כרטיסי לקוח והפרדת תמלול מאובטחת

מערכת דמה ארגונית (React + Vite + Express + TypeScript) המדמה מוקד שירות מבוטחים (בדומה לביטוח לאומי) עם הפרדת רשויות מלאה בין המערכת הפנימית (מרכזיה + כרטיסי לקוח + יומן) לבין מערכת התמלול החיצונית.

## יכולות עיקריות
- **מרכזיה פנימית (System A):** קליטת הקלטות (העלאת קובצי MP4, WAV, MP3, WebM, M4A, OGG עד 20MB, הקלטת מיקרופון או הפקת שיחה), האזנה מובנית ושליחה בלחיצת כפתור לתמלול.
- **כרטיסי לקוח ויומן:** הוספת לקוחות חדשים, חשיפת ת.ז. מבוקרת עם תיעוד ביקורת, צפייה בדוחות מסוכמים לפי נושאים ודוברים, פתיחת דוח **PDF מובנה** ושיבוץ משימות המשך ישירות ל**יומן הלקוח**.
- **הפרדת אבטחה (System B):** בעת שליחה לתמלול נשלח קובץ המדיה בלבד עם טוקן HMAC חד-פעמי, ללא ת.ז., טלפון, שם מלא או פרטי תיק. למערכת החיצונית אין גישה למאגר הלקוחות (`403`).

## הרצה מקומית
1. התקנת תלויות:
   ```bash
   npm install

   יצירת קובץ .env על בסיס .env.example:
GEMINI_API_KEY – מפתח לשימוש במנוע המובנה (אופציונלי אם מחליפים למערכת תמלול אחרת).
OPERATOR_PASSCODE – קוד גישה ראשוני לממשק (אם נשאר ריק, המערכת מאפשרת הגדרת סיסמה בהרצה הראשונה).
הפעלת שרת הפיתוח (פורט 3000):

בדיקת טיפוסים ובנייה:
npm run lint
npm run build
הנחיות חיבור למערכת התמלול החיצונית (עבור קלוד / מפתח)
כדי לחבר את המערכת למערכת התמלול האמיתית של הארגון:
נקודת היציאה לתמלול (server.ts + server/geminiService.ts):
הפונקציה executeIsolatedExternalAnalysis ב-server.ts מעבירה את הבקשה עם X-Transfer-Token ל-POST /api/external/analyze.
ניתן להחליף את המימוש של transcribeAndAnalyzeCallExternal ב-server/geminiService.ts בקריאת HTTP ל-API של מערכת התמלול שלכם (הפרמטרים הזמינים הם audioBuffer, mimeType, uniqueCallName, callDate ו-anonymizedParticipants).
החזרת הדוח החתום (POST /api/internal/ingest-report ב-server.ts):
מערכת התמלול מחזירה JSON הכולל executiveSummary, participantsDetected, topics, actionItems ו-transcript (במבנה המוגדר ב-server/types.ts).
הבקשה החוזרת מאומתת באמצעות כותרת X-External-Signature (חתימת HMAC-SHA256 מול INTERNAL_BRIDGE_SECRET / verifyExternalReportSignature ב-server/security.ts), ולאחר האימות הדוח משויך לכרטיס הלקוח, מפיק התראה והופך לזמין כ-PDF ולשיבוץ ביומן.
שמירת נתונים
נתוני הרצה (לקוחות, הקלטות, קובצי שמע, דוחות ואירועי יומן) נשמרים בדיסק תחת .local-data/ ומוחרגים מ-Git דרך .gitignore יחד עם קובצי .env.

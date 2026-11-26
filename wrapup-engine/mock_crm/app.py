"""
🏦 מערכת דמה: "מערכת המוקד של בנק השרון"
מדמה מערכת פנימית קיימת של עסק, שמחזיקה לקוחות והקלטות שיחות.
WrapUpAI מתחבר אליה מבחוץ דרך API עם מפתח בעל הרשאה מוגבלת:
  - לקרוא הקלטות חדשות (recordings:read)
  - לכתוב סיכום לשיחה (wrapup:write)
ושום דבר אחר.

הרצה:  .venv/bin/uvicorn app:app --app-dir mock_crm --port 9000
"""
import json
import os
import shutil
import sqlite3
from pathlib import Path

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

HERE = Path(__file__).resolve().parent
DB = HERE / "crm.db"
STORAGE = HERE / "storage"   # "השרת" של הבנק - ההקלטות נשמרות כאן
POOL = HERE / "pool"         # הקלטות לדמו: "שיחות שעומדות להסתיים"
API_KEY = os.getenv("CRM_API_KEY", "demo-key-123")
BANK = "בנק השרון"

app = FastAPI(title=f"{BANK} - מערכת מוקד")

SEED_CUSTOMERS = [
    ("רחל כהן", "0521234567", "rachel.cohen@example.com"),
    ("יוסי לוי", "0547778899", "yossi.levi@example.com"),
    ("דנה מזרחי", "0501112233", "dana.m@example.com"),
]


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    STORAGE.mkdir(exist_ok=True)
    POOL.mkdir(exist_ok=True)
    with db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT UNIQUE, email TEXT);
        CREATE TABLE IF NOT EXISTS recordings (
            id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, filename TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            status TEXT DEFAULT 'new', wrapup TEXT, processed_at TEXT, documents TEXT DEFAULT '[]');
        """)
        (STORAGE / "docs").mkdir(exist_ok=True)
        for name, phone, email in SEED_CUSTOMERS:
            conn.execute("INSERT OR IGNORE INTO customers (name, phone, email) VALUES (?, ?, ?)", (name, phone, email))


init()


# ---------- אבטחה: מפתח API עם הרשאה מוגבלת ----------

def require_key(x_api_key: str = Header(None)):
    if x_api_key != API_KEY:
        raise HTTPException(401, "מפתח API לא תקין")


# ---------- ה-API ש-WrapUpAI משתמש בו ----------

@app.get("/api/v1/recordings", dependencies=[Depends(require_key)])
def list_recordings(status: str = "new"):
    with db() as conn:
        rows = conn.execute("""SELECT r.id, r.filename, r.created_at, c.name, c.phone, c.email
                               FROM recordings r LEFT JOIN customers c ON c.id = r.customer_id
                               WHERE r.status = ? ORDER BY r.id""", (status,)).fetchall()
    return [{"id": r["id"], "filename": r["filename"], "created_at": r["created_at"],
             "customer": {"name": r["name"], "phone": r["phone"], "email": r["email"]},
             "audio_url": f"/api/v1/recordings/{r['id']}/audio"} for r in rows]


@app.get("/api/v1/recordings/{rec_id}/audio", dependencies=[Depends(require_key)])
def get_audio(rec_id: int):
    with db() as conn:
        r = conn.execute("SELECT filename FROM recordings WHERE id = ?", (rec_id,)).fetchone()
    if not r or not (STORAGE / r["filename"]).exists():
        raise HTTPException(404, "הקלטה לא נמצאה")
    return FileResponse(STORAGE / r["filename"])


@app.post("/api/v1/recordings/{rec_id}/documents", dependencies=[Depends(require_key)])
async def upload_document(rec_id: int, file: UploadFile = File(...)):
    """WrapUpAI מעלה את קובץ ה-PDF של הסיכום - נשמר בשרת הבנק ומשויך להקלטה/לתיק."""
    name = Path(file.filename).name
    if not name.lower().endswith(".pdf"):
        raise HTTPException(400, "רק קבצי PDF")
    stored = f"rec{rec_id:05d}_{name}"
    (STORAGE / "docs" / stored).write_bytes(await file.read())
    with db() as conn:
        row = conn.execute("SELECT documents FROM recordings WHERE id = ?", (rec_id,)).fetchone()
        if not row:
            raise HTTPException(404, "הקלטה לא נמצאה")
        docs = json.loads(row["documents"] or "[]") + [{"name": name, "url": f"/docs/{stored}"}]
        conn.execute("UPDATE recordings SET documents = ? WHERE id = ?", (json.dumps(docs, ensure_ascii=False), rec_id))
    return {"url": f"/docs/{stored}"}


@app.get("/docs/{name}")
def get_doc(name: str):
    path = STORAGE / "docs" / Path(name).name
    if not path.exists():
        raise HTTPException(404, "מסמך לא נמצא")
    return FileResponse(path, media_type="application/pdf")


class Wrapup(BaseModel):
    title: str
    summary: str
    status: str
    customer_message: str
    policy_conflicts: list[dict] = []
    churn_risk: int = 0
    churn_reason: str = ""
    customer_tasks: list[str] = []
    business_tasks: list[str] = []
    customer_report_url: str = ""
    business_report_url: str = ""
    pdf_url: str = ""
    delivery: str = ""
    sent_to: list[str] = []
    next_meeting: dict | None = None


@app.post("/api/v1/recordings/{rec_id}/wrapup", dependencies=[Depends(require_key)])
def post_wrapup(rec_id: int, w: Wrapup):
    with db() as conn:
        cur = conn.execute("UPDATE recordings SET status='processed', wrapup=?, processed_at=datetime('now','localtime') "
                           "WHERE id = ?", (w.model_dump_json(), rec_id))
    if not cur.rowcount:
        raise HTTPException(404, "הקלטה לא נמצאה")
    return {"ok": True}


@app.post("/api/v1/recordings/{rec_id}/failed", dependencies=[Depends(require_key)])
def post_failed(rec_id: int, body: dict):
    with db() as conn:
        conn.execute("UPDATE recordings SET status='failed', wrapup=? WHERE id = ?",
                     (json.dumps(body, ensure_ascii=False), rec_id))
    return {"ok": True}


# ---------- הממשק הפנימי של הבנק (לא דרך ה-API) ----------

@app.get("/ui/pool")
def pool():
    return sorted(p.name for p in POOL.iterdir() if p.is_file() and not p.name.startswith("."))


class Simulate(BaseModel):
    pool_file: str


@app.post("/ui/simulate-call")
def simulate_call(s: Simulate):
    """מדמה שיחה שהסתיימה: המרכזייה שומרת הקלטה בשרת ומשייכת ללקוח לפי הטלפון."""
    src = POOL / Path(s.pool_file).name
    if not src.exists():
        raise HTTPException(404, "קובץ לא נמצא")
    with db() as conn:
        customer = next((c for c in conn.execute("SELECT * FROM customers") if c["phone"] in src.name), None)
        cur = conn.execute("INSERT INTO recordings (customer_id, filename) VALUES (?, ?)",
                           (customer["id"] if customer else None, "tmp"))
        rec_id = cur.lastrowid
        stored = f"rec{rec_id:05d}_{src.name}"
        shutil.copy(src, STORAGE / stored)
        conn.execute("UPDATE recordings SET filename = ? WHERE id = ?", (stored, rec_id))
    return {"id": rec_id}


@app.get("/ui/recordings")
def ui_recordings():
    with db() as conn:
        rows = conn.execute("""SELECT r.*, c.name, c.phone, c.email FROM recordings r
                               LEFT JOIN customers c ON c.id = r.customer_id ORDER BY r.id DESC""").fetchall()
    return [{**dict(r), "wrapup": json.loads(r["wrapup"]) if r["wrapup"] else None,
             "documents": json.loads(r["documents"] or "[]")} for r in rows]


@app.get("/", response_class=HTMLResponse)
def index():
    return (HERE / "index.html").read_text(encoding="utf-8")

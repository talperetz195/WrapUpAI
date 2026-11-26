"""
"מערכת העסק": מסד נתונים SQLite (קובץ אחד, בלי התקנות) שמחזיק את תיקי הלקוחות.

טבלאות:
  customers  - לקוחות
  calls      - שיחות (כל שיחה משויכת לתיק לקוח)
  tasks      - משימות של הלקוח + הבטחות של העסק (לכל אחת סטטוס בוצע/לא)
  glossary   - מילון המונחים של העסק
"""
import json
import re
import sqlite3
from pathlib import Path

from schema import CallAnalysis

DB_PATH = Path(__file__).resolve().parent.parent / "data.db"
CHURN_THRESHOLD = 60  # מעל זה נפתחת משימת שימור לראש הצוות

SCHEMA = """
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone TEXT,
    customer_number TEXT,
    email TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    source TEXT,                 -- 'folder' (מהמרכזייה) / 'upload' (העלאה ידנית)
    status TEXT NOT NULL,        -- processing / done / failed
    message TEXT,
    call_id INTEGER,
    customer_id INTEGER,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    filename TEXT,
    title TEXT,
    category TEXT,
    status TEXT,
    sentiment TEXT,
    summary TEXT,
    customer_message TEXT,
    transcript TEXT,
    redactions TEXT,
    analysis_json TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    call_id INTEGER NOT NULL REFERENCES calls(id),
    kind TEXT NOT NULL,          -- 'action' (משימה) / 'commitment' (הבטחת העסק) / 'retention' (שימור לראש צוות)
    owner TEXT,
    category TEXT,
    description TEXT NOT NULL,
    due_date TEXT,
    done INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS glossary (
    term TEXT PRIMARY KEY,
    explanation TEXT NOT NULL
);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)


def _digits(s: str | None) -> str | None:
    return re.sub(r"\D", "", s) if s else None


# ---------- לקוחות ----------

def find_or_create_customer(conn, details, customer_id: int | None,
                            phone_hint: str | None = None) -> tuple[int, bool]:
    """
    משייך את השיחה לתיק לקוח. סדר עדיפויות:
    1. העסק בחר לקוח ידנית
    2. טלפון מזהה המתקשר (מגיע משם קובץ ההקלטה של המרכזייה - הכי אמין)
    3. מספר לקוח  4. טלפון שנאמר בשיחה  5. שם זהה  6. פותחים תיק חדש
    מחזיר (customer_id, האם נוצר תיק חדש).
    """
    if customer_id:
        return customer_id, False

    phone = _digits(phone_hint) or _digits(details.phone)
    number = details.customer_number
    candidates = (("phone", _digits(phone_hint)), ("customer_number", number),
                  ("phone", _digits(details.phone)), ("name", details.name))
    for column, value in candidates:
        if value:
            row = conn.execute(f"SELECT id FROM customers WHERE {column} = ?", (value,)).fetchone()
            if row:
                # משלימים פרטים שחסרו בתיק
                conn.execute(
                    "UPDATE customers SET name = COALESCE(name, ?), phone = COALESCE(phone, ?), "
                    "customer_number = COALESCE(customer_number, ?), email = COALESCE(email, ?) WHERE id = ?",
                    (details.name, phone, number, details.email, row["id"]),
                )
                return row["id"], False

    cur = conn.execute(
        "INSERT INTO customers (name, phone, customer_number, email) VALUES (?, ?, ?, ?)",
        (details.name or "לקוח ללא שם", phone, number, details.email),
    )
    return cur.lastrowid, True


def email_by_phone(phone: str) -> str | None:
    with connect() as conn:
        row = conn.execute("SELECT email FROM customers WHERE phone = ? AND email IS NOT NULL", (_digits(phone),)).fetchone()
        return row["email"] if row else None


def fill_customer(customer_id: int, hint: dict) -> None:
    """משלים פרטים חסרים בתיק (בלי לדרוס קיימים) מנתונים שהגיעו ממערכת העסק."""
    with connect() as conn:
        conn.execute(
            "UPDATE customers SET email = COALESCE(email, ?), phone = COALESCE(phone, ?), "
            "name = CASE WHEN name = 'לקוח ללא שם' AND ? IS NOT NULL THEN ? ELSE name END WHERE id = ?",
            (hint.get("email"), _digits(hint.get("phone")), hint.get("name"), hint.get("name"), customer_id),
        )


def update_customer(customer_id: int, fields: dict) -> None:
    allowed = {k: v for k, v in fields.items() if k in ("name", "phone", "customer_number", "email")}
    if not allowed:
        return
    sets = ", ".join(f"{k} = ?" for k in allowed)
    with connect() as conn:
        conn.execute(f"UPDATE customers SET {sets} WHERE id = ?", (*allowed.values(), customer_id))


def list_customers() -> list[dict]:
    with connect() as conn:
        rows = conn.execute("""
            SELECT c.*,
                   (SELECT COUNT(*) FROM calls WHERE customer_id = c.id) AS calls_count,
                   (SELECT COUNT(*) FROM tasks WHERE customer_id = c.id AND done = 0) AS open_tasks,
                   (SELECT COUNT(*) FROM tasks WHERE customer_id = c.id AND done = 0 AND kind = 'retention') AS retention_open,
                   (SELECT MAX(created_at) FROM calls WHERE customer_id = c.id) AS last_call
            FROM customers c ORDER BY last_call DESC NULLS LAST, c.id DESC
        """).fetchall()
        return [dict(r) for r in rows]


def get_customer_file(customer_id: int) -> dict | None:
    with connect() as conn:
        customer = conn.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
        if not customer:
            return None
        calls = conn.execute(
            "SELECT * FROM calls WHERE customer_id = ? ORDER BY created_at DESC", (customer_id,)
        ).fetchall()
        tasks = conn.execute(
            "SELECT * FROM tasks WHERE customer_id = ? ORDER BY done, due_date IS NULL, due_date", (customer_id,)
        ).fetchall()
        return {
            "customer": dict(customer),
            "calls": [
                {**dict(c), "analysis": json.loads(c["analysis_json"]), "redactions": json.loads(c["redactions"])}
                for c in calls
            ],
            "tasks": [dict(t) for t in tasks],
        }


# ---------- שיחות ----------

def get_call(call_id: int) -> dict | None:
    with connect() as conn:
        call = conn.execute("SELECT * FROM calls WHERE id = ?", (call_id,)).fetchone()
        if not call:
            return None
        customer = conn.execute("SELECT * FROM customers WHERE id = ?", (call["customer_id"],)).fetchone()
        return {**dict(call), "analysis": json.loads(call["analysis_json"]),
                "redactions": json.loads(call["redactions"]), "customer": dict(customer)}


# ---------- יומן עיבוד (כל קובץ שנכנס) ----------

def create_job(filename: str, source: str) -> int:
    with connect() as conn:
        return conn.execute("INSERT INTO jobs (filename, source, status, message) VALUES (?, ?, 'processing', ?)",
                            (filename, source, "מתמלל ומנתח...")).lastrowid


def finish_job(job_id: int, status: str, message: str, call_id: int | None = None,
               customer_id: int | None = None) -> None:
    with connect() as conn:
        conn.execute("UPDATE jobs SET status = ?, message = ?, call_id = ?, customer_id = ? WHERE id = ?",
                     (status, message, call_id, customer_id, job_id))


def list_jobs(limit: int = 20) -> list[dict]:
    with connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM jobs ORDER BY id DESC LIMIT ?", (limit,))]


def save_call(analysis: CallAnalysis, transcript: str, redactions: list[str],
              filename: str | None, customer_id: int | None, phone_hint: str | None = None) -> dict:
    with connect() as conn:
        cid, created = find_or_create_customer(conn, analysis.customer, customer_id, phone_hint)
        cur = conn.execute(
            """INSERT INTO calls (customer_id, filename, title, category, status, sentiment,
                                  summary, customer_message, transcript, redactions, analysis_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (cid, filename, analysis.title, analysis.category, analysis.status, analysis.sentiment,
             analysis.summary, analysis.customer_message, transcript,
             json.dumps(redactions, ensure_ascii=False), analysis.model_dump_json()),
        )
        call_id = cur.lastrowid
        for kind, items in (("action", analysis.action_items), ("commitment", analysis.business_commitments)):
            for item in items:
                conn.execute(
                    """INSERT INTO tasks (customer_id, call_id, kind, owner, category, description, due_date)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (cid, call_id, kind, item.owner, item.category, item.description, item.due_date),
                )
        # מכ"ם נטישה: סיכון גבוה → משימת שימור אוטומטית לראש הצוות
        if analysis.churn_risk >= CHURN_THRESHOLD:
            conn.execute(
                """INSERT INTO tasks (customer_id, call_id, kind, owner, category, description)
                   VALUES (?, ?, 'retention', 'team_lead', 'call_back', ?)""",
                (cid, call_id, f"שימור לקוח - סיכון נטישה {analysis.churn_risk}%: {analysis.churn_reason}"),
            )
        return {"call_id": call_id, "customer_id": cid, "new_customer": created}


def set_task_done(task_id: int, done: bool) -> bool:
    with connect() as conn:
        cur = conn.execute("UPDATE tasks SET done = ? WHERE id = ?", (int(done), task_id))
        return cur.rowcount > 0


# ---------- מילון ----------

def get_glossary() -> dict[str, str]:
    with connect() as conn:
        return {r["term"]: r["explanation"] for r in conn.execute("SELECT * FROM glossary ORDER BY term")}


def upsert_term(term: str, explanation: str) -> None:
    with connect() as conn:
        conn.execute("INSERT OR REPLACE INTO glossary (term, explanation) VALUES (?, ?)", (term, explanation))


def delete_term(term: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM glossary WHERE term = ?", (term,))


# ---------- תקנון העסק (Policy Guard) ----------

def get_policy() -> str:
    with connect() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = 'policy'").fetchone()
        return row["value"] if row else ""


def set_policy(text: str) -> None:
    with connect() as conn:
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('policy', ?)", (text,))

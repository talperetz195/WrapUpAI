"""
השרת. מריצים מתיקיית הפרויקט:
    .venv/bin/uvicorn main:app --app-dir app
ופותחים בדפדפן: http://localhost:8000

עם ההפעלה מתחיל גם מעקב אחרי תיקיית ההקלטות (RECORDINGS_DIR):
כל קובץ שמע שנוצר שם מתומלל, מנותח, נשמר בתיק הלקוח, והדוחות נשלחים.
"""
import logging
import os
import tempfile
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")  # חייב לקרות לפני שאר ה-imports

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import FileResponse, HTMLResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import analyzer  # noqa: E402
import bridge  # noqa: E402
import connectors  # noqa: E402
import db  # noqa: E402
import deliver  # noqa: E402
import email_design  # noqa: E402
import transcribe  # noqa: E402
import watcher  # noqa: E402
from pipeline import process_file  # noqa: E402

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="עוזר שיחות")
db.init()


@app.on_event("startup")
def start_watcher():
    watcher.start()
    connectors.start()


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/api/status")
def status():
    return {
        "mode": analyzer.mode(),
        "model": analyzer.model_name(),
        "speech": transcribe.is_configured(),
        "recordings_dir": str(watcher.recordings_dir()),
        "connectors": connectors.status(),
        "email": deliver.email_mode(),
        "email_test_recipient": bool(os.getenv("EMAIL_TEST_RECIPIENT")),
    }


# ---------- העלאה ידנית (קובץ שמע / תמלול / טקסט) - אותו צינור כמו התיקייה ----------

@app.post("/api/calls")
async def create_call(
    file: UploadFile | None = File(None),
    text: str | None = Form(None),
    customer_id: int | None = Form(None),
):
    if file and file.filename:
        data, name = await file.read(), file.filename
    elif text and text.strip():
        data, name = text.encode("utf-8"), "טקסט מודבק.txt"
    else:
        raise HTTPException(400, "צריך להעלות קובץ שמע / תמלול או להדביק טקסט")

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / Path(name).name
        path.write_bytes(data)
        try:
            result = process_file(path, source="upload", customer_id=customer_id, display_name=name)
            result.pop("pdfs", None)
            return result
        except (analyzer.AnalysisError, transcribe.TranscriptionError) as e:
            raise HTTPException(502, str(e))


# ---------- גשר למערכת המרכזייה של הצוות (WrapUpAI כמערכת החיצונית המבודדת) ----------

@app.post("/api/external/analyze", status_code=202)
def team_external_analyze(body: dict, x_transfer_token: str | None = Header(None)):
    try:
        return bridge.accept(x_transfer_token, body)
    except bridge.BridgeError as e:
        raise HTTPException(403, str(e))


# ---------- משוב לקוח מהמייל (לחיצה על פרצוף) ----------

def _feedback_html(call_id: int, t: str, score: int | None) -> HTMLResponse:
    assets = email_design.ensure_assets(deliver._chrome())
    img = lambda n: email_design.data_uri(assets[n]) if n in assets else ""  # noqa: E731
    return HTMLResponse(email_design.feedback_page(call_id, t, score, deliver.business_name(), img))


@app.get("/feedback/{call_id}", response_class=HTMLResponse)
def feedback_form(call_id: int, t: str = ""):
    if not email_design.verify_feedback_token(call_id, t):
        raise HTTPException(403, "קישור משוב לא תקין")
    return _feedback_html(call_id, t, db.latest_feedback_score(call_id))


@app.get("/feedback/{call_id}/{score}", response_class=HTMLResponse)
def feedback_score(call_id: int, score: int, t: str = ""):
    if not email_design.verify_feedback_token(call_id, t) or score not in range(1, 6):
        raise HTTPException(403, "קישור משוב לא תקין")
    db.save_feedback(call_id, score=score)
    return _feedback_html(call_id, t, score)


@app.post("/feedback/{call_id}/comment", response_class=HTMLResponse)
def feedback_comment(call_id: int, t: str = "", comment: str = Form("")):
    if not email_design.verify_feedback_token(call_id, t):
        raise HTTPException(403, "קישור משוב לא תקין")
    if comment.strip():
        db.save_feedback(call_id, comment=comment.strip()[:2000])
    return _feedback_html(call_id, t, db.latest_feedback_score(call_id) or 0)


@app.get("/api/jobs")
def jobs():
    return db.list_jobs()


# ---------- דוחות ----------

@app.get("/reports/{call_id}/{kind}.pdf")
def report_pdf(call_id: int, kind: str):
    call = db.get_call(call_id)
    if not call or kind not in ("customer", "business"):
        raise HTTPException(404, "דוח לא נמצא")
    path = deliver.OUTBOX / deliver.pdf_name(call, kind)
    if not path.exists():
        raise HTTPException(404, "ה-PDF לא נוצר")
    return FileResponse(path, media_type="application/pdf", filename=path.name)


@app.get("/reports/{call_id}/{kind}", response_class=HTMLResponse)
def report(call_id: int, kind: str):
    call = db.get_call(call_id)
    if not call:
        raise HTTPException(404, "שיחה לא נמצאה")
    if kind == "customer":
        return deliver.customer_report(call)
    if kind == "business":
        return deliver.business_report(call)
    raise HTTPException(404, "סוג דוח לא קיים")


# ---------- תיקי לקוחות ----------

@app.get("/api/customers")
def customers():
    return db.list_customers()


@app.get("/api/customers/{customer_id}")
def customer_file(customer_id: int):
    data = db.get_customer_file(customer_id)
    if not data:
        raise HTTPException(404, "לקוח לא נמצא")
    return data


class CustomerUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    customer_number: str | None = None
    email: str | None = None


@app.patch("/api/customers/{customer_id}")
def edit_customer(customer_id: int, body: CustomerUpdate):
    db.update_customer(customer_id, body.model_dump(exclude_none=True))
    return {"ok": True}


class TaskUpdate(BaseModel):
    done: bool


@app.patch("/api/tasks/{task_id}")
def update_task(task_id: int, body: TaskUpdate):
    if not db.set_task_done(task_id, body.done):
        raise HTTPException(404, "משימה לא נמצאה")
    return {"ok": True}


# ---------- מילון העסק ----------

class Term(BaseModel):
    term: str
    explanation: str


class Policy(BaseModel):
    text: str


class Compliance(BaseModel):
    text: str


@app.get("/api/compliance")
def get_compliance():
    return {"text": "\n".join(db.get_compliance_checks()), "defaults": "\n".join(db.DEFAULT_COMPLIANCE)}


@app.put("/api/compliance")
def put_compliance(c: Compliance):
    db.set_compliance_checks(c.text.splitlines() or db.DEFAULT_COMPLIANCE)
    return {"ok": True, "count": len(db.get_compliance_checks())}


@app.get("/api/policy")
def get_policy():
    return {"text": db.get_policy()}


@app.put("/api/policy")
def put_policy(p: Policy):
    db.set_policy(p.text.strip())
    return {"ok": True}


@app.get("/api/glossary")
def glossary():
    return db.get_glossary()


@app.post("/api/glossary")
def add_term(t: Term):
    db.upsert_term(t.term.strip(), t.explanation.strip())
    return {"ok": True}


@app.delete("/api/glossary/{term}")
def remove_term(term: str):
    db.delete_term(term)
    return {"ok": True}


app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

"""
הצינור המלא לשיחה אחת:
  קובץ → תמלול → סינון פרטים אישיים → ניתוח AI → שמירה בתיק הלקוח → שליחת דוחות
משמש גם את מעקב התיקייה (watcher) וגם את ההעלאה הידנית בממשק.
"""
import re
from pathlib import Path

import analyzer
import db
import deliver
from redact import redact
from transcribe import transcribe_file

# מרכזיות שומרות בדרך כלל את מספר המתקשר בשם הקובץ, למשל: 20261126-1830_0521234567.wav
PHONE_IN_NAME = re.compile(r"(?<!\d)(0\d{8,9}|972\d{8,9})(?!\d)")


def phone_from_filename(name: str) -> str | None:
    m = PHONE_IN_NAME.search(name)
    if not m:
        return None
    num = m.group(1)
    return "0" + num[3:] if num.startswith("972") else num


def process_file(path: Path, source: str, customer_id: int | None = None,
                 display_name: str | None = None, customer_hint: dict | None = None,
                 recipients: list[tuple[str, str]] | None = None, on_progress=None) -> dict:
    """customer_hint: פרטי לקוח שהגיעו מהמערכת של העסק (שם/טלפון/מייל) - הכי אמינים לזיהוי."""
    hint = customer_hint or {}
    progress = on_progress or (lambda stage: None)
    name = display_name or path.name
    job_id = db.create_job(name, source)
    try:
        progress("transcribing")
        glossary = db.get_glossary()
        raw = transcribe_file(path, list(glossary))              # 1. תמלול (עם מונחי העסק)
        clean, removed = redact(raw)                             # 2. סינון
        progress("analyzing")
        analysis = analyzer.analyze(clean, glossary, db.get_policy(), compliance=db.get_compliance_checks())
        if hint.get("name"):  # השם במערכת העסק הוא הקובע (לא מה שה-AI הסיק מהשיחה)
            analysis.customer.name = hint["name"]  # 3. ניתוח + Policy Guard
        saved = db.save_call(analysis, clean, removed, name, customer_id,
                             phone_hint=hint.get("phone") or phone_from_filename(name))  # 4. שמירה בתיק
        db.fill_customer(saved["customer_id"], hint)            # משלימים מייל/שם ממערכת העסק
        progress("delivering")
        delivery = deliver.send_reports(saved["call_id"], recipients)  # 5. PDF + מייל לכל הלקוחות
    except Exception as e:  # noqa: BLE001 - כל שגיאה נרשמת ביומן ולא מפילה את המערכת
        db.finish_job(job_id, "failed", str(e))
        raise
    db.finish_job(job_id, "done", f"נשמר בתיק · {delivery['text']}", saved["call_id"], saved["customer_id"])
    return {**saved, "redactions": removed, "analysis": analysis.model_dump(), "transcript": clean,
            "delivery": delivery["text"], "pdfs": delivery["pdfs"], "sent_to": delivery["sent_to"]}

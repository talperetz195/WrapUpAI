"""
בניית שני הדוחות ושליחתם:
  📩 דוח ללקוח - מה סוכם, מה עליו לעשות ומתי, הסבר מונחים, שאלות להמשך, אזהרות
  🏢 דוח לעסק  - סיכום לתיק, משימות בירוקרטיה לטיפול העסק, הבטחות שניתנו, סיכונים

שליחה:
  - תמיד: הדוחות נשמרים כקבצי HTML בתיקיית outbox/ (וזמינים בממשק)
  - אם מוגדר SMTP ב-.env: נשלחים גם במייל ללקוח (אם יש לו מייל בתיק) ולעסק
      SMTP_HOST=smtp.gmail.com  SMTP_PORT=587  SMTP_USER=...  SMTP_PASSWORD=...
      BUSINESS_EMAIL=office@business.co.il   BUSINESS_NAME=שם העסק
"""
import html
import os
import re
import shutil
import smtplib
import subprocess
from urllib.parse import urlencode
from email.message import EmailMessage
from pathlib import Path

import db
import gmail

ROOT = Path(__file__).resolve().parent.parent
OUTBOX = ROOT / "outbox"

CATEGORIES = {"billing": "חיוב", "payment_arrangement": "הסדר תשלומים", "technical_support": "תמיכה טכנית",
              "complaint": "תלונה", "account_change": "שינוי פרטים", "cancellation": "ביטול", "sales": "מכירה",
              "appointment": "קביעת תור", "information": "בירור מידע", "other": "אחר"}
STATUS = {"resolved": "נסגר", "pending_customer": "ממתין ללקוח", "pending_business": "ממתין לעסק",
          "needs_follow_up": "נדרשת שיחת המשך"}

STYLE = """<style>
body{font-family:system-ui,Arial,sans-serif;background:#f5f6fa;color:#1d2433;margin:0;padding:24px}
.box{max-width:680px;margin:auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e3e6ee}
h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;color:#4f46e5;margin:20px 0 8px}
.muted{color:#6b7385;font-size:13px} li{margin:4px 0} .due{background:#fff4d6;padding:1px 6px;border-radius:4px;font-size:12px}
.risk{background:#fde8e7;color:#d93025;padding:8px 12px;border-radius:8px;margin:4px 0}
.msg{background:#e7f6ee;padding:12px;border-radius:8px;white-space:pre-wrap} dt{font-weight:600} dd{margin:0 0 8px;color:#6b7385}
.guard{background:#fde8e7;border:2px solid #d93025;border-radius:10px;padding:12px;margin:10px 0;color:#7a1610}
.guard div{background:#fff;color:#1d2433;border-radius:8px;padding:8px;margin-top:8px}
.meet{background:#eef0ff;border:2px solid #4f46e5;border-radius:10px;padding:12px;margin:12px 0}
a.cal.big{font-size:15px;padding:8px 16px;margin:8px 0 0;display:inline-block}
a.cal{display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:3px 10px;border-radius:6px;font-size:12px;margin-inline-start:6px}
@media print{body{background:#fff;padding:0}.box{border:0}}
</style>"""


def _e(s) -> str:
    return html.escape(str(s or ""))


EMOTION = {"calm": "רגוע", "understanding": "מבין", "satisfied": "מרוצה", "confused": "מבולבל",
           "stressed": "לחוץ", "frustrated": "מתוסכל", "angry": "כועס"}
STAGE = {"opening": "פתיחה", "middle": "אמצע", "closing": "סיום"}


def calendar_link(title: str, due_date: str | None, details: str = "", time: str | None = None,
                  location: str | None = None, minutes: int = 30) -> str:
    """קישור שמוסיף אירוע ליומן Google האישי (נפתח עם הפרטים מוכנים, לוחצים 'שמור')."""
    params = {"action": "TEMPLATE", "text": title, "details": details, "ctz": "Asia/Jerusalem"}
    if location:
        params["location"] = location
    if due_date and re.fullmatch(r"\d{4}-\d{2}-\d{2}", due_date):
        d = due_date.replace("-", "")
        if time and re.fullmatch(r"\d{1,2}:\d{2}", time):
            h, m = map(int, time.split(":"))
            end_total = h * 60 + m + minutes
            eh, em = divmod(min(end_total, 23 * 60 + 59), 60)
            params["dates"] = f"{d}T{h:02d}{m:02d}00/{d}T{eh:02d}{em:02d}00"
        else:
            params["dates"] = f"{d}/{d}"
    return "https://calendar.google.com/calendar/render?" + urlencode(params)


def next_meeting_block(a: dict) -> str:
    """כפתור בולט: הוספת הפגישה הבאה ליומן האישי."""
    nm = a.get("next_meeting")
    if nm:
        when = " ".join(x for x in (nm.get("date"), nm.get("time")) if x) or "מועד יתואם"
        details = f"עם: {nm.get('with_whom') or business_name()}\n" + (
            "שאלות לשיחה:\n" + "\n".join(a["follow_up_questions"]) if a.get("follow_up_questions") else "")
        link = calendar_link(nm["title"], nm.get("date"), details, nm.get("time"), nm.get("location"))
        return (f'<div class="meet"><b>📅 הפגישה הבאה: {_e(nm["title"])}</b>'
                f'<div class="muted">{_e(when)}{" · " + _e(nm["with_whom"]) if nm.get("with_whom") else ""}'
                f'{" · " + _e(nm["location"]) if nm.get("location") else ""}</div>'
                f'<a class="cal big" href="{_e(link)}">➕ הוספה ליומן האישי שלי</a></div>')
    if a.get("follow_up_needed"):
        link = calendar_link(f"שיחת המשך עם {business_name()}", None,
                             "שאלות לשיחה:\n" + "\n".join(a["follow_up_questions"]))
        return f'<div class="meet"><b>📅 נדרשת שיחת המשך</b><a class="cal big" href="{_e(link)}">➕ קביעת מועד ביומן</a></div>'
    return ""


def _policy_block(a: dict, for_customer: bool) -> str:
    if not a.get("policy_conflicts"):
        return ""
    title = "⚠️ שימ/י לב: חלק ממה שנאמר בשיחה שונה מהתקנון" if for_customer else \
        f"🛡️ Policy Guard: {len(a['policy_conflicts'])} הבטחות של הנציג סותרות את התקנון"
    items = "".join(
        f"<div>🗣️ נאמר בשיחה: <q>{_e(p['rep_statement'])}</q><br>📜 בתקנון: <q>{_e(p['policy_text'])}</q><br>"
        f"<span class='muted'>{_e(p['explanation'])}</span></div>" for p in a["policy_conflicts"])
    return f'<div class="guard"><b>{title}</b>{items}</div>'


def _items(items, empty="אין", with_calendar=False) -> str:
    if not items:
        return f'<p class="muted">{empty}</p>'
    return "<ul>" + "".join(
        f"<li>{_e(i['description'])}" + (f' <span class="due">עד {_e(i["due_date"])}</span>' if i.get("due_date") else "")
        + (f' <a class="cal" href="{_e(calendar_link(i["description"], i.get("due_date")))}">📅 הוסף ליומן</a>' if with_calendar else "")
        + "</li>" for i in items) + "</ul>"


def _page(title: str, body: str) -> str:
    return f'<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>{_e(title)}</title>{STYLE}</head><body><div class="box">{body}</div></body></html>'


def business_name() -> str:
    return os.getenv("BUSINESS_NAME", "העסק")


def customer_report(call: dict, recipient_name: str | None = None) -> str:
    a, c = call["analysis"], call["customer"]
    greeting = recipient_name or c.get("name")
    my_tasks = [t for t in a["action_items"] if t["owner"] == "customer"]
    risks = "".join(f'<div class="risk">⚠️ {_e(r["description"])}</div>' for r in a["risk_flags"])
    glossary = "".join(f"<dt>{_e(g['term'])}</dt><dd>{_e(g['explanation'])}</dd>" for g in a["glossary"])
    payments = "".join(f"<li>{_e(p['description'])}: {_e(p['amount'])} {_e(p['currency'])}{' (חודשי)' if p['recurring'] else ''}</li>"
                       for p in a["payments"])
    questions = "".join(f"<li>{_e(q)}</li>" for q in a["follow_up_questions"])
    body = f"""
      <h1>{_e(greeting) + ", " if greeting else ""}סיכום השיחה שלך עם {_e(business_name())}</h1>
      <div class="muted">{_e(call['created_at'])} · {_e(a['title'])}</div>
      {_policy_block(a, for_customer=True)}{risks}
      {next_meeting_block(a)}
      <h2>📩 מה סוכם</h2><div class="msg">{_e(a['customer_message'])}</div>
      <h2>✅ מה עליך לעשות</h2>{_items(my_tasks, "אין משימות - הכל טופל 🎉", with_calendar=True)}
      <h2>🤝 מה {_e(business_name())} התחייב לעשות</h2>{_items(a['business_commitments'])}
      {f'<h2>💳 תשלומים</h2><ul>{payments}</ul>' if payments else ''}
      {f'<h2>📖 מה פירוש המונחים</h2><dl>{glossary}</dl>' if glossary else ''}
      {f'<h2>❓ שאלות לשיחה הבאה</h2><ul>{questions}</ul>' if questions else ''}
      <p class="muted">הסיכום נוצר אוטומטית ע"י WrapUpAI. פרטים אישיים (ת"ז, סיסמאות, כרטיס אשראי) סוננו ולא נשמרו.</p>"""
    return _page("סיכום השיחה שלך", body)


def business_report(call: dict) -> str:
    a, c = call["analysis"], call["customer"]
    risks = "".join(f'<div class="risk">⚠️ [{_e(r["severity"])}] {_e(r["description"])}</div>' for r in a["risk_flags"])
    business_tasks = a["business_commitments"] + [t for t in a["action_items"] if t["owner"] == "business"]
    customer_tasks = [t for t in a["action_items"] if t["owner"] == "customer"]
    emotion = ""
    if a.get("emotion_map"):
        churn = a["churn_risk"]
        color = "#d93025" if churn >= 60 else "#e8a100" if churn >= 30 else "#0f9d58"
        emotion = ("<h2>🎭 מפה רגשית ומכ\"ם נטישה</h2><p>"
                   + " ← ".join(f"{STAGE[e['stage']]}: <b>{EMOTION.get(e['emotion'], e['emotion'])}</b>" for e in a["emotion_map"])
                   + f"</p><p>סיכון נטישה: <b style='color:{color}'>{churn}%</b> · {_e(a['churn_reason'])}"
                   + ("<br><b style='color:#d93025'>🚨 נפתחה משימת שימור לראש הצוות</b>" if churn >= db.CHURN_THRESHOLD else "")
                   + "</p>")
    body = f"""
      <h1>דוח שיחה: {_e(c.get('name'))}</h1>
      <div class="muted">תיק #{c['id']} · טלפון {_e(c.get('phone') or '-')} · מספר לקוח {_e(c.get('customer_number') or '-')}<br>
      {_e(call['created_at'])} · סוג: {CATEGORIES.get(a['category'], '')} · סטטוס: {STATUS.get(a['status'], '')} · קובץ: {_e(call.get('filename') or '-')}</div>
      {_policy_block(a, for_customer=False)}{risks}
      <h2>📝 סיכום לתיק</h2><p>{_e(a['summary'])}</p>
      {next_meeting_block(a)}
      {emotion}
      <h2>🗂️ לטיפול העסק (בירוקרטיה והתחייבויות)</h2>{_items(business_tasks)}
      <h2>⏳ ממתין ללקוח</h2>{_items(customer_tasks)}
      <h2>📩 ההודעה שנשלחה ללקוח</h2><div class="msg">{_e(a['customer_message'])}</div>
      {'<p class="muted">🔒 סוננו מהתמלול: ' + _e(', '.join(call['redactions'])) + '</p>' if call['redactions'] else ''}"""
    return _page(f"דוח שיחה - {c.get('name')}", body)


CHROME_PATHS = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Chromium.app/Contents/MacOS/Chromium", "google-chrome", "chromium", "chrome"]


def _chrome() -> str | None:
    for p in CHROME_PATHS:
        if os.path.exists(p) or shutil.which(p):
            return p
    return None


def pdf_name(call: dict, kind: str) -> str:
    """שם ייחודי: שם הלקוח + תאריך השיחה + מספר שיחה."""
    name = re.sub(r"[^\w\u0590-\u05FF-]+", "_", call["customer"].get("name") or "לקוח").strip("_")
    day = (call.get("created_at") or "")[:10]
    return f"{name}_{day}_שיחה{call['id']}_{'לקוח' if kind == 'customer' else 'עסק'}.pdf"


def make_pdf(html_path: Path, pdf_path: Path) -> bool:
    """הופך HTML ל-PDF עם Chrome במצב headless (תומך בעברית ו-RTL מצוין)."""
    chrome = _chrome()
    if not chrome:
        return False
    try:
        subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                        f"--print-to-pdf={pdf_path}", html_path.resolve().as_uri()],
                       check=True, capture_output=True, timeout=60)
    except (subprocess.SubprocessError, OSError):
        return False
    return pdf_path.exists()


def recipients(call: dict) -> list[tuple[str, str]]:
    """כל הלקוחות שהשתתפו בשיחה ויש להם מייל: הלקוח הראשי (מהתיק) + לקוחות נוספים (מהשיחה / מהתיקים)."""
    out: list[tuple[str, str]] = []
    people = [call["customer"]] + call["analysis"].get("additional_customers", [])
    for p in people:
        email = p.get("email")
        if not email and p.get("phone"):
            email = db.email_by_phone(p["phone"])
        if email and "@" in email and email.lower() not in {e.lower() for _, e in out}:
            out.append((p.get("name") or "", email))
    return out


def _send(to: str, subject: str, html_body: str, attachment: Path | None) -> None:
    """Gmail API אם מחובר, אחרת SMTP אם מוגדר."""
    if gmail.is_configured():
        gmail.send(to, subject, html_body, [attachment] if attachment else [])
        return
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, os.environ["SMTP_USER"], to
    msg.set_content("הסיכום מצורף כקובץ PDF.")
    msg.add_alternative(html_body, subtype="html")
    if attachment and attachment.exists():
        msg.add_attachment(attachment.read_bytes(), maintype="application", subtype="pdf", filename=attachment.name)
    with smtplib.SMTP(os.environ["SMTP_HOST"], int(os.getenv("SMTP_PORT", "587")), timeout=30) as s:
        s.starttls()
        s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"])
        s.send_message(msg)


def email_mode() -> str:
    if gmail.is_configured():
        return "gmail-api"
    if os.getenv("SMTP_HOST") and os.getenv("SMTP_USER") and os.getenv("SMTP_PASSWORD"):
        return "smtp"
    return "none"


def send_reports(call_id: int, recipients_override: list[tuple[str, str]] | None = None) -> dict:
    """יוצר את הדוחות וה-PDF ושולח מייל לכל לקוח בשיחה.
    EMAIL_TEST_RECIPIENT ב-.env: כל המיילים מופנים לכתובת אחת (לדמו - כדי לא לשלוח לכתובות אמיתיות/מומצאות)."""
    call = db.get_call(call_id)
    biz_html = business_report(call)
    OUTBOX.mkdir(exist_ok=True)
    pdfs: dict[str, Path | None] = {}
    for kind, content in (("customer", customer_report(call)), ("business", biz_html)):
        html_path = OUTBOX / f"call{call_id}_{kind}.html"
        html_path.write_text(content, encoding="utf-8")
        pdf_path = OUTBOX / pdf_name(call, kind)
        pdfs[kind] = pdf_path if make_pdf(html_path, pdf_path) else None
    notes = ["PDF נוצר" if pdfs["customer"] else "PDF לא נוצר (אין Chrome)"]

    mode = email_mode()
    people = recipients_override if recipients_override is not None else recipients(call)
    if mode == "none":
        notes.append(f"מייל לא מוגדר ({len(people)} נמענים ממתינים)")
        return {"text": " · ".join(notes), "pdfs": pdfs, "sent_to": []}

    test_to = os.getenv("EMAIL_TEST_RECIPIENT")
    sent_to, failed = [], []
    for name, email in people:
        to = test_to or email
        subject = f"סיכום השיחה שלך עם {business_name()}" + (f" [דמו - במקור ל: {email}]" if test_to else "")
        try:
            _send(to, subject, customer_report(call, name), pdfs["customer"])
            sent_to.append(email)
        except Exception as e:  # noqa: BLE001
            failed.append(f"{email}: {e}")
    if os.getenv("BUSINESS_EMAIL"):
        try:
            _send(os.environ["BUSINESS_EMAIL"], f"דוח שיחה: {call['customer'].get('name')}", biz_html, pdfs["business"])
            notes.append("נשלח לעסק")
        except Exception as e:  # noqa: BLE001
            failed.append(f"עסק: {e}")

    via = "Gmail API" if mode == "gmail-api" else "SMTP"
    if sent_to:
        notes.insert(0, f"📧 נשלח ב-{via} ל-{len(sent_to)} לקוחות: {', '.join(sent_to)}")
    elif not people:
        notes.append("אין מייל ללקוח בתיק")
    if failed:
        notes.append("שליחה נכשלה: " + "; ".join(failed))
    return {"text": " · ".join(notes), "pdfs": pdfs, "sent_to": sent_to}

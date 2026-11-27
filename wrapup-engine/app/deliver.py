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

import classify
import db
import email_design
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
.emos{width:100%;border-collapse:separate;border-spacing:6px}.emo{background:#f5f6fa;border-radius:8px;padding:8px;text-align:center;vertical-align:top;width:33%}
.meter{height:8px;background:#eceef3;border-radius:99px;overflow:hidden;margin:8px 0 4px}.meter div{height:100%}
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


def customer_report(call: dict, recipient_name: str | None = None, inline_images: bool = False) -> str:
    """המייל/PDF הוויזואלי ללקוח (עיצוב Figma). inline_images=True → תמונות cid: למייל, אחרת data: ל-PDF."""
    assets = email_design.ensure_assets(_chrome())
    if inline_images:
        img = lambda n: f"cid:{n}" if n in assets else ""  # noqa: E731
    else:
        img = lambda n: email_design.data_uri(assets[n]) if n in assets else ""  # noqa: E731
    return email_design.customer_email_html(call, recipient_name, img, business_name(), calendar_link, EMOTION)


def business_report(call: dict, inline_images: bool = False) -> str:
    """המייל/PDF לנציג ולעסק: אותו מלל ואותו סדר כמו קודם, בעיצוב של המייל ללקוח,
    ובתוספת רמזור הציות ועדכוני השדות בתיק הלקוח."""
    a, c = call["analysis"], call["customer"]
    chrome = _chrome()
    assets = email_design.ensure_assets(chrome)
    score, delta = classify.experience_score(a)
    gpath = email_design.gauge_png(score, chrome)
    if gpath:
        assets[gpath.stem] = gpath
    img = (lambda n: f"cid:{n}" if n in assets else "") if inline_images else \
          (lambda n: email_design.data_uri(assets[n]) if n in assets else "")  # noqa: E731
    mood_of = {"angry": "Angry", "frustrated": "Angry", "stressed": "Sad", "confused": "Neutral",
               "calm": "Smile", "understanding": "Smile", "satisfied": "Happy"}
    card = 'background:#FFFFFF;border-radius:18px;padding:22px;margin:0 0 16px;'
    h3 = 'margin:0 0 10px;font-size:17px;font-weight:800;color:#2E3440;'
    p = 'margin:0;font-size:15px;line-height:1.6;color:#3B4252;'
    pbx = os.getenv("PBX_URL", "http://localhost:3000")

    def items(lst, empty="אין"):
        if not lst:
            return f'<p style="{p};color:#9A938C">{empty}</p>'
        return "".join(
            f'<div style="background:#F7F4F0;border-radius:12px;padding:10px 14px;margin:0 0 8px;font-size:15px;font-weight:600;color:#2E3440">'
            f'{_e(i["description"])}' + (f' <span style="background:#FFF1C9;color:#8A6100;font-size:12px;font-weight:700;border-radius:99px;padding:2px 10px">עד {_e(i["due_date"])}</span>' if i.get("due_date") else "")
            + '</div>' for i in lst)

    # Policy Guard + סיכונים (כמו קודם)
    policy = ""
    if a.get("policy_conflicts"):
        rows = "".join(f'<div style="background:#FFFFFF;border-radius:10px;padding:10px 12px;margin-top:8px;font-size:14px;color:#2E3440">'
                       f'🗣️ נאמר בשיחה: <q>{_e(x["rep_statement"])}</q><br>📜 בתקנון: <q>{_e(x["policy_text"])}</q><br>'
                       f'<span style="color:#7A808C">{_e(x["explanation"])}</span></div>' for x in a["policy_conflicts"])
        policy = (f'<div style="{card}background:#FDECEC;border:2px solid #E5534B">'
                  f'<p style="{h3}color:#7A1610">🛡️ Policy Guard: {len(a["policy_conflicts"])} הבטחות של הנציג סותרות את התקנון</p>{rows}</div>')
    risks = "".join(f'<div style="{card}background:#FDECEC;color:#B3261E;font-weight:700;padding:12px 16px">⚠️ [{_e(r["severity"])}] {_e(r["description"])}</div>'
                    for r in a["risk_flags"])

    # בקרת ציות רגולטורית (רמזור)
    comp = classify.compliance(a)
    compliance_html = ""
    if comp["checks"]:
        L = {"green": ("#2F9E6A", "#E7F6EE", "תקין"), "yellow": ("#C77A12", "#FFF4D6", "דורש אימות"), "red": ("#E5534B", "#FDECEC", "חסר רכיב חובה")}
        col, bg, title = L[comp["overall"]]
        lights = "".join(f'<div style="width:22px;height:22px;border-radius:99px;margin:4px auto;background:{L[k][0] if k == comp["overall"] else "#4A4D55"}"></div>'
                         for k in ("red", "yellow", "green"))
        dot = {"pass": ("#2F9E6A", "תקין"), "warning": ("#E0A43A", "לאימות"), "fail": ("#E5534B", "חסר")}
        checks = "".join(
            f'<div style="background:#FFFFFF;border-radius:10px;padding:10px 12px;margin-top:8px;font-size:14px">'
            f'<span style="display:inline-block;width:10px;height:10px;border-radius:99px;background:{dot[x["status"]][0]}"></span> '
            f'<b>{_e(x["check"])}</b> · <b style="color:{dot[x["status"]][0]}">{dot[x["status"]][1]}</b><br>'
            (f'<span style="color:#5F6672">{_e(x["note"])}</span><br>' if x["note"].strip() else '') + f'<i style="color:#9A938C">"{_e(x["evidence"])}"</i></div>' for x in comp["checks"])
        compliance_html = (f'<div style="{card}background:{bg};border:2px solid {col}">'
                           f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
                           f'<td width="40" valign="top"><div style="background:#26282E;border-radius:12px;padding:4px 6px">{lights}</div></td>'
                           f'<td style="padding-right:14px" valign="middle"><div style="font-size:12px;font-weight:700;color:#7A808C">🚦 בקרת ציות רגולטורית</div>'
                           f'<div style="font-size:20px;font-weight:800;color:{col}">{title}</div></td></tr></table>{checks}</div>')

    # עדכוני שדות בתיק הלקוח
    ups = classify.field_updates(a)
    updates_html = ""
    if ups or a.get("customer_intents"):
        rows = "".join(
            f'<div style="background:{"#E7F6EE" if u["risk"] == "low" else "#FFF8E6"};border-radius:10px;padding:10px 12px;margin-top:8px;font-size:14px">'
            f'<b>{_e(u["label"])}:</b> {_e(u["newValue"])} '
            + ('<b style="color:#2F7D52">✓ סיכון נמוך · נשמר אוטומטית בתיק</b>' if u["risk"] == "low"
               else f'<b style="color:#8A6100">🔒 נעול לאישור הנציג{"" if u["certain"] else " · לא ודאי"}</b>')
            + f'<br><i style="color:#9A938C">"{_e(u["evidence"])}"</i></div>' for u in ups)
        intents = "".join(f'<div style="background:#EEF0FF;border-radius:10px;padding:10px 12px;margin-top:8px;font-size:14px;color:#3D2FD1">'
                          f'<b>כוונה, לא עובדה:</b> הלקוח {_e(classify.INTENT_LABEL[i["intent"]])}: {_e(i["description"])} → נפתחה משימת שימור, '
                          f'לא שונה דבר בתיק<br><i style="color:#7A80B0">"{_e(i["evidence"])}"</i></div>' for i in a.get("customer_intents") or [])
        pending = sum(1 for u in ups if u["risk"] == "high")
        cta = (f'<div style="text-align:center;margin-top:14px"><a href="{_e(pbx)}" style="display:inline-block;background:#5B4CF0;color:#FFFFFF;'
               f'text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:12px">לאישור {pending} עדכונים במרכזייה</a></div>') if pending else ""
        updates_html = f'<div style="{card}"><p style="{h3}">🗂️ עדכוני שדות בתיק הלקוח</p>{rows}{intents}{cta}</div>'

    # תחושות הלקוח (כמו קודם, עם פרצופים)
    emotion = ""
    if a.get("emotion_map"):
        churn = a["churn_risk"]
        color = "#d93025" if churn >= 60 else "#e8a100" if churn >= 30 else "#0f9d58"
        cells = "".join(
            f'<td align="center" valign="top" style="background:#F7F4F0;border-radius:12px;padding:10px 6px;width:33%">'
            f'<div style="font-size:12px;color:#9A938C">{STAGE[e["stage"]]}</div>'
            f'<img src="{img("face_" + mood_of.get(e["emotion"], "Neutral"))}" width="44" height="44" alt="" style="display:block;margin:6px auto">'
            f'<div style="font-size:15px;font-weight:800;color:#26282E">{EMOTION.get(e["emotion"], e["emotion"])}</div>'
            f'<div style="font-size:12px;color:#7A808C">"{_e(e["evidence"])}"</div></td>' for e in a["emotion_map"])
        emotion = (f'<div style="{card}"><p style="{h3}">🎭 תחושות הלקוח במהלך השיחה</p>'
                   f'<table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>{cells}</tr></table>'
                   f'<p style="{p};margin-top:10px">הלקוח סיים את השיחה: <b>{EMOTION.get(a.get("customer_end_emotion"), "")}</b></p>'
                   f'<div style="height:8px;background:#EDEFF4;border-radius:99px;margin:8px 0 4px"><div style="height:8px;width:{churn}%;background:{color};border-radius:99px"></div></div>'
                   f'<p style="{p}">סיכון נטישה: <b style="color:{color}">{churn}%</b> · {_e(a["churn_reason"])}'
                   + ('<br><b style="color:#d93025">🚨 נפתחה משימת שימור לראש הצוות</b>' if churn >= db.CHURN_THRESHOLD else "") + '</p></div>')

    business_tasks = a["business_commitments"] + [t for t in a["action_items"] if t["owner"] == "business"]
    customer_tasks = [t for t in a["action_items"] if t["owner"] == "customer"]
    meet = next_meeting_block(a).replace('class="meet"', f'style="{card}background:#EEF0FF;border:2px solid #5B4CF0"').replace(
        'class="cal big"', 'style="display:inline-block;background:#5B4CF0;color:#FFFFFF;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:12px;margin-top:8px"').replace(
        'class="muted"', 'style="font-size:14px;color:#5F6672"')
    day = (call.get("created_at") or "")[:10]
    gauge = (f'<img src="{img(gpath.stem)}" width="300" alt="" style="display:block;margin:0 auto;border:0;max-width:100%;height:auto">'
             f'<div style="font-size:44px;font-weight:800;color:#26282E;line-height:1">{score}<span style="font-size:15px;color:#9AA0AA"> מתוך 100</span></div>'
             f'<div style="font-size:13px;font-weight:700;color:{"#2F9E6A" if delta >= 0 else "#E5534B"}">'
             f'{("↑" if delta >= 0 else "↓")} {abs(delta)} מהפתיחה · מדד חוויית לקוח</div>') if gpath else ""
    return f"""<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>סיכום פגישה ותחושות לקוח - {_e(c.get('name'))}</title>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#F3EEE8;font-family:Heebo,Arial,Helvetica,sans-serif;direction:rtl">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EEE8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#FAF6F2;border-radius:24px">
<tr><td style="padding:28px 28px 32px;text-align:right">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:15px;font-weight:800;color:#0F2942">{_e(business_name())} · <span style="color:#5B4CF0">WRAPUP AI</span></td>
    <td align="left" style="font-size:12px;color:#9A938C">{_e(day)}</td></tr></table>
  <div style="text-align:center;padding:14px 0 6px">
    {gauge}
    <h1 style="margin:14px 0 6px;font-size:26px;font-weight:800;color:#EE7A86">סיכום פגישה ותחושות לקוח: {_e(c.get('name'))}</h1>
    <p style="margin:0;font-size:13px;color:#7B7470">תיק #{c['id']} · טלפון {_e(c.get('phone') or '-')} · מספר לקוח {_e(c.get('customer_number') or '-')}<br>
    {_e(call['created_at'])} · סוג: {CATEGORIES.get(a['category'], '')} · סטטוס: {STATUS.get(a['status'], '')} · קובץ: {_e(call.get('filename') or '-')}</p>
  </div>
  <div style="height:16px"></div>
  {compliance_html}{policy}{risks}
  <div style="{card}"><p style="{h3}">📝 סיכום לתיק</p><p style="{p}">{_e(a['summary'])}</p></div>
  {meet}
  {emotion}
  {updates_html}
  <div style="{card}"><p style="{h3}">🗂️ לטיפול העסק (בירוקרטיה והתחייבויות)</p>{items(business_tasks)}</div>
  <div style="{card}"><p style="{h3}">⏳ ממתין ללקוח</p>{items(customer_tasks)}</div>
  <div style="{card}"><p style="{h3}">📩 ההודעה שנשלחה ללקוח</p><p style="{p};background:#E7F6EE;border-radius:12px;padding:12px;white-space:pre-line">{_e(a['customer_message'])}</p></div>
  {'<p style="text-align:center;font-size:12px;color:#9A938C">🔒 סוננו מהתמלול: ' + _e(', '.join(call['redactions'])) + '</p>' if call['redactions'] else ''}
  <p style="text-align:center;margin:8px 0 0;font-size:12px;font-weight:600;color:#9A938C">הדוח נוצר אוטומטית ע״י WrapUpAI</p>
</td></tr></table></td></tr></table></body></html>"""


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


def _build_message(to: str, subject: str, html_body: str, attachment: Path | None, inline: bool) -> EmailMessage:
    msg = EmailMessage()
    msg["To"], msg["Subject"] = to, subject
    if os.getenv("SMTP_USER") and not gmail.is_configured():
        msg["From"] = os.environ["SMTP_USER"]
    msg.set_content("הסיכום מצורף כקובץ PDF.")
    msg.add_alternative(html_body, subtype="html")
    if inline:
        html_part = msg.get_payload()[-1]
        for name in sorted(set(re.findall(r"cid:([\w-]+)", html_body))):
            path = email_design.ASSETS / f"{name}.png"
            if path.exists():
                html_part.add_related(path.read_bytes(), maintype="image", subtype="png", cid=f"<{name}>", filename=f"{name}.png")
    if attachment and attachment.exists():
        msg.add_attachment(attachment.read_bytes(), maintype="application", subtype="pdf", filename=attachment.name)
    return msg


def _send(to: str, subject: str, html_body: str, attachment: Path | None, inline: bool = False) -> None:
    """Gmail API אם מחובר, אחרת SMTP אם מוגדר."""
    msg = _build_message(to, subject, html_body, attachment, inline)
    if gmail.is_configured():
        gmail.send_message(msg)
        return
    with smtplib.SMTP(os.environ["SMTP_HOST"], int(os.getenv("SMTP_PORT", "587")), timeout=30) as smtp:
        smtp.starttls()
        smtp.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"])
        smtp.send_message(msg)


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

    mode = "none" if os.getenv("DISABLE_EMAIL") == "1" else email_mode()
    people = recipients_override if recipients_override is not None else recipients(call)
    if mode == "none":
        notes.append(f"מייל לא מוגדר ({len(people)} נמענים ממתינים)")
        return {"text": " · ".join(notes), "pdfs": pdfs, "sent_to": []}

    # אפשר כמה כתובות, מופרדות בפסיק
    test_to = [x.strip() for x in os.getenv("EMAIL_TEST_RECIPIENT", "").split(",") if x.strip()]
    business_to = [x.strip() for x in os.getenv("BUSINESS_EMAIL", "").split(",") if x.strip()]
    sent_to, failed = [], []
    if not people and test_to:
        # מצב דמו: ללקוח אין מייל בתיק - שולחים את הסיכום ללקוח לכתובות הדמו, כדי שיהיה אפשר לראות אותו
        people = [(call["customer"].get("name") or "", "")]
    for name, email in people:
        subject = f"סיכום השיחה שלך עם {business_name()}" + (
            f" [דמו - במקור ל: {email or 'ללקוח אין מייל בתיק'}]" if test_to else "")
        try:
            for to in test_to or [email]:
                _send(to, subject, customer_report(call, name, inline_images=True), pdfs["customer"], inline=True)
            sent_to.append(email or f"{name or 'לקוח'} (דמו - אין מייל בתיק)")
        except Exception as e:  # noqa: BLE001
            failed.append(f"{email}: {e}")
    biz_sent = []
    for to in business_to:
        try:
            _send(to, f"סיכום פגישה ותחושות לקוח: {call['customer'].get('name')}", business_report(call, inline_images=True),
                  pdfs["business"], inline=True)
            biz_sent.append(to)
        except Exception as e:  # noqa: BLE001
            failed.append(f"עסק {to}: {e}")
    if biz_sent:
        notes.append(f"דוח לעסק נשלח ל-{len(biz_sent)} כתובות")

    via = "Gmail API" if mode == "gmail-api" else "SMTP"
    if sent_to:
        notes.insert(0, f"📧 נשלח ב-{via} ל-{len(sent_to)} לקוחות: {', '.join(sent_to)}")
    elif not people:
        notes.append("אין מייל ללקוח בתיק")
    if failed:
        notes.append("שליחה נכשלה: " + "; ".join(failed))
    return {"text": " · ".join(notes), "pdfs": pdfs, "sent_to": sent_to}

"""
המייל הוויזואלי ללקוח (לפי העיצוב ב-Figma "WrapUpAI – תחושות לקוח"):
רקע קרם, מחוג צבעוני, כותרת ורודה, כרטיסים, פגישה הבאה עם "הוספה ליומן", ודירוג שירות בפרצופים.

Gmail לא מציג SVG במיילים, לכן המחוג והפרצופים נשמרים כתמונות PNG (נוצרות פעם אחת עם Chrome),
ומצורפות למייל כתמונות inline (cid:). ב-PDF ובתצוגה בדפדפן הן מוטמעות כ-data URI.
"""
import base64
import hashlib
import hmac
import html
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "email_assets"
MOODS = {"Angry": "#F47C7C", "Sad": "#F9A94B", "Neutral": "#FFD54F", "Smile": "#A5DC86", "Happy": "#6FCF97"}
RATING = [("Happy", "מצוין", 5), ("Smile", "טוב", 4), ("Neutral", "בסדר", 3), ("Sad", "לא טוב", 2), ("Angry", "גרוע", 1)]
MOUTH = {
    "Happy": '<path d="M19 37 Q32 53 45 37 Z" fill="#2E2A2A"/>',
    "Smile": '<path d="M21 39 Q32 49 43 39" stroke="#2E2A2A" stroke-width="4" fill="none" stroke-linecap="round"/>',
    "Neutral": '<path d="M22 42 L42 42" stroke="#2E2A2A" stroke-width="4" stroke-linecap="round"/>',
    "Sad": '<path d="M21 46 Q32 37 43 46" stroke="#2E2A2A" stroke-width="4" fill="none" stroke-linecap="round"/>',
    "Angry": '<path d="M21 46 Q32 38 43 46" stroke="#2E2A2A" stroke-width="4" fill="none" stroke-linecap="round"/>'
             '<path d="M16 19 L27 24" stroke="#2E2A2A" stroke-width="3.5" stroke-linecap="round"/>'
             '<path d="M48 19 L37 24" stroke="#2E2A2A" stroke-width="3.5" stroke-linecap="round"/>',
}


def _e(s) -> str:
    return html.escape(str(s or ""))


# ---------- תמונות (PNG) ----------

def _face_svg(mood: str, size: int) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 64 64">'
            f'<circle cx="32" cy="32" r="32" fill="{MOODS[mood]}"/><circle cx="23" cy="28" r="4" fill="#2E2A2A"/>'
            f'<circle cx="41" cy="28" r="4" fill="#2E2A2A"/>{MOUTH[mood]}</svg>')


def _gauge_svg(value: int, W: int) -> str:
    H = round(W * 0.56); cx = W / 2; cy = H - 12; R = W / 2 - 8; r = R * 0.46
    order = ["Angry", "Sad", "Neutral", "Smile", "Happy"]
    P = lambda rad, a: (cx + rad * math.cos(a), cy - rad * math.sin(a))  # noqa: E731
    parts = [f'<path d="M{cx - r + 6:.1f} {cy} A{r - 6} {r - 6} 0 0 1 {cx + r - 6:.1f} {cy} Z" fill="#FFFFFF"/>']
    for i, m in enumerate(order):
        a1, a2 = math.pi * (1 - i / 5), math.pi * (1 - (i + 1) / 5)
        (x1, y1), (x2, y2), (x3, y3), (x4, y4) = P(R, a1), P(R, a2), P(r, a2), P(r, a1)
        parts.append(f'<path d="M{x1:.2f} {y1:.2f} A{R} {R} 0 0 1 {x2:.2f} {y2:.2f} L{x3:.2f} {y3:.2f} '
                     f'A{r} {r} 0 0 0 {x4:.2f} {y4:.2f} Z" fill="{MOODS[m]}" stroke="#FAF6F2" stroke-width="5"/>')
        fx, fy = P((R + r) / 2, (a1 + a2) / 2); s = W * 0.09
        parts.append(f'<g transform="translate({fx - s / 2:.2f} {fy - s / 2:.2f}) scale({s / 64:.4f})">'
                     f'<circle cx="32" cy="32" r="32" fill="#FFFFFF"/><circle cx="23" cy="28" r="4" fill="#2E2A2A"/>'
                     f'<circle cx="41" cy="28" r="4" fill="#2E2A2A"/>{MOUTH[m]}</g>')
    a = math.pi * (1 - value / 100); L = r + (R - r) * 0.55; w = W * 0.024
    tx, ty = P(L, a)
    b1 = (cx + w * math.cos(a + math.pi / 2), cy - w * math.sin(a + math.pi / 2))
    b2 = (cx + w * math.cos(a - math.pi / 2), cy - w * math.sin(a - math.pi / 2))
    parts.append(f'<path d="M{b1[0]:.2f} {b1[1]:.2f} L{tx:.2f} {ty:.2f} L{b2[0]:.2f} {b2[1]:.2f} Z" fill="#26282E"/>'
                 f'<circle cx="{cx}" cy="{cy}" r="{W * 0.042:.1f}" fill="#26282E"/>'
                 f'<circle cx="{cx}" cy="{cy}" r="{W * 0.017:.1f}" fill="#FFFFFF"/>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">{"".join(parts)}</svg>'


def _render_png(svg: str, w: int, h: int, out: Path, chrome: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "a.html"
        page.write_text(f'<html><body style="margin:0;background:transparent">{svg}</body></html>', encoding="utf-8")
        subprocess.run([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--screenshot={out}",
                        f"--window-size={w},{h}", "--default-background-color=00000000", page.as_uri()],
                       check=True, capture_output=True, timeout=60)


def ensure_assets(chrome: str | None) -> dict[str, Path]:
    """יוצר פעם אחת את תמונות ה-PNG (פי 2 לחדות) ומחזיר {שם: נתיב}."""
    ASSETS.mkdir(exist_ok=True)
    wanted = {"gauge": (lambda: _gauge_svg(82, 720), 720, round(720 * 0.56))}
    for mood, _, _ in RATING:
        wanted[f"face_{mood}"] = ((lambda m=mood: _face_svg(m, 112)), 112, 112)
    for name, (svg, w, h) in wanted.items():
        out = ASSETS / f"{name}.png"
        if not out.exists() and chrome:
            try:
                _render_png(svg(), w, h, out, chrome)
            except (subprocess.SubprocessError, OSError):
                pass
    return {n: ASSETS / f"{n}.png" for n in wanted if (ASSETS / f"{n}.png").exists()}


def gauge_png(score: int, chrome: str | None) -> Path | None:
    """מחוג עם הציון האמיתי של השיחה (למייל לנציג). נשמר במטמון לפי ציון."""
    ASSETS.mkdir(exist_ok=True)
    out = ASSETS / f"gauge_{int(score)}.png"
    if not out.exists() and chrome:
        try:
            _render_png(_gauge_svg(int(score), 600), 600, round(600 * 0.56), out, chrome)
        except (subprocess.SubprocessError, OSError):
            return None
    return out if out.exists() else None


def data_uri(path: Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()


# ---------- קישורי משוב ----------

def _secret() -> bytes:
    return (os.getenv("WRAPUP_FEEDBACK_SECRET") or os.getenv("TEAM_BRIDGE_SECRET") or "wrapup-demo").encode()


def feedback_token(call_id: int) -> str:
    return hmac.new(_secret(), f"call:{call_id}".encode(), hashlib.sha256).hexdigest()[:20]


def verify_feedback_token(call_id: int, token: str) -> bool:
    return hmac.compare_digest(feedback_token(call_id), token or "")


def public_url() -> str:
    return os.getenv("WRAPUP_PUBLIC_URL", "http://localhost:8000").rstrip("/")


# ---------- ה-HTML של המייל ----------

def customer_email_html(call: dict, recipient_name: str | None, img, business: str, calendar_link, emotion_he: dict) -> str:
    """img(name) מחזיר src לתמונה (cid: במייל, data: ב-PDF)."""
    a, c = call["analysis"], call["customer"]
    name = (recipient_name or c.get("name") or "").strip()
    day = (call.get("created_at") or "")[:10]
    tok = feedback_token(call["id"])
    fb = f"{public_url()}/feedback/{call['id']}"
    card = 'background:#FFFFFF;border-radius:18px;padding:22px;margin:0 0 16px;'
    h3 = 'margin:0 0 10px;font-size:17px;font-weight:800;color:#2E3440;'
    p = 'margin:0;font-size:15px;line-height:1.6;color:#3B4252;'

    def btn(href, label, bg, fg, border=""):
        return (f'<a href="{_e(href)}" style="display:inline-block;background:{bg};color:{fg};text-decoration:none;'
                f'font-weight:700;font-size:15px;padding:12px 24px;border-radius:12px;{border}">{_e(label)}</a>')

    # policy warning (Policy Guard)
    policy = ""
    if a.get("policy_conflicts"):
        items = "".join(f'<li style="margin:6px 0">בשיחה נאמר: "{_e(x["rep_statement"])}"<br>'
                        f'<span style="color:#7A1610">לפי התקנון: "{_e(x["policy_text"])}"</span></li>' for x in a["policy_conflicts"])
        policy = (f'<div style="{card}border:2px solid #F47C7C;background:#FFF5F5">'
                  f'<p style="{h3}color:#B3261E">שימ/י לב: חלק ממה שנאמר בשיחה שונה מהתקנון</p>'
                  f'<ul style="margin:0;padding:0 18px 0 0;font-size:14px;color:#3B4252">{items}</ul></div>')

    # next meeting
    meet = ""
    nm = a.get("next_meeting")
    if nm:
        d = nm.get("date") or ""
        day_num = d[8:10] if len(d) == 10 else "?"
        months = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"]
        mon = months[int(d[5:7]) - 1] if len(d) == 10 else ""
        when = " · ".join(x for x in (d and f"{d[8:10]}.{d[5:7]}", nm.get("time"), nm.get("location")) if x) or "מועד יתואם"
        link = calendar_link(nm["title"], nm.get("date"), f"עם: {nm.get('with_whom') or business}", nm.get("time"), nm.get("location"))
        meet = (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF0FF;border-radius:18px;margin:0 0 16px">'
                f'<tr><td style="padding:20px" width="70"><div style="background:#FFFFFF;border-radius:14px;padding:8px 14px;text-align:center">'
                f'<div style="font-size:26px;font-weight:800;color:#5B4CF0">{_e(day_num)}</div><div style="font-size:12px;font-weight:700;color:#8A86C9">{_e(mon)}</div></div></td>'
                f'<td style="padding:20px 0">'
                f'<div style="font-size:13px;font-weight:700;color:#5B4CF0">הפגישה הבאה</div>'
                f'<div style="font-size:18px;font-weight:800;color:#26282E">{_e(nm["title"])}</div>'
                f'<div style="font-size:14px;color:#5F6672">{_e(when)}</div></td>'
                f'<td style="padding:20px" align="left">{btn(link, "הוספה ליומן שלי", "#5B4CF0", "#FFFFFF")}</td></tr></table>')

    # tasks
    my_tasks = [t for t in a["action_items"] if t["owner"] == "customer"]
    rows = "".join(
        f'<tr><td style="background:#F7F4F0;border-radius:12px;padding:12px 14px;font-size:15px;font-weight:600;color:#2E3440">'
        f'☐&nbsp; {_e(t["description"])}'
        + (f' <span style="background:#FFF1C9;color:#8A6100;font-size:12px;font-weight:700;border-radius:99px;padding:2px 10px">עד {_e(t["due_date"][8:10] + "." + t["due_date"][5:7])}</span>' if t.get("due_date") else "")
        + f' <a href="{_e(calendar_link(t["description"], t.get("due_date")))}" style="font-size:12px;color:#5B4CF0;font-weight:700">+ ליומן</a>'
        f'</td></tr><tr><td style="height:8px"></td></tr>' for t in my_tasks)
    tasks = (f'<div style="{card}"><p style="{h3}">מה עליך לעשות</p>'
             + (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>' if rows
                else f'<p style="{p}">אין משימות, הכל טופל 🎉</p>') + '</div>')

    commitments = ""
    if a.get("business_commitments"):
        li = "".join(f'<li style="margin:4px 0">{_e(t["description"])}</li>' for t in a["business_commitments"])
        commitments = (f'<div style="{card}"><p style="{h3}">מה {_e(business)} התחייב לעשות</p>'
                       f'<ul style="margin:0;padding:0 18px 0 0;{p}">{li}</ul></div>')

    glossary = ""
    if a.get("glossary"):
        g = "".join(f'<p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#2E3440">{_e(x["term"])}</p>'
                    f'<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#5F6672">{_e(x["explanation"])}</p>' for x in a["glossary"])
        glossary = f'<div style="{card}"><p style="{h3}">מה פירוש המונחים</p>{g}</div>'

    faces = "".join(
        f'<td align="center" style="padding:0 6px"><a href="{_e(f"{fb}/{score}?t={tok}")}" style="text-decoration:none">'
        f'<img src="{img(f"face_{mood}")}" width="56" height="56" alt="{_e(label)}" style="display:block;border:0;margin:0 auto 6px">'
        f'<span style="font-size:14px;font-weight:600;color:#7B8089">{_e(label)}</span></a></td>' for mood, label, score in RATING)
    feedback = (f'<div style="{card}padding:26px 22px;text-align:center">'
                f'<p style="margin:0 0 16px;font-size:22px;font-weight:700;color:#5F6672">איך היה השירות שקיבלת?</p>'
                f'<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>{faces}</tr></table>'
                f'<p style="margin:12px 0 18px;font-size:12px;color:#A3A9B3">לחיצה על פרצוף אחד מספיקה</p>'
                f'{btn(f"{fb}?t={tok}", "ספרו לנו עוד", "#F2C879", "#A6452E")}</div>')

    return f"""<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>סיכום השיחה שלך</title>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>@media print {{ body {{ background:#FAF6F2 !important; }} }}</style></head>
<body style="margin:0;padding:0;background:#F3EEE8;font-family:Heebo,Arial,Helvetica,sans-serif;direction:rtl">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EEE8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FAF6F2;border-radius:24px">
<tr><td style="padding:28px 28px 32px;text-align:right">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:15px;font-weight:800;color:#0F2942">{_e(business)}</td>
    <td align="left" style="font-size:12px;color:#9A938C">{_e(day)}</td></tr></table>
  <div style="text-align:center;padding:12px 0 8px">
    <img src="{img('gauge')}" width="360" alt="" style="display:block;margin:0 auto;border:0;max-width:100%;height:auto">
    <h1 style="margin:14px 0 6px;font-size:30px;font-weight:800;color:#EE7A86">{_e(name) + ", " if name else ""}הנה סיכום השיחה שלך</h1>
    <p style="margin:0 0 18px;font-size:14px;font-weight:600;letter-spacing:0.3px;color:#7B7470">כל מה שסיכמנו, מה נשאר לעשות ומתי, במקום אחד</p>
  </div>
  {policy}
  <div style="{card}"><p style="{h3}">מה סיכמנו</p><p style="{p};white-space:pre-line">{_e(a["customer_message"])}</p></div>
  {meet}{tasks}{commitments}{glossary}{feedback}
  <div style="text-align:center;padding-top:8px">
    <div style="width:80px;height:2px;background:#9A938C;margin:0 auto 10px"></div>
    <p style="margin:0;font-size:12px;font-weight:600;color:#9A938C">הסיכום נוצר אוטומטית ע״י WrapUpAI</p>
    <p style="margin:2px 0 0;font-size:12px;color:#B3ACA5">פרטים אישיים כמו ת״ז, סיסמאות וכרטיס אשראי סוננו ולא נשמרו</p>
  </div>
</td></tr></table></td></tr></table></body></html>"""


def feedback_page(call_id: int, token: str, saved_score: int | None, business: str, img) -> str:
    faces = "".join(
        f'<a href="/feedback/{call_id}/{score}?t={_e(token)}" style="text-decoration:none;display:inline-block;margin:0 8px;'
        f'opacity:{1 if saved_score in (None, score) else 0.35}"><img src="{img(f"face_{mood}")}" width="64" height="64" alt="{_e(label)}"><br>'
        f'<span style="font-size:14px;font-weight:600;color:#7B8089">{_e(label)}</span></a>' for mood, label, score in RATING)
    thanks = '<p style="font-size:18px;font-weight:700;color:#2F9E6A;margin:16px 0 0">תודה! הדירוג נשמר 🙏</p>' if saved_score else ""
    return f"""<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>משוב על השירות</title><link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800&display=swap" rel="stylesheet"></head>
<body style="margin:0;background:#F3EEE8;font-family:Heebo,Arial,sans-serif">
<div style="max-width:560px;margin:40px auto;background:#FAF6F2;border-radius:24px;padding:32px;text-align:center">
<p style="margin:0;font-size:15px;font-weight:800;color:#0F2942">{_e(business)}</p>
<h1 style="font-size:28px;font-weight:800;color:#EE7A86;margin:12px 0">איך היה השירות שקיבלת?</h1>
<div>{faces}</div>{thanks}
<form method="post" action="/feedback/{call_id}/comment?t={_e(token)}" style="margin-top:24px">
<textarea name="comment" rows="4" placeholder="ספרו לנו עוד (לא חובה)" style="width:100%;box-sizing:border-box;border:1px solid #D9D2CA;border-radius:14px;padding:12px;font:inherit;font-size:15px"></textarea>
<button type="submit" style="margin-top:12px;background:#F2C879;color:#A6452E;border:0;border-radius:12px;padding:12px 28px;font:inherit;font-size:15px;font-weight:700;cursor:pointer">שליחה</button>
</form></div></body></html>"""


def chrome_path() -> str | None:
    for p in ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
              "google-chrome", "chromium", "chrome"]:
        if os.path.exists(p) or shutil.which(p):
            return p
    return None

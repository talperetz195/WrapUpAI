"""
שליחת מיילים דרך Gmail API (מחשבון Gmail של העסק / הצוות).

הרשאה מינימלית: gmail.send בלבד - המערכת יכולה לשלוח, לא לקרוא את תיבת הדואר.

הגדרה חד-פעמית:
  1. ב-Google Cloud: מפעילים Gmail API ויוצרים OAuth Client מסוג "Desktop app"
  2. מורידים את קובץ ה-JSON ושומרים בתיקיית הפרויקט בשם gmail_credentials.json
  3. מריצים פעם אחת:   .venv/bin/python app/gmail.py
     נפתח דפדפן, מאשרים, ונוצר gmail_token.json. מעכשיו השליחה אוטומטית.
"""
import base64
import mimetypes
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CREDENTIALS = ROOT / "gmail_credentials.json"
TOKEN = ROOT / "gmail_token.json"
SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


class GmailError(Exception):
    pass


def is_configured() -> bool:
    return TOKEN.exists()


def _service():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    if not TOKEN.exists():
        raise GmailError("Gmail לא מחובר - צריך להריץ פעם אחת: .venv/bin/python app/gmail.py")
    creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            TOKEN.write_text(creds.to_json())
        else:
            raise GmailError("ההרשאה ל-Gmail פגה - להריץ שוב: .venv/bin/python app/gmail.py")
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def send_message(msg: EmailMessage) -> str:
    """שולח הודעת MIME מוכנה (כולל תמונות inline וקבצים מצורפים)."""
    from googleapiclient.errors import HttpError

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    try:
        sent = _service().users().messages().send(userId="me", body={"raw": raw}).execute()
    except HttpError as e:
        raise GmailError(f"Gmail החזיר שגיאה {e.status_code}: {e.reason}") from e
    return sent["id"]


def send(to: str, subject: str, html_body: str, attachments: list[Path] | None = None) -> str:
    """שולח מייל HTML עם קבצים מצורפים. מחזיר את מזהה ההודעה ב-Gmail."""
    from googleapiclient.errors import HttpError

    msg = EmailMessage()
    msg["To"], msg["Subject"] = to, subject
    msg.set_content("הסיכום מצורף כקובץ PDF.")
    msg.add_alternative(html_body, subtype="html")
    for path in attachments or []:
        if path and path.exists():
            maintype, subtype = (mimetypes.guess_type(path.name)[0] or "application/octet-stream").split("/")
            msg.add_attachment(path.read_bytes(), maintype=maintype, subtype=subtype, filename=path.name)

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    try:
        sent = _service().users().messages().send(userId="me", body={"raw": raw}).execute()
    except HttpError as e:
        raise GmailError(f"Gmail החזיר שגיאה {e.status_code}: {e.reason}") from e
    return sent["id"]


def authorize() -> None:
    """הרשאה חד-פעמית: פותח דפדפן לאישור ושומר טוקן."""
    from google_auth_oauthlib.flow import InstalledAppFlow

    if not CREDENTIALS.exists():
        raise SystemExit(f"לא נמצא {CREDENTIALS.name} - צריך להוריד אותו מ-Google Cloud (OAuth Client, Desktop app)")
    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS), SCOPES)
    creds = flow.run_local_server(port=0)
    TOKEN.write_text(creds.to_json())
    print("✅ Gmail מחובר. אפשר לשלוח.")


if __name__ == "__main__":
    authorize()

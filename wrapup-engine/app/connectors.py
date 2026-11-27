"""
מחברים (Connectors) למערכות של עסקים: WrapUpAI מתחבר מבחוץ, מושך הקלטות חדשות ומחזיר סיכום.

כל מחבר עובד כך, כל כמה שניות:
  1. GET  {url}/api/v1/recordings?status=new          ← אילו הקלטות חדשות יש
  2. GET  {url}/api/v1/recordings/{id}/audio          ← מורידים את קובץ השמע
  3. הצינור הרגיל: תמלול → סינון → ניתוח → תיק → דוחות
  4. POST {url}/api/v1/recordings/{id}/wrapup         ← הסיכום נכתב לתיק הלקוח במערכת העסק

אבטחה: מפתח API (כותרת X-API-Key) עם הרשאה מוגבלת - רק קריאת הקלטות וכתיבת סיכום.

הגדרה ב-.env (אפשר כמה מחברים: CONNECTOR_1_*, CONNECTOR_2_* ...):
  CONNECTOR_1_NAME=בנק השרון - מערכת מוקד
  CONNECTOR_1_URL=http://localhost:9000
  CONNECTOR_1_KEY=demo-key-123
"""
import logging
import os
import tempfile
import threading
import time
from pathlib import Path

import requests

import db
from pipeline import process_file

log = logging.getLogger("connectors")
POLL_SECONDS = 4
PUBLIC_URL = os.getenv("WRAPUP_PUBLIC_URL", "http://localhost:8000")


class Connector:
    def __init__(self, name: str, url: str, key: str):
        self.name, self.url, self.key = name, url.rstrip("/"), key
        self.status = "מתחבר..."
        self.last_sync: str | None = None
        self.processed = 0
        self._done: set[int] = set()

    def _req(self, method: str, path: str, **kw):
        resp = requests.request(method, self.url + path, headers={"X-API-Key": self.key}, timeout=60, **kw)
        resp.raise_for_status()
        return resp

    def _upload_pdfs(self, rec_id: int, result: dict) -> str:
        """מחזירים את קובצי ה-PDF למערכת של העסק (נשמרים בתיק הלקוח שם)."""
        url = ""
        for kind in ("customer", "business"):
            path = (result.get("pdfs") or {}).get(kind)
            if path and path.exists():
                with open(path, "rb") as f:
                    r = self._req("POST", f"/api/v1/recordings/{rec_id}/documents",
                                  files={"file": (path.name, f, "application/pdf")}).json()
                if kind == "customer":
                    url = self.url + r["url"]
        return url

    def _report(self, rec: dict, result: dict, pdf_url: str) -> dict:
        a, call_id = result["analysis"], result["call_id"]
        return {
            "title": a["title"], "summary": a["summary"], "status": a["status"],
            "customer_message": a["customer_message"],
            "policy_conflicts": a["policy_conflicts"],
            "churn_risk": a["churn_risk"], "churn_reason": a["churn_reason"],
            "customer_tasks": [t["description"] for t in a["action_items"] if t["owner"] == "customer"],
            "business_tasks": [t["description"] for t in a["business_commitments"]]
                              + [t["description"] for t in a["action_items"] if t["owner"] == "business"],
            "customer_report_url": f"{PUBLIC_URL}/reports/{call_id}/customer",
            "business_report_url": f"{PUBLIC_URL}/reports/{call_id}/business",
            "pdf_url": pdf_url or f"{PUBLIC_URL}/reports/{call_id}/customer.pdf",
            "delivery": result["delivery"],
            "sent_to": result.get("sent_to", []),
            "next_meeting": a.get("next_meeting"),
        }

    def sync_once(self) -> None:
        recordings = self._req("GET", "/api/v1/recordings", params={"status": "new"}).json()
        self.status = "מחובר ✅"
        self.last_sync = time.strftime("%H:%M:%S")
        for rec in recordings:
            if rec["id"] in self._done:
                continue
            self._done.add(rec["id"])
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / Path(rec["filename"]).name
                path.write_bytes(self._req("GET", rec["audio_url"]).content)
                try:
                    result = process_file(path, source=f"api:{self.name}", display_name=rec["filename"],
                                          customer_hint=rec.get("customer") or {})
                except Exception as e:  # noqa: BLE001
                    log.warning("[%s] הקלטה %s נכשלה: %s", self.name, rec["id"], e)
                    self._req("POST", f"/api/v1/recordings/{rec['id']}/failed", json={"error": str(e)})
                    continue
            pdf_url = self._upload_pdfs(rec["id"], result)
            self._req("POST", f"/api/v1/recordings/{rec['id']}/wrapup", json=self._report(rec, result, pdf_url))
            self.processed += 1

    def run(self) -> None:
        while True:
            try:
                self.sync_once()
            except requests.RequestException as e:
                self.status = f"אין חיבור ❌ ({type(e).__name__})"
            except Exception as e:  # noqa: BLE001
                self.status = f"שגיאה ❌ {e}"
                log.exception("[%s] שגיאה", self.name)
            time.sleep(POLL_SECONDS)


CONNECTORS: list[Connector] = []


def start() -> None:
    i = 1
    while os.getenv(f"CONNECTOR_{i}_URL"):
        c = Connector(os.getenv(f"CONNECTOR_{i}_NAME", f"מערכת {i}"),
                      os.environ[f"CONNECTOR_{i}_URL"], os.getenv(f"CONNECTOR_{i}_KEY", ""))
        CONNECTORS.append(c)
        threading.Thread(target=c.run, daemon=True, name=f"connector-{i}").start()
        i += 1


def status() -> list[dict]:
    return [{"name": c.name, "url": c.url, "status": c.status, "last_sync": c.last_sync,
             "processed": c.processed} for c in CONNECTORS]

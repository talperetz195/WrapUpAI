"""
גשר למערכת המרכזייה של הצוות (talperetz195/WrapUpAI): WrapUpAI משמש כ"מערכת החיצונית המבודדת".

החוזה (כפי שמוגדר במערכת שלהן):
  ← POST /api/external/analyze
     כותרת X-Transfer-Token: טוקן HMAC חד-פעמי (120 שניות, scope=audio_transcribe_only)
     גוף: jobId, uniqueCallName, callDate, anonymizedParticipants, audioBase64, mimeType
          + deliveryRecipients: [{name, email}]  (לשליחת המייל בלבד - לא נשלח למודל ה-AI)
  → POST {TEAM_INGEST_URL}  (/api/internal/ingest-report)
     כותרת X-External-Signature: HMAC-SHA256 על גוף הבקשה
     גוף: {jobId, analysis: {executiveSummary, participantsDetected, topics, actionItems, transcript}, wrapup: {...}}

הגדרה ב-.env (הסוד חייב להיות זהה ל-INTERNAL_BRIDGE_SECRET אצלן):
  TEAM_BRIDGE_SECRET=...
  TEAM_INGEST_URL=http://127.0.0.1:3000/api/internal/ingest-report
"""
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import tempfile
import threading
import time
import uuid
from datetime import date, timedelta
from pathlib import Path

import requests

import deliver
from pipeline import process_file

log = logging.getLogger("bridge")
_consumed_jtis: set[str] = set()

CATEGORY_MAP = {"documents": "מסמכים", "payment": "תשלום וגבייה", "appointment": "תיאום פגישה",
                "visit": "תיאום פגישה", "call_back": "תיאום פגישה", "other": "מעקב פנימי"}
EMOTION = {"calm": "רגוע", "understanding": "מבין", "satisfied": "מרוצה", "confused": "מבולבל",
           "stressed": "לחוץ", "frustrated": "מתוסכל", "angry": "כועס"}
STAGE = {"opening": "פתיחה", "middle": "אמצע", "closing": "סיום"}
EXT = {"audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/mp4": ".m4a",
       "audio/x-m4a": ".m4a", "audio/m4a": ".m4a", "audio/webm": ".webm", "audio/ogg": ".ogg", "video/mp4": ".m4a"}


class BridgeError(Exception):
    pass


def _secret() -> bytes:
    secret = os.getenv("TEAM_BRIDGE_SECRET")
    if not secret:
        raise BridgeError("TEAM_BRIDGE_SECRET לא מוגדר")
    return secret.encode()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _sign(data: str) -> str:
    return _b64url(hmac.new(_secret(), data.encode(), hashlib.sha256).digest())


def verify_transfer_token(token: str | None, job_id: str) -> None:
    """אותה בדיקה בדיוק כמו consumeScopedTransferToken אצלן: חתימה, scope, שיוך ל-job, תוקף, חד-פעמיות."""
    if not token or token.count(".") != 1:
        raise BridgeError("טוקן העברה חסר או לא תקין")
    encoded, sig = token.split(".")
    if not hmac.compare_digest(sig, _sign(encoded)):
        raise BridgeError("חתימת HMAC על טוקן ההעברה שגויה")
    payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    if payload.get("scope") != "audio_transcribe_only":
        raise BridgeError("הרשאת הטוקן אינה תואמת")
    if payload.get("jobId") != job_id:
        raise BridgeError("הטוקן לא שייך למשימה הזו")
    if payload.get("exp", 0) < time.time() * 1000:
        raise BridgeError("תוקף הטוקן פג")
    if payload.get("jti") in _consumed_jtis:
        raise BridgeError("ניסיון שימוש חוזר בטוקן נחסם")
    _consumed_jtis.add(payload["jti"])


# ---------- המרה מהניתוח שלנו לפורמט הדוח שלהן ----------

def _transcript_lines(transcript: str, roles: dict[str, str]) -> list[dict]:
    out = []
    for line in transcript.splitlines():
        m = re.match(r"^(דובר \S+)(?: \[(\d\d:\d\d)\])?:\s*(.*)$", line.strip())
        if m:
            label, ts, text = m.groups()
            out.append({"timestamp": ts or "00:00", "speakerLabel": label, "role": roles.get(label, "דובר"), "text": text})
        elif line.strip():
            out.append({"timestamp": "00:00", "speakerLabel": "דובר", "role": "דובר", "text": line.strip()})
    return out


def _task(title: str, description: str, owner: str, category: str, priority: str,
          day: str | None, at: str | None) -> dict:
    default_day = (date.today() + timedelta(days=3)).isoformat()
    return {
        "taskId": f"wt-{uuid.uuid4().hex[:8]}",
        "title": title[:80],
        "description": description,
        "owner": owner,
        "priority": priority,
        "category": category,
        "suggestedDate": day if day and re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) else default_day,
        "suggestedTime": at if at and re.fullmatch(r"\d{2}:\d{2}", at) else "10:00",
        "addedToCalendar": False,
    }


EMOTION_SCORE = {"angry": 10, "frustrated": 20, "stressed": 35, "confused": 50, "calm": 65, "understanding": 75, "satisfied": 92}
STAGE_WEIGHT = {"opening": 0.2, "middle": 0.3, "closing": 0.5}


def sentiment_for_team(a: dict) -> dict:
    """נתוני רגש מובנים למסכי המרכזייה: ציון חוויה, מסע רגש, נטישה, Policy Guard והמלצה לנציג."""
    journey = sorted(a.get("emotion_map") or [], key=lambda e: list(STAGE_WEIGHT).index(e["stage"]))
    by_stage = {e["stage"]: EMOTION_SCORE.get(e["emotion"], 50) for e in journey}
    total_w = sum(STAGE_WEIGHT[s] for s in by_stage) or 1
    score = round(sum(by_stage[s] * STAGE_WEIGHT[s] for s in by_stage) / total_w) if by_stage else 50
    opening = by_stage.get("opening", score)
    end = a.get("customer_end_emotion") or (journey[-1]["emotion"] if journey else "calm")
    return {
        "score": score,
        "deltaFromOpening": by_stage.get("closing", score) - opening,
        "endEmotion": end,
        "journey": [{"stage": e["stage"], "emotion": e["emotion"], "evidence": e["evidence"],
                     "timestamp": e.get("timestamp")} for e in journey],
        "churnRisk": a["churn_risk"],
        "churnReason": a["churn_reason"],
        "policyConflicts": [{"repStatement": p["rep_statement"], "policyText": p["policy_text"],
                             "explanation": p["explanation"], "severity": p["severity"]} for p in a["policy_conflicts"]],
        "recommendation": a.get("rep_recommendation") or "",
        "openTasks": len(a["action_items"]) + len(a["business_commitments"]),
        "title": a["title"],
    }


from classify import INTENT_LABEL
from classify import compliance as compliance_for_team
from classify import field_updates as field_updates_for_team


def to_team_report(a: dict, transcript: str) -> dict:
    roles = {s["label"]: s["role"] for s in a.get("speakers", [])}
    rep_label = next((s["label"] for s in a.get("speakers", []) if "נציג" in s["role"]), "נציג")

    topics = [{"topicTitle": a["title"], "topicSummary": a["summary"], "participantStatements": []}]
    if a["policy_conflicts"]:
        topics.append({
            "topicTitle": f"🛡️ Policy Guard: {len(a['policy_conflicts'])} הבטחות שסותרות את התקנון",
            "topicSummary": "הנציג הבטיח ללקוח תנאים שאינם תואמים את תקנון הארגון. יש לתקן מול הלקוח בכתב.",
            "participantStatements": [{
                "speakerLabel": rep_label, "role": "נציג שירות",
                "statementSummary": f"נאמר: \"{p['rep_statement']}\"",
                "keyPoints": [f"בתקנון: {p['policy_text']}", p["explanation"],
                              f"בסיכון: {'הלקוח' if p['at_risk'] == 'customer' else 'הארגון'} · חומרה: {p['severity']}"],
            } for p in a["policy_conflicts"]],
        })
    if a.get("emotion_map"):
        path = " ← ".join(f"{STAGE[e['stage']]}: {EMOTION.get(e['emotion'], e['emotion'])}" for e in a["emotion_map"])
        topics.append({
            "topicTitle": f"🎭 מפה רגשית · סיכון נטישה {a['churn_risk']}%",
            "topicSummary": f"{path}. {a['churn_reason']}",
            "participantStatements": [],
        })
    if a["glossary"]:
        topics.append({
            "topicTitle": "📖 מונחים שהוסברו ללקוח",
            "topicSummary": " · ".join(f"{g['term']}: {g['explanation']}" for g in a["glossary"]),
            "participantStatements": [],
        })

    urgent = bool(a["policy_conflicts"]) or a["churn_risk"] >= 60
    tasks = [_task(t["description"], t["description"], "הלקוח", CATEGORY_MAP.get(t["category"], "מעקב פנימי"),
                   "רגילה", t.get("due_date"), None)
             for t in a["action_items"] if t["owner"] == "customer"]
    tasks += [_task(t["description"], t["description"], "נציג מטפל", CATEGORY_MAP.get(t["category"], "מעקב פנימי"),
                    "גבוהה", t.get("due_date"), None)
              for t in a["business_commitments"] + [t for t in a["action_items"] if t["owner"] == "business"]]
    nm = a.get("next_meeting")
    if nm:
        tasks.insert(0, _task(nm["title"], f"עם: {nm.get('with_whom') or '-'} · {nm.get('location') or ''}",
                              nm.get("with_whom") or "נציג מטפל", "תיאום פגישה", "גבוהה", nm.get("date"), nm.get("time")))
    for it in a.get("customer_intents") or []:
        tasks.append(_task(f"משימת שימור · הלקוח {INTENT_LABEL[it['intent']]}",
                           f"כוונה בלבד, לא עובדה: לא לשנות את התיק. ציטוט: \"{it['evidence']}\"",
                           "ראש צוות", "מעקב פנימי", "דחופה", None, None))
    if a["churn_risk"] >= 60 and not a.get("customer_intents"):
        tasks.append(_task("שימור לקוח - סיכון נטישה גבוה", a["churn_reason"], "ראש צוות", "מעקב פנימי",
                           "דחופה", None, None))
    if a["policy_conflicts"]:
        tasks.append(_task("תיקון הבטחה שסותרת את התקנון", "לפנות ללקוח בכתב ולהבהיר את התנאים לפי התקנון",
                           "ראש צוות", "מעקב פנימי", "דחופה", None, None))

    summary = a["summary"]
    if urgent:
        summary = ("⚠️ " + " · ".join(x for x in (
            f"{len(a['policy_conflicts'])} סתירות לתקנון" if a["policy_conflicts"] else "",
            f"סיכון נטישה {a['churn_risk']}%" if a["churn_risk"] >= 60 else "") if x) + " — " + summary)

    return {
        "executiveSummary": summary,
        "participantsDetected": [{"speakerLabel": s["label"], "role": s["role"]} for s in a.get("speakers", [])],
        "topics": topics,
        "actionItems": tasks,
        "transcript": _transcript_lines(transcript, roles),
    }


# ---------- הטיפול עצמו (ברקע) ----------

TEAM_STAGE = {"transcribing": "transcribing_audio", "analyzing": "analyzing_topics", "delivering": "signing_and_returning"}


def _post_signed(path_suffix: str, payload: dict) -> requests.Response:
    base = os.getenv("TEAM_INGEST_URL", "http://127.0.0.1:3000/api/internal/ingest-report").rsplit("/", 1)[0]
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return requests.post(f"{base}/{path_suffix}", data=serialized.encode(), timeout=60,
                         headers={"Content-Type": "application/json", "X-External-Signature": _sign(serialized)})


def _status(job_id: str, stage: str, error: str | None = None) -> None:
    """מעדכן את המרכזייה בשלב העיבוד (חתום) - המסך שלהן מתעדכן בזמן אמת."""
    payload = {"jobId": job_id, "stage": stage}
    if error:
        payload["error"] = error
    try:
        _post_signed("external-status", payload)
    except requests.RequestException as e:
        log.warning("[bridge] עדכון סטטוס נכשל: %s", e)


def _pdf_payload(path: Path | None) -> dict:
    if not path:
        return {"fileName": None, "base64": None}
    return {"fileName": path.name, "base64": base64.b64encode(path.read_bytes()).decode()}


def _run_job(body: dict) -> None:
    job_id = body["jobId"]
    recipients = [(r.get("name") or "", r["email"]) for r in body.get("deliveryRecipients") or [] if r.get("email")]
    ext = EXT.get(body["mimeType"].split(";")[0].strip().lower(), ".wav")
    try:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / f"{body['uniqueCallName']}{ext}"
            path.write_bytes(base64.b64decode(body["audioBase64"]))
            # שם הלקוח מגיע רק לצורך המסירה (שם ה-PDF והפנייה במייל) - לא נשלח למודל ה-AI
            name = body.get("deliveryCustomerName") or (recipients[0][0] if recipients else "")
            hint = {"name": name} if name else {}
            result = process_file(path, source="api:מרכזיית הצוות", display_name=path.name,
                                  customer_hint=hint, recipients=recipients,
                                  # מייל ללקוח רק אם הנציג בחר במרכזייה (ברירת מחדל: לא)
                                  send_customer=bool(body.get("sendCustomerEmail", False)),
                                  on_progress=lambda st: _status(job_id, TEAM_STAGE[st]))
        pdfs = result.get("pdfs") or {}
        biz, cust = _pdf_payload(pdfs.get("business")), _pdf_payload(pdfs.get("customer"))
        callback = {
            "jobId": job_id,
            "analysis": to_team_report(result["analysis"], result["transcript"]),
            "wrapup": {
                "delivery": result["delivery"],
                "sentTo": result.get("sent_to", []),
                "sentiment": sentiment_for_team(result["analysis"]),
                "repConduct": {**(result["analysis"].get("rep_conduct") or {}),
                               "managerNotified": deliver.conduct_needs_manager(result["analysis"])},
                "customerEmailSent": bool(body.get("sendCustomerEmail", False)),
                "compliance": compliance_for_team(result["analysis"]),
                "fieldUpdates": field_updates_for_team(result["analysis"]),
                "intents": [{"intent": i["intent"], "label": INTENT_LABEL[i["intent"]], "description": i["description"],
                             "evidence": i["evidence"]} for i in result["analysis"].get("customer_intents") or []],
                # PDF לארגון: סיכום הפגישה + תחושות הלקוח (מפה רגשית, סיכון נטישה)
                "pdfFileName": biz["fileName"],
                "pdfBase64": biz["base64"],
                # PDF שנשלח ללקוחות במייל
                "customerPdfFileName": cust["fileName"],
                "customerPdfBase64": cust["base64"],
            },
        }
    except Exception as e:  # noqa: BLE001
        log.exception("[bridge] %s נכשל", job_id)
        callback = None
        error = str(e)

    if callback is None:
        log.warning("[bridge] לא נשלח דוח עבור %s: %s", job_id, error)
        _status(job_id, "failed", f"WrapUpAI: {error}")  # המרכזייה משחררת את השיחה לניסיון חוזר
        return
    resp = _post_signed("ingest-report", callback)
    log.info("[bridge] %s → ingest %s %s", job_id, resp.status_code, resp.text[:200])


def accept(token: str | None, body: dict) -> dict:
    for field in ("jobId", "uniqueCallName", "audioBase64", "mimeType"):
        if not body.get(field):
            raise BridgeError(f"חסר שדה: {field}")
    verify_transfer_token(token, body["jobId"])
    _status(body["jobId"], "token_verified")
    threading.Thread(target=_run_job, args=(body,), daemon=True, name=f"bridge-{body['jobId']}").start()
    return {"ok": True, "jobId": body["jobId"], "accepted": True}

"""
תמלול קובץ שמע לעברית עם Azure Speech (Fast transcription).

הגדרות ב-.env:
  AZURE_SPEECH_KEY=...
  AZURE_SPEECH_ENDPOINT=https://<שם-המשאב>.cognitiveservices.azure.com

מחזיר טקסט עם שמות דוברים, למשל:
  דובר 1: שלום, בנק השרון...
  דובר 2: היי, אני מתקשרת בקשר ל...
"""
import json
import os
import time
from pathlib import Path

import requests

API_VERSION = "2025-10-15"
AUDIO_EXTENSIONS = {".wav", ".mp3", ".ogg", ".opus", ".flac", ".wma", ".aac", ".amr", ".webm", ".m4a"}
TEXT_EXTENSIONS = {".txt"}


class TranscriptionError(Exception):
    pass


def is_configured() -> bool:
    return bool(os.getenv("AZURE_SPEECH_KEY") and os.getenv("AZURE_SPEECH_ENDPOINT"))


# מונחים נפוצים בשיחות שירות - עוזרים למודל התמלול לזהות אותם נכון
COMMON_PHRASES = ["הוראת קבע", "הצמדה למדד", "הצמדה שנתית", "קרן השתלמות", "קופת גמל", "טופס 161", "טופס 106",
                  "ריבית פריים", "פריסת תשלומים", "דמי ביטול", "עמלת הסדר", "פוליסה", "השתתפות עצמית", "ביטוח לאומי",
                  "ארנונה", "תלוש שכר", "מספר לקוח", "תעודת זהות"]


def _call_azure(audio: bytes, filename: str, diarization: bool, phrases: list[str] | None = None) -> dict:
    endpoint = os.environ["AZURE_SPEECH_ENDPOINT"].rstrip("/")
    definition = {"locales": ["he-IL"], "profanityFilterMode": "None"}
    if diarization:
        definition["diarization"] = {"enabled": True, "maxSpeakers": 4}
    if phrases:
        definition["phraseList"] = {"phrases": phrases[:500]}

    # עומס רגעי (429/5xx) → מחכים ומנסים שוב, עד 4 פעמים
    for attempt in range(4):
        resp = requests.post(
            f"{endpoint}/speechtotext/transcriptions:transcribe",
            params={"api-version": API_VERSION},
            headers={"Ocp-Apim-Subscription-Key": os.environ["AZURE_SPEECH_KEY"]},
            files={"audio": (filename, audio), "definition": (None, json.dumps(definition))},
            timeout=300,
        )
        if resp.status_code != 429 and resp.status_code < 500:
            break
        time.sleep(int(resp.headers.get("retry-after", 0)) or 5 * (attempt + 1))
    if resp.status_code == 401:
        raise TranscriptionError("מפתח Azure Speech לא תקין")
    if not resp.ok:
        raise TranscriptionError(f"Azure Speech החזיר שגיאה {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def _format(result: dict) -> str:
    phrases = result.get("phrases") or []
    if phrases and any("speaker" in p for p in phrases):
        # מאחדים משפטים רצופים של אותו דובר לשורה אחת
        lines: list[list] = []
        for p in phrases:
            speaker = p.get("speaker")
            if lines and lines[-1][0] == speaker:
                lines[-1][1] += " " + p["text"]
            else:
                secs = int(p.get("offsetMilliseconds", 0)) // 1000
                lines.append([speaker, p["text"], f"{secs // 60:02d}:{secs % 60:02d}"])
        return "\n".join(f"דובר {s} [{ts}]: {t}" for s, t, ts in lines)
    combined = result.get("combinedPhrases") or []
    return "\n".join(c["text"] for c in combined)


def transcribe_file(path: Path, business_terms: list[str] | None = None) -> str:
    ext = path.suffix.lower()
    if ext in TEXT_EXTENSIONS:
        # קובץ שכבר תומלל (שימושי לבדיקות ולדמו בלי מפתח)
        return path.read_text(encoding="utf-8", errors="replace")
    if ext not in AUDIO_EXTENSIONS:
        raise TranscriptionError(f"סוג קובץ לא נתמך: {ext}")
    if not is_configured():
        raise TranscriptionError("כדי לתמלל שמע צריך להגדיר AZURE_SPEECH_KEY ו-AZURE_SPEECH_ENDPOINT בקובץ .env")

    audio = path.read_bytes()
    phrases = list(dict.fromkeys((business_terms or []) + COMMON_PHRASES))  # מילון העסק קודם, בלי כפילויות
    try:
        result = _call_azure(audio, path.name, diarization=True, phrases=phrases)
    except TranscriptionError:
        # אם משהו מהתוספות לא נתמך לקובץ הזה - מנסים בסיסי: בלי הפרדת דוברים ובלי רשימת מונחים
        result = _call_azure(audio, path.name, diarization=False)

    text = _format(result).strip()
    if not text:
        raise TranscriptionError("התמלול חזר ריק - אולי אין דיבור בקובץ")
    return text

"""
סיווגים משותפים (משמשים גם את הגשר למרכזייה וגם את המייל לנציג):
רמזור ציות, עדכוני שדות לפי רמת סיכון, וציון חוויית לקוח.
"""
import uuid

CONTACT_FIELDS = {"phone", "email", "city"}
INTENT_LABEL = {"churn": "שוקל לעזוב", "cancel": "שוקל לבטל", "complaint": "שוקל להתלונן", "other": "כוונה"}
EMOTION_SCORE = {"angry": 10, "frustrated": 20, "stressed": 35, "confused": 50, "calm": 65, "understanding": 75, "satisfied": 92}
STAGE_WEIGHT = {"opening": 0.2, "middle": 0.3, "closing": 0.5}


def compliance(a: dict) -> dict:
    """אדום אם בדיקה כלשהי נכשלה, צהוב אם יש בדיקה לאימות, אחרת ירוק."""
    checks = a.get("compliance_checks") or []
    statuses = {c["status"] for c in checks}
    overall = "red" if "fail" in statuses else "yellow" if "warning" in statuses else "green"
    return {"overall": overall, "checks": [{"check": c["check"].split(":")[0].strip(), "status": c["status"],
                                             "evidence": c["evidence"], "note": c["note"]} for c in checks]}


def field_updates(a: dict) -> list[dict]:
    """סיכון נמוך (פרטי קשר ודאיים) = אישור אוטומטי. כל השאר ננעל לאישור ידני של הנציג."""
    out = []
    for u in a.get("field_updates") or []:
        auto = u["field"] in CONTACT_FIELDS and u["certain"]
        out.append({"id": f"fu-{uuid.uuid4().hex[:8]}", "field": u["field"], "label": u["label"], "newValue": u["new_value"],
                    "certain": u["certain"], "evidence": u["evidence"], "risk": "low" if auto else "high",
                    "status": "auto_approved" if auto else "pending"})
    return out


def experience_score(a: dict) -> tuple[int, int]:
    """(ציון חוויה 0-100, שינוי מהפתיחה)."""
    by_stage = {e["stage"]: EMOTION_SCORE.get(e["emotion"], 50) for e in a.get("emotion_map") or []}
    total = sum(STAGE_WEIGHT[s] for s in by_stage) or 1
    score = round(sum(by_stage[s] * STAGE_WEIGHT[s] for s in by_stage) / total) if by_stage else 50
    return score, by_stage.get("closing", score) - by_stage.get("opening", score)

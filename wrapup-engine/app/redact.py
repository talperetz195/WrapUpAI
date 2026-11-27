"""
סינון פרטים אישיים מהתמלול - רץ *לפני* שהטקסט נשלח ל-AI.
מחזיר את הטקסט המסונן + רשימה של מה הוסר (בלי הערכים עצמם).
"""
import re

# ---------- בדיקות תקינות ----------

def _valid_israeli_id(digits: str) -> bool:
    """אלגוריתם ספרת הביקורת של תעודת זהות ישראלית."""
    digits = digits.zfill(9)
    if len(digits) != 9:
        return False
    total = 0
    for i, ch in enumerate(digits):
        n = int(ch) * (1 if i % 2 == 0 else 2)
        total += n if n < 10 else n - 9
    return total % 10 == 0


def _valid_luhn(digits: str) -> bool:
    """בדיקת Luhn למספרי כרטיסי אשראי."""
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


# ---------- תבניות ----------

# כרטיס אשראי: 13-19 ספרות, אולי עם רווחים/מקפים
CARD_RE = re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")
# ת"ז: 8-9 ספרות רצופות
ID_RE = re.compile(r"(?<!\d)\d{8,9}(?!\d)")
# סיסמה / קוד סודי / קוד אימות / CVV ואחריו ערך
SECRET_RE = re.compile(
    r"(?P<label>סיסמה|סיסמא|סיסמת|password|קוד סודי|קוד אישי|קוד אימות|קוד חד[ -]פעמי|"
    r"קוד שקיבלת|cvv|קוד אבטחה|שלוש הספרות)"
    r"(?P<sep>[^\S\n]*(?:שלי|שלך|היא|הוא|זה|זו|:|-|,)?[^\S\n]*(?:היא|הוא|זה)?[^\S\n]*)"
    r"(?P<value>\S+)",
    re.IGNORECASE,
)


# מספרים שנאמרו בקול ותומללו במילים, למשל: "123 מיליון 456,000. מאות 82"
_NUM_TOKEN = r"(?:\d[\d,.\-]*|מיליון|מליון|אלף|אלפים|מאות|מאה)"
_NUM_RUN = rf"{_NUM_TOKEN}(?:[\s.,\-]+{_NUM_TOKEN})*"
# מילת מפתח ← עד 40 תווים בלי ספרות ← רצף מספרי. מוסרים את הרצף.
SPOKEN_ID_RE = re.compile(
    r"(?P<label>תעודת זהות|תעודת הזהות|ת\"ז|תז|מספר זהות|כרטיס אשראי|מספר כרטיס|מספר הכרטיס)"
    rf"(?P<gap>[^\d]{{0,40}}?)(?P<value>{_NUM_RUN})"
)


def redact(text: str) -> tuple[str, list[str]]:
    removed: list[str] = []

    def spoken_sub(m: re.Match) -> str:
        if sum(ch.isdigit() for ch in m.group("value")) < 4:
            return m.group()
        is_card = "כרטיס" in m.group("label")
        removed.append("מספר כרטיס אשראי (נאמר בקול)" if is_card else "תעודת זהות (נאמרה בקול)")
        return f"{m.group('label')}{m.group('gap')}{'[כרטיס אשראי הוסר]' if is_card else '[ת\"ז הוסרה]'}"

    text = SPOKEN_ID_RE.sub(spoken_sub, text)

    def secret_sub(m: re.Match) -> str:
        removed.append(f"סוד ({m.group('label')})")
        return f"{m.group('label')}{m.group('sep')}[הוסר]"

    text = SECRET_RE.sub(secret_sub, text)

    def card_sub(m: re.Match) -> str:
        digits = re.sub(r"\D", "", m.group())
        if 13 <= len(digits) <= 19:
            # עדיף להסיר גם מספר שתומלל עם שגיאה - פרטיות קודם
            removed.append("מספר כרטיס אשראי" if _valid_luhn(digits) else "מספר ארוך (אולי כרטיס)")
            return "[כרטיס אשראי הוסר]"
        return m.group()

    text = CARD_RE.sub(card_sub, text)

    def id_sub(m: re.Match) -> str:
        num = m.group()
        # ת"ז תקינה, או 9 ספרות שלא מתחילות ב-0 (טלפון קווי מתחיל ב-0) - ייתכן ת"ז שתומללה עם שגיאה
        if _valid_israeli_id(num) or (len(num) == 9 and not num.startswith("0")):
            removed.append("תעודת זהות")
            return "[ת\"ז הוסרה]"
        return m.group()

    text = ID_RE.sub(id_sub, text)
    return text, removed


if __name__ == "__main__":
    sample = "נציג: מה תעודת הזהות? לקוח: 123456782. והסיסמה שלי היא abc123, כרטיס 4580 1234 5678 9012"
    print(redact(sample))

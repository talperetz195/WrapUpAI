"""
המוח: שולח את התמלול (אחרי סינון) למודל שפה ומקבל ניתוח מובנה (CallAnalysis).

החיבור נבחר לפי מה שמוגדר בקובץ .env (הראשון שמוגדר):
  1. Azure OpenAI (GPT)          ← AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT
  2. Claude דרך Azure Foundry    ← ANTHROPIC_FOUNDRY_API_KEY + ANTHROPIC_FOUNDRY_RESOURCE
  3. Claude ישירות מ-Anthropic   ← ANTHROPIC_API_KEY
  4. אין מפתח                     ← מצב דמו: תשובה קבועה לדוגמה
"""
import os
from datetime import date

from schema import CallAnalysis

CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-opus-5-5")

SYSTEM_PROMPT = """את/ה WrapUpAI: עוזר/ת שמנתח/ת תמלולי שיחות שירות בין עסק ללקוח (בנק, ביטוח, עירייה, קופת חולים וכו').
המטרה: שהלקוח לא ישכח כלום ממה שנאמר, שלא יוטעה, ושהעסק יקבל תיעוד מסודר בתיק הלקוח.

כללים:
- כתוב/י הכל בעברית (גם אם השיחה בשפה אחרת).
- אם בשיחה משתתף יותר מלקוח אחד (למשל בני זוג בחשבון משותף) - הלקוח הראשי ב-customer והשאר ב-additional_customers.
- next_meeting: אם נקבעה פגישה/שיחת המשך, היא מופיעה רק ב-next_meeting - לא לשכפל אותה כמשימה ב-action_items או ב-business_commitments.
- next_meeting: כל פגישה, תור או שיחת המשך שנקבעו (גם "רועי יחזור אליך ביום שלישי ב-10") - עם תאריך ושעה מדויקים.
- הסתמך/י רק על מה שנאמר בשיחה. אל תמציא/י פרטים, סכומים או תאריכים.
- תאריכים יחסיים ("עד יום ראשון", "תוך 7 ימים") המר/י לתאריך מדויק לפי תאריך השיחה.
- כל משימה צריכה להיות ברורה מספיק כדי לבצע אותה בלי לזכור את השיחה.
- הבחן/י בין מה שהלקוח צריך לעשות (action_items, owner=customer) לבין מה שהעסק הבטיח (business_commitments).
  כל משימה מופיעה פעם אחת בלבד: משימות/הבטחות של העסק רק ב-business_commitments, ו-action_items רק ללקוח.
- בסיכום לעסק (summary) כתוב/י "הלקוח" בלשון זכר רגילה, בלי לוכסנים.
- ב-customer_message, אם מגדר הלקוח לא ברור: העדף/י ניסוח ניטרלי ("חשוב לשים לב"), ולוכסן רק כשאין ברירה.
- customer_message: עברית טבעית ותקינה, משפטים קצרים, כמו נציג אנושי טוב.
- מונחים מקצועיים: הסבר/י כמו לחבר שלא מבין בתחום. אם מונח מופיע במילון העסק - השתמש/י בהסבר שלו.
- סימני הונאה (בקשת סיסמה/קוד חד-פעמי, לחץ לפעול מיד, העברה לחשבון לא מוכר) - חובה לסמן ב-risk_flags.
- פרטים שהוחלפו ב-[הוסר] / [ת"ז הוסרה] סוננו בכוונה - אל תנסה/י לשחזר אותם.
- התמלול נוצר אוטומטית מהקלטה: ייתכנו שגיאות תמלול, והדוברים מסומנים "דובר 0/1" בלי לדעת מי הנציג ומי הלקוח.
  הסק/י מההקשר מי הנציג (מזדהה בשם העסק, מציע, מבקש פרטים) ומי הלקוח, ותקן/י בשקט שגיאות תמלול ברורות.

Policy Guard (חשוב מאוד):
- השווה/י כל הבטחה, תנאי או טענה של הנציג (מחיר, דמי ביטול, תקופות, כיסוי, החזרים, זכאות) מול תקנון העסק שמצורף.
- השווה/י רק לסעיף שחל על אותו סוג עסקה/שירות שבשיחה (למשל סעיף על הסדרי חוב לא חל על הגדלת מסגרת אשראי).
- אם יש סתירה - הוסף/י ל-policy_conflicts עם ציטוט מדויק משני הצדדים. סמן/י רק סתירה אמיתית, לא ניסוח שונה של אותו דבר.
- אם יש סתירה, הזכר/י אותה גם ב-customer_message בעדינות ("שימ/י לב: לפי התקנון...") כדי שהלקוח לא יופתע.

בקרת ציות (רגולציה):
- לכל בדיקה ברשימת בדיקות הציות שמצורפת: pass / warning / fail, עם ציטוט מדויק מהשיחה כהוכחה (או "לא נאמר בשיחה").
- warning כשהדבר נעשה חלקית או כשיש אי-ודאות (למשל סכום שנאמר בשתי גרסאות). fail כשזה חסר לגמרי.
- אם בדיקה לא רלוונטית לשיחה הזו (למשל לא דובר בכלל על עלויות או על מסירת מידע אישי) - pass עם note "לא רלוונטי בשיחה זו".
- אל תמציא/י דרישות חוק שלא ברשימה.

עדכוני שדות בתיק הלקוח, וכוונה מול עובדה:
- field_updates רק לעובדות שהלקוח מסר או אישר: טלפון/מייל/יישוב חדש, סכום, שינוי פוליסה/מסלול.
- certain=false אם הערך לא חד-משמעי (למשל "400 או 450", "נראה לי", תמלול מבולבל).
- כוונה ("אני שוקל לעבור", "אולי אבטל", "אני אתלונן") אינה עובדה: היא נכנסת ל-customer_intents בלבד,
  ולעולם לא כ-field_update של ביטול/מחיקה/שינוי פוליסה.

התנהלות הנציג (rep_conduct):
- בדוק/י אם הנציג דיבר בצורה מזלזלת, מתנשאת, תוקפנית, מקצינה, או קטע את הלקוח שוב ושוב. צטט/י בדיוק.
- issue=false לשיחה מקצועית רגילה, גם אם הנציג סירב לבקשה או מסר בשורה רעה בנימוס. אל תמציא/י בעיות.
- raises_churn=true רק אם ההתנהלות של הנציג (לא רק הבעיה עצמה) מעלה את הסיכוי לנטישה.

רגש ונטישה:
- emotion_map: רגש הלקוח בפתיחה, באמצע ובסיום, לפי מה שאמר ואיך ניסח (חזרות, שאלות "לא הבנתי", טון חריף), עם הזמן בשיחה.
- rep_recommendation: המלצה קצרה ומעשית לנציג, מנוסחת אליו ("מומלץ ל...").
- churn_risk 0-100: גבוה אם הלקוח כועס/מתוסכל בסוף, איים לעזוב, הבעיה לא נפתרה או קיבל הבטחה סותרת.
- אם הלקוח סיים מבולבל/לחוץ/מתוסכל/כועס: customer_message חייב להיות פשוט במיוחד, קצר, מרגיע, עם צעד אחד ברור בכל שורה.
- customer_message נשלח ללקוח כמו שהוא, בשם העסק: בלי להציע עזרה נוספת, בלי שאלות אליו, ובלי לדבר על "אני" כעוזר AI."""


class AnalysisError(Exception):
    pass


def mode() -> str:
    if all(os.getenv(k) for k in ("AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT")):
        return "azure-openai"
    if os.getenv("ANTHROPIC_FOUNDRY_API_KEY") and os.getenv("ANTHROPIC_FOUNDRY_RESOURCE"):
        return "azure-claude"
    if os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic"
    return "demo"


def model_name() -> str:
    return os.getenv("AZURE_OPENAI_DEPLOYMENT", "") if mode() == "azure-openai" else CLAUDE_MODEL


def _user_content(transcript: str, glossary: dict[str, str], policy: str, call_date: date,
                  compliance: list[str] | None = None) -> str:
    glossary_text = "\n".join(f"- {t}: {e}" for t, e in glossary.items()) or "(ריק)"
    checks = "\n".join(f"- {c}" for c in (compliance or [])) or "(אין)"
    return (
        f"תאריך השיחה: {call_date.isoformat()}\n\n"
        f"רשימת בדיקות הציות של העסק:\n{checks}\n\n"
        f"מילון המונחים של העסק:\n{glossary_text}\n\n"
        f"תקנון / תנאי הפוליסה של העסק (ל-Policy Guard):\n<policy>\n{policy or '(לא הוזן תקנון)'}\n</policy>\n\n"
        f"תמלול השיחה:\n<transcript>\n{transcript}\n</transcript>"
    )


def analyze(transcript: str, glossary: dict[str, str], policy: str = "",
            call_date: date | None = None, compliance: list[str] | None = None) -> CallAnalysis:
    m = mode()
    if m == "demo":
        return _demo_analysis()
    content = _user_content(transcript, glossary, policy, call_date or date.today(), compliance)
    if m == "azure-openai":
        return _analyze_openai(content)
    return _analyze_claude(content, m)


# ---------- Azure OpenAI (GPT) ----------

def _analyze_openai(content: str) -> CallAnalysis:
    import openai
    from openai import AzureOpenAI

    client = AzureOpenAI(
        api_key=os.environ["AZURE_OPENAI_API_KEY"],
        azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
        api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21"),
    )
    try:
        completion = client.chat.completions.parse(
            model=os.environ["AZURE_OPENAI_DEPLOYMENT"],
            messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": content}],
            response_format=CallAnalysis,
        )
    except openai.AuthenticationError as e:
        raise AnalysisError("מפתח Azure OpenAI לא תקין - בדקי את .env") from e
    except openai.NotFoundError as e:
        raise AnalysisError("ה-deployment לא נמצא - בדקי את AZURE_OPENAI_DEPLOYMENT") from e
    except openai.RateLimitError as e:
        raise AnalysisError("יותר מדי בקשות - חכי כמה שניות ונסי שוב") from e
    except openai.APIConnectionError as e:
        raise AnalysisError("אין חיבור ל-Azure OpenAI - בדקי אינטרנט") from e
    except openai.APIStatusError as e:
        raise AnalysisError(f"שגיאה מ-Azure OpenAI ({e.status_code}): {e.message}") from e

    msg = completion.choices[0].message
    if msg.parsed is not None:
        _fix_newlines(msg.parsed)
    if msg.refusal:
        raise AnalysisError(f"המודל סירב לנתח: {msg.refusal}")
    if completion.choices[0].finish_reason == "length" or msg.parsed is None:
        raise AnalysisError("התשובה נחתכה או לא תקינה - נסי שוב")
    return msg.parsed


def _fix_newlines(a: CallAnalysis) -> None:
    """לפעמים המודל כותב '\\n' כטקסט במקום ירידת שורה."""
    a.customer_message = a.customer_message.replace("\\n", "\n")
    a.summary = a.summary.replace("\\n", "\n")


# ---------- Claude (Anthropic / Azure Foundry) ----------

def _analyze_claude(content: str, m: str) -> CallAnalysis:
    import anthropic
    from anthropic import AnthropicFoundry

    if m == "azure-claude":
        client = AnthropicFoundry(api_key=os.environ["ANTHROPIC_FOUNDRY_API_KEY"],
                                  resource=os.environ["ANTHROPIC_FOUNDRY_RESOURCE"])
    else:
        client = anthropic.Anthropic()
    try:
        response = client.messages.parse(
            model=CLAUDE_MODEL,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
            output_format=CallAnalysis,
        )
    except anthropic.AuthenticationError as e:
        raise AnalysisError("המפתח לא תקין - בדקי את קובץ .env") from e
    except anthropic.NotFoundError as e:
        raise AnalysisError(f"המודל '{CLAUDE_MODEL}' לא נמצא - ב-Azure צריך לשים ב-CLAUDE_MODEL את שם ה-deployment") from e
    except anthropic.RateLimitError as e:
        raise AnalysisError("יותר מדי בקשות - חכי כמה שניות ונסי שוב") from e
    except anthropic.APIConnectionError as e:
        raise AnalysisError("אין חיבור לשרת ה-AI - בדקי אינטרנט") from e
    except anthropic.APIStatusError as e:
        raise AnalysisError(f"שגיאה מה-AI ({e.status_code}): {e.message}") from e

    if response.stop_reason == "refusal":
        raise AnalysisError("ה-AI סירב לנתח את השיחה הזו")
    if response.stop_reason == "max_tokens" or response.parsed_output is None:
        raise AnalysisError("התשובה נחתכה או לא תקינה - נסי שוב")
    return response.parsed_output


# ---------- מצב דמו ----------

def _demo_analysis() -> CallAnalysis:
    """תשובה קבועה לדוגמה - כדי לעבוד על הממשק בלי מפתח API."""
    return CallAnalysis.model_validate({
        "speakers": [{"label": "דובר 1", "role": "נציג שירות"}, {"label": "דובר 2", "role": "לקוח"}],
        "customer": {"name": "רחל כהן", "phone": "0521234567", "customer_number": "88214", "email": None},
        "additional_customers": [],
        "next_meeting": {"title": "שיחת אישור פריסה - בנק השרון", "date": None, "time": None,
                         "with_whom": "דני", "location": "שיחה טלפונית"},
        "category": "payment_arrangement",
        "title": "[דמו] פריסת חוב כרטיס אשראי",
        "summary": "[מצב דמו - אין מפתח API] הלקוחה ביקשה לפרוס חוב של 4,800 ₪. סוכם על 12 תשלומים בריבית פריים+2. נדרש טופס חתום ותלוש שכר.",
        "customer_message": "שלום רחל, סיכמנו לפרוס את החוב ל-12 תשלומים.\nמה צריך לעשות: לשלוח עד יום ראשון טופס חתום ותלוש שכר.\nשימי לב: לפי התקנון יש עמלת הסדר של 150 ₪, למרות שנאמר שאין.",
        "action_items": [
            {"description": "לשלוח טופס בקשה לפריסה חתום", "owner": "customer", "category": "documents", "due_date": None},
            {"description": "לצרף תלוש שכר אחרון", "owner": "customer", "category": "documents", "due_date": None},
        ],
        "business_commitments": [
            {"description": "לאשר את הפריסה תוך 3 ימי עסקים מקבלת המסמכים", "owner": "business", "category": "call_back", "due_date": None},
        ],
        "payments": [{"description": "החזר חודשי", "amount": 412.5, "currency": "ILS", "recurring": True}],
        "glossary": [{"term": "ריבית פריים", "explanation": "ריבית בסיס שהבנקים קובעים, שמשתנה לפי בנק ישראל. 'פריים+2' = הריבית הזו ועוד 2%."}],
        "follow_up_needed": False,
        "follow_up_questions": [],
        "risk_flags": [],
        "policy_conflicts": [{
            "rep_statement": "אין עמלה על ההסדר",
            "policy_text": "עמלת הסדר חוב: 150 ₪ לכל הסדר",
            "explanation": "הנציג אמר שאין עמלה, אבל לפי התקנון הלקוחה תחויב ב-150 ₪.",
            "at_risk": "customer", "severity": "high",
        }],
        "emotion_map": [
            {"stage": "opening", "emotion": "stressed", "evidence": "אני לא מצליחה לשלם אותו בבת אחת", "timestamp": "00:04"},
            {"stage": "middle", "emotion": "confused", "evidence": "מה זה פריים פלוס 2?", "timestamp": "00:31"},
            {"stage": "closing", "emotion": "understanding", "evidence": "בסדר, מתאים לי", "timestamp": "00:58"},
        ],
        "customer_end_emotion": "understanding",
        "churn_risk": 35,
        "churn_reason": "הלקוחה בלחץ כלכלי, אבל קיבלה פתרון ויצאה מהשיחה מבינה.",
        "compliance_checks": [
            {"check": "הודעה על הקלטת השיחה", "status": "fail", "evidence": "לא נאמר בשיחה", "note": "הנציג לא הודיע שהשיחה מוקלטת"},
            {"check": "זיהוי לקוח", "status": "pass", "evidence": "אפשר מספר תעודת זהות לזיהוי?", "note": "הלקוחה זוהתה לפני מסירת מידע"},
            {"check": "גילוי נאות על עלויות ועמלות", "status": "warning", "evidence": "אין עמלה על ההסדר", "note": "נאמר שאין עמלה, בניגוד לתקנון"},
            {"check": "אימות סכומים ותאריכים", "status": "pass", "evidence": "יוצא בערך 412 שקל וחצי לחודש", "note": "הסכומים ברורים"},
        ],
        "field_updates": [
            {"field": "phone", "label": "טלפון", "new_value": "0521234567", "certain": True, "evidence": "הטלפון שמעודכן אצלנו 052-1234567, נכון? כן"},
            {"field": "amount", "label": "סכום החזר חודשי", "new_value": "412.5 ₪", "certain": False, "evidence": "יוצא בערך 412 שקל וחצי"},
        ],
        "customer_intents": [],
        "rep_conduct": {"issue": False, "severity": "none", "raises_churn": False, "issues": [], "summary": ""},
        "rep_recommendation": "הלקוחה הבינה את הפריסה, אבל העמלה סותרת את התקנון. מומלץ להבהיר לה בכתב לפני שהיא חותמת.",
        "sentiment": "neutral",
        "status": "pending_customer",
    })

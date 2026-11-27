"""
המבנה שה-AI חייב להחזיר. Claude מקבל את המבנה הזה ומחזיר JSON שתואם אותו בדיוק.
רוצות להוסיף שדה? מוסיפים כאן - וזהו.
"""
from typing import Literal, Optional
from pydantic import BaseModel, Field

CallCategory = Literal[
    "billing",           # חיוב / חשבון
    "payment_arrangement",  # הסדר / פריסת תשלומים
    "technical_support", # תמיכה טכנית
    "complaint",         # תלונה
    "account_change",    # שינוי פרטים / מסלול
    "cancellation",      # ביטול
    "sales",             # מכירה / הצעה
    "appointment",       # קביעת תור
    "information",       # בירור מידע
    "other",
]


class CustomerDetails(BaseModel):
    name: Optional[str] = Field(description="שם הלקוח אם נאמר, אחרת null")
    phone: Optional[str] = Field(description="טלפון הלקוח אם נאמר, ספרות בלבד, אחרת null")
    customer_number: Optional[str] = Field(description="מספר לקוח / חשבון / פוליסה אם נאמר, אחרת null")
    email: Optional[str] = Field(description="כתובת מייל של הלקוח אם נאמרה, אחרת null")


class NextMeeting(BaseModel):
    """הפגישה / שיחת ההמשך הבאה שנקבעה בשיחה."""
    title: str = Field(description="כותרת קצרה לאירוע ביומן, למשל: 'שיחה עם רועי - קרן השתלמות'")
    date: Optional[str] = Field(description="YYYY-MM-DD אם נקבע או נובע מהשיחה, אחרת null")
    time: Optional[str] = Field(description="HH:MM (24 שעות) אם נקבעה שעה, אחרת null")
    with_whom: Optional[str] = Field(description="עם מי הפגישה (שם הנציג/הסוכן/המחלקה), אחרת null")
    location: Optional[str] = Field(description="'שיחה טלפונית', כתובת סניף וכו', אחרת null")


class ActionItem(BaseModel):
    description: str = Field(description="משימה ברורה ומעשית, בגוף שני ללקוח או בגוף שלישי לעסק")
    owner: Literal["customer", "business"]
    category: Literal["appointment", "documents", "payment", "call_back", "visit", "other"]
    due_date: Optional[str] = Field(description="תאריך יעד בפורמט YYYY-MM-DD אם נאמר או נובע מהשיחה, אחרת null")


class Payment(BaseModel):
    description: str
    amount: Optional[float]
    currency: str = Field(description="ILS כברירת מחדל")
    recurring: bool = Field(description="האם תשלום חוזר (חודשי וכו')")


class GlossaryTerm(BaseModel):
    term: str
    explanation: str = Field(description="הסבר פשוט בשפה יומיומית, משפט אחד או שניים")


class RiskFlag(BaseModel):
    description: str
    severity: Literal["low", "medium", "high"]


class PolicyConflict(BaseModel):
    """Policy Guard: הבטחה של הנציג שסותרת את התקנון/הפוליסה של העסק."""
    rep_statement: str = Field(description="ציטוט מדויק של מה שהנציג אמר")
    policy_text: str = Field(description="ציטוט מדויק מהתקנון/הפוליסה שסותר את זה")
    explanation: str = Field(description="הסבר קצר ופשוט: מה הפער ומה המשמעות ללקוח")
    at_risk: Literal["customer", "business"] = Field(
        description="customer = הלקוח עלול להיפגע (למשל ישלם דמי ביטול שלא ציפה להם); business = העסק חשוף לתביעה"
    )
    severity: Literal["low", "medium", "high"]


Emotion = Literal["calm", "understanding", "satisfied", "confused", "stressed", "frustrated", "angry"]


class EmotionPoint(BaseModel):
    stage: Literal["opening", "middle", "closing"]
    emotion: Emotion
    evidence: str = Field(description="ציטוט קצר מהלקוח שמראה את הרגש")
    timestamp: Optional[str] = Field(description="הזמן בשיחה בפורמט MM:SS אם מופיע בתמלול (למשל [00:31]), אחרת null")


class ComplianceCheck(BaseModel):
    """בקרת ציות: בדיקה אחת מרשימת הבדיקות של העסק."""
    check: str = Field(description="שם הבדיקה, בדיוק כפי שמופיע ברשימת בדיקות הציות")
    status: Literal["pass", "warning", "fail"] = Field(
        description="pass = בוצע כנדרש; warning = חלקי / לא ודאי / דורש אימות; fail = לא בוצע / חסר"
    )
    evidence: str = Field(description="ציטוט מדויק מהשיחה שמוכיח את הקביעה, או 'לא נאמר בשיחה' אם חסר")
    note: str = Field(description="משפט קצר: מה תקין / מה חסר / מה צריך לאמת")


class FieldUpdate(BaseModel):
    """עדכון שדה בתיק הלקוח שעולה מהשיחה (עובדה שנמסרה, לא כוונה)."""
    field: Literal["phone", "email", "city", "amount", "policy", "other"] = Field(
        description="phone/email/city = פרטי קשר; amount = סכום (החזר, תשלום, חוב); policy = שינוי פוליסה/מסלול/כיסוי; other = אחר"
    )
    label: str = Field(description="שם השדה בעברית, למשל 'טלפון', 'סכום החזר פיזיותרפיה', 'מסלול ביטוח'")
    new_value: str = Field(description="הערך החדש כפי שנמסר. אם לא ודאי - לכתוב את האפשרויות, למשל '400 או 450 ₪'")
    certain: bool = Field(description="true רק אם הערך נאמר בבירור ובאופן חד-משמעי")
    evidence: str = Field(description="ציטוט מדויק מהשיחה")


class CustomerIntent(BaseModel):
    """כוונה שהלקוח הביע (לא עובדה): שוקל לעזוב, שוקל לבטל, שוקל להתלונן."""
    intent: Literal["churn", "cancel", "complaint", "other"]
    description: str = Field(description="מה הלקוח שוקל, במשפט קצר")
    evidence: str = Field(description="ציטוט מדויק מהשיחה")


class ConductIssue(BaseModel):
    kind: Literal["dismissive", "condescending", "aggressive", "escalating", "interrupting", "other"] = Field(
        description="dismissive = מזלזל/מבטל; condescending = מתנשא; aggressive = תוקפני/צועק; escalating = מקצין/מסלים; interrupting = קוטע שוב ושוב"
    )
    quote: str = Field(description="ציטוט מדויק של הנציג מהתמלול")
    explanation: str = Field(description="משפט קצר: למה זה פוגע בלקוח")


class RepConduct(BaseModel):
    """התנהלות הנציג כלפי הלקוח."""
    issue: bool = Field(description="true רק אם הנציג דיבר בצורה מזלזלת, מתנשאת, תוקפנית או מקצינה כלפי הלקוח")
    severity: Literal["none", "low", "medium", "high"]
    raises_churn: bool = Field(description="true אם ההתנהלות של הנציג מעלה את הסיכוי שהלקוח יעזוב")
    issues: list[ConductIssue] = Field(description="המקרים עם ציטוטים. ריק אם אין בעיה")
    summary: str = Field(description="משפט אחד למנהל/ת: מה קרה ומה ההשפעה על הלקוח. ריק אם אין בעיה")


class SpeakerRole(BaseModel):
    label: str = Field(description="התווית כפי שמופיעה בתמלול, למשל 'דובר 1'")
    role: str = Field(description="תפקיד בשיחה: 'נציג שירות', 'לקוח', 'בן/בת זוג של הלקוח', 'סוכן' וכו'")


class CallAnalysis(BaseModel):
    speakers: list[SpeakerRole] = Field(description="מי כל דובר בתמלול")
    customer: CustomerDetails
    additional_customers: list[CustomerDetails] = Field(
        description="לקוחות נוספים שהשתתפו בשיחה (למשל בני זוג בחשבון משותף, שותפים). ריק אם יש רק לקוח אחד"
    )
    category: CallCategory
    title: str = Field(description="כותרת קצרה לשיחה, עד 8 מילים")
    summary: str = Field(description="סיכום מקצועי לתיק הלקוח אצל העסק, 2-4 משפטים")
    customer_message: str = Field(
        description="הודעה מוכנה לשליחה ללקוח: פנייה אישית, מה סוכם, מה עליו לעשות ומתי. שפה פשוטה וחמה."
    )
    action_items: list[ActionItem] = Field(description="כל מה שמישהו צריך לעשות אחרי השיחה")
    business_commitments: list[ActionItem] = Field(
        description="הבטחות שהעסק/הנציג נתן ללקוח (owner=business), כדי שאפשר יהיה לעקוב שקוימו"
    )
    payments: list[Payment]
    glossary: list[GlossaryTerm] = Field(description="מונחים מקצועיים שהוזכרו והלקוח עלול לא להבין")
    next_meeting: Optional[NextMeeting] = Field(
        description="אם נקבעה פגישה/שיחת המשך/תור - הפרטים שלה. null אם לא נקבע כלום"
    )
    follow_up_needed: bool
    follow_up_questions: list[str] = Field(description="אם צריך שיחת המשך: שאלות שהלקוח כדאי שישאל")
    risk_flags: list[RiskFlag] = Field(
        description="סימני אזהרה: בקשה לסיסמה/קוד, לחץ להעביר כסף מיד, אי-התאמות, הבטחות לא ריאליות"
    )
    policy_conflicts: list[PolicyConflict] = Field(
        description="Policy Guard: כל הבטחה/טענה של הנציג שסותרת את תקנון העסק. רשימה ריקה אם אין סתירה או אין תקנון"
    )
    emotion_map: list[EmotionPoint] = Field(description="רגש הלקוח לאורך השיחה: פתיחה, אמצע, סיום")
    customer_end_emotion: Emotion = Field(description="איך הלקוח הרגיש בסוף השיחה")
    churn_risk: int = Field(description="סיכון נטישה 0-100: עד כמה סביר שהלקוח יעזוב בעקבות השיחה")
    churn_reason: str = Field(description="משפט אחד: למה זה הסיכון")
    compliance_checks: list[ComplianceCheck] = Field(description="תוצאה לכל אחת מבדיקות הציות שברשימה, באותו סדר")
    field_updates: list[FieldUpdate] = Field(
        description="עדכונים לתיק הלקוח שנמסרו כעובדה בשיחה (טלפון חדש, סכום, שינוי פוליסה). לא לכלול כוונות"
    )
    customer_intents: list[CustomerIntent] = Field(
        description="כוונות שהלקוח הביע ('אני שוקל לעבור', 'אולי אבטל'). כוונה אינה עובדה ולא משנה את התיק"
    )
    rep_conduct: RepConduct = Field(description="האם הנציג דיבר בצורה מזלזלת או מקצינה כלפי הלקוח")
    rep_recommendation: str = Field(
        description="המלצה לנציג: 1-2 משפטים מעשיים מה כדאי לעשות עכשיו מול הלקוח, לפי הרגש שלו בסיום והבעיות שנשארו פתוחות"
    )
    sentiment: Literal["positive", "neutral", "negative"]
    status: Literal["resolved", "pending_customer", "pending_business", "needs_follow_up"]

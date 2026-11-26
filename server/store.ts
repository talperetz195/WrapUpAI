import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AuditLogEntry,
  CalendarEvent,
  CallAnalysisReport,
  CustomerRecord,
  PbxRecording,
  SystemNotification,
  TransferJob,
} from './types.ts';
import { hashPasscode, verifyPasscode } from './security.ts';

interface AudioCacheEntry {
  buffer: Buffer;
  mimeType: string;
}

interface PersistedStorePayload {
  claimedOperatorName: string | null;
  claimedPasscodeHash: string | null;
  customers: CustomerRecord[];
  recordings: PbxRecording[];
  transferJobs: TransferJob[];
  reports: CallAnalysisReport[];
  calendarEvents: CalendarEvent[];
  notifications: SystemNotification[];
  auditLogs: AuditLogEntry[];
  audioMeta: Record<string, string>;
}

const DATA_DIR = path.resolve(process.cwd(), '.local-data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

class EnterpriseStore {
  // Operator credentials (env OPERATOR_PASSCODE overrides claimed fallback)
  private claimedOperatorName: string | null = null;
  private claimedPasscodeHash: string | null = null;
  private audioMeta: Record<string, string> = {};

  public customers: CustomerRecord[] = [
    {
      id: 'cust-101',
      fullName: 'דוד מזרחי',
      nationalId: '034892114',
      phone: '052-4418920',
      city: 'תל אביב-יפו',
      branch: 'סניף תל אביב מרכז',
      caseNumber: 'BTL-2026-44102',
      department: 'אבטלה והבטחת הכנסה',
      assignedHandler: 'נועה כהן',
      caseStatus: 'בטיפול פעיל · השלמת אישור מעסיק',
    },
    {
      id: 'cust-102',
      fullName: 'רחל אברהם',
      nationalId: '029174558',
      phone: '054-7120334',
      city: 'חיפה',
      branch: 'סניף חיפה והצפון',
      caseNumber: 'BTL-2026-88910',
      department: 'נכות כללית וועדות רפואיות',
      assignedHandler: 'אופיר לוי',
      caseStatus: 'ממתינה לזימון ועדה רפואית',
    },
    {
      id: 'cust-103',
      fullName: 'יוסף ושרה ברקוביץ׳',
      nationalId: '015663209',
      phone: '050-9831145',
      city: 'ירושלים',
      branch: 'סניף ירושלים מערב',
      caseNumber: 'BTL-2026-19044',
      department: 'אזרחים ותיקים וסיעוד',
      assignedHandler: 'מיכל שפירא',
      caseStatus: 'בבחינת החמרת מצב סיעודי',
    },
    {
      id: 'cust-104',
      fullName: 'אמיר חסון',
      nationalId: '308219442',
      phone: '053-6294001',
      city: 'באר שבע',
      branch: 'סניף באר שבע והנגב',
      caseNumber: 'BTL-2026-67215',
      department: 'ביטוח וגבייה — עצמאים',
      assignedHandler: 'תומר אלון',
      caseStatus: 'הסדר פריסת חובות לבדיקה',
    },
    {
      id: 'cust-105',
      fullName: 'לירון בן-דוד',
      nationalId: '204918337',
      phone: '058-3107721',
      city: 'ראשון לציון',
      branch: 'סניף ראשון לציון',
      caseNumber: 'BTL-2026-53091',
      department: 'נפגעי עבודה',
      assignedHandler: 'נועה כהן',
      caseStatus: 'אימות טופס ב״ל 250 מול מעסיק',
    },
    {
      id: 'cust-106',
      fullName: 'איתי שפירא',
      nationalId: '312045891',
      phone: '052-8813402',
      city: 'רעננה',
      branch: 'סניף כפר סבא והשרון',
      caseNumber: 'BTL-2026-71290',
      department: 'מילואים ותגמולי שירות',
      assignedHandler: 'תומר אלון',
      caseStatus: 'בדיקת הפרשי תגמול מילואים מול מעסיק',
    },
    {
      id: 'cust-107',
      fullName: 'מאיה פרידמן',
      nationalId: '207441982',
      phone: '054-3091188',
      city: 'רמת גן',
      branch: 'סניף רמת גן — בני ברק',
      caseNumber: 'BTL-2026-90432',
      department: 'דמי לידה, אימהות וילדים',
      assignedHandler: 'מיכל שפירא',
      caseStatus: 'השלמת אישור הארכת חופשת לידה',
    },
    {
      id: 'cust-108',
      fullName: 'רון קדמי',
      nationalId: '305198223',
      phone: '050-6642190',
      city: 'אשדוד',
      branch: 'סניף אשדוד והשפלה',
      caseNumber: 'BTL-2026-38814',
      department: 'שיקום מקצועי',
      assignedHandler: 'אופיר לוי',
      caseStatus: 'אישור שכר לימוד ודמי שיקום חודשיים',
    },
  ];

  public recordings: PbxRecording[] = [
    {
      id: 'rec-001',
      uniqueCallName: 'CALL-20261126-0914-MIZRAHI',
      callDate: '2026-11-26T09:14:00+02:00',
      customerId: 'cust-101',
      customerName: 'דוד מזרחי',
      department: 'אבטלה והבטחת הכנסה',
      durationSeconds: 42,
      audioSourceType: 'tts_dialogue',
      mimeType: 'audio/wav',
      status: 'pending_transfer',
      participants: [
        { anonymizedLabel: 'משתתף א׳', role: 'נציגת שירות מוקד', displayName: 'נועה כהן (נציגה)' },
        { anonymizedLabel: 'משתתף ב׳', role: 'מבוטח פונה', displayName: 'דוד מזרחי (לקוח)' },
        { anonymizedLabel: 'משתתף ג׳', role: 'חשבת שכר מטעם המעסיק', displayName: 'רונית גולן (חשבת שכר)' },
      ],
      dialogueScript: [
        {
          speakerLabel: 'משתתף א׳',
          role: 'נציגת שירות מוקד',
          voiceName: 'Kore',
          style: 'Clear, polite Israeli customer service agent',
          text: 'שלום דוד, מדברת נועה ממוקד התגמולים. אני מצרפת לשיחה גם את רונית, חשבת השכר מהחברה שלך, כדי שנוכל להשלים את טופס 1514 לתביעת האבטלה.',
        },
        {
          speakerLabel: 'משתתף ב׳',
          role: 'מבוטח פונה',
          voiceName: 'Puck',
          style: 'Calm, slightly concerned male Israeli caller',
          text: 'תודה נועה. הגשתי את התביעה לפני שבועיים, אבל במערכת מופיע שחסר אישור על ששת חודשי השכר האחרונים. בלי זה המקדמה שלי מתעכבת.',
        },
        {
          speakerLabel: 'משתתף ג׳',
          role: 'חשבת שכר מטעם המעסיק',
          voiceName: 'Zephyr',
          style: 'Professional female payroll accountant',
          text: 'היי נועה ודוד. שלחנו את קובץ השכר הממוחשב כבר אתמול בבוקר, אבל יכול להיות שחסרה חתימה על מועד סיום ההעסקה הרשמי שהיה בשלושים באוקטובר.',
        },
        {
          speakerLabel: 'משתתף א׳',
          role: 'נציגת שירות מוקד',
          voiceName: 'Kore',
          style: 'Helpful, structured service representative',
          text: 'בדקתי עכשיו בתיק ואכן הקובץ הגיע, אבל תאריך הפסקת העבודה חסר. רונית, אבקש שתשלחי היום עד השעה ארבע טופס מתוקן חתום לפורטל המעסיקים.',
        },
        {
          speakerLabel: 'משתתף ב׳',
          role: 'מבוטח פונה',
          voiceName: 'Puck',
          style: 'Relieved male caller asking a follow-up question',
          text: 'וכמה זמן אחרי שהמעסיק שולח את האישור אקבל תשובה על התשלום? יש לי תשלום משכנתא בתחילת החודש.',
        },
        {
          speakerLabel: 'משתתף א׳',
          role: 'נציגת שירות מוקד',
          voiceName: 'Kore',
          style: 'Clear, reassuring institutional agent',
          text: 'ברגע שהטופס ייקלט, אני מסמנת עדיפות לבדיקה מחר בבוקר, ואקבע לך שיחת עדכון ליום ראשון בשעה עשר לוודא שהזכאות אושרה במלואה.',
        },
      ],
    },
    {
      id: 'rec-002',
      uniqueCallName: 'CALL-20261126-1030-AVRAHAM',
      callDate: '2026-11-26T10:30:00+02:00',
      customerId: 'cust-102',
      customerName: 'רחל אברהם',
      department: 'נכות כללית וועדות רפואיות',
      durationSeconds: 46,
      audioSourceType: 'tts_dialogue',
      mimeType: 'audio/wav',
      status: 'pending_transfer',
      participants: [
        { anonymizedLabel: 'משתתף א׳', role: 'רכז תביעות נכות', displayName: 'אופיר לוי (רכז ועדות)' },
        { anonymizedLabel: 'משתתף ב׳', role: 'מבוטחת', displayName: 'רחל אברהם (לקוחה)' },
        { anonymizedLabel: 'משתתף ג׳', role: 'רופאה מלווה מטעם המרפאה', displayName: 'ד״ר יעל דגן (מלווה)' },
      ],
      dialogueScript: [
        {
          speakerLabel: 'משתתף א׳',
          role: 'רכז תביעות נכות',
          voiceName: 'Charon',
          style: 'Empathetic, measured institutional claims officer',
          text: 'בוקר טוב רחל ודוקטור דגן. פנייתכן עברה לבדיקת זימון הוועדה הרפואית בסניף חיפה. רציתי לוודא את כל המסמכים לפני הקביעה.',
        },
        {
          speakerLabel: 'משתתף ב׳',
          role: 'מבוטחת',
          voiceName: 'Kore',
          style: 'Sincere middle-aged Israeli woman',
          text: 'בוקר טוב אופיר. חשוב לי מאוד שהוועדה תכלול גם אורתופד וגם נוירולוג, כי בפעם הקודמת בדק אותי רק רופא פנימאי ופספסו את הבעיה בעמוד השדרה.',
        },
        {
          speakerLabel: 'משתתף ג׳',
          role: 'רופאה מלווה מטעם המרפאה',
          voiceName: 'Zephyr',
          style: 'Articulate clinical physician',
          text: 'אני מצרפת היום סיכום אמ אר איי עדכני מנובמבר וחוות דעת נוירולוגית מפורטת. בנוסף, רחל זקוקה להנגשה ולוועדה בשעות הבוקר בלבד.',
        },
        {
          speakerLabel: 'משתתף א׳',
          role: 'רכז תביעות נכות',
          voiceName: 'Charon',
          style: 'Professional claims officer confirming details',
          text: 'רשמתי בקשה מפורשת להרכב משולב של אורתופד ונוירולוג ולשיבוץ מונגש בשעות הבוקר. אנא העלו את האמ אר איי לתיק עד סוף השבוע כדי שהזימון ייצא כבר לדצמבר.',
        },
      ],
    },
    {
      id: 'rec-003',
      uniqueCallName: 'CALL-20261125-1415-BERKOVICH',
      callDate: '2026-11-25T14:15:00+02:00',
      customerId: 'cust-103',
      customerName: 'יוסף ושרה ברקוביץ׳',
      department: 'אזרחים ותיקים וסיעוד',
      durationSeconds: 38,
      audioSourceType: 'tts_dialogue',
      mimeType: 'audio/wav',
      status: 'report_returned',
      latestJobId: 'JOB-SEED-903',
      reportId: 'RPT-SEED-903',
      participants: [
        { anonymizedLabel: 'משתתף א׳', role: 'נציגת תחום סיעוד', displayName: 'מיכל שפירא (נציגה)' },
        { anonymizedLabel: 'משתתף ב׳', role: 'בת משפחה ומיופת כוח', displayName: 'עדי ברקוביץ׳ (מיופת כוח)' },
      ],
      dialogueScript: [
        {
          speakerLabel: 'משתתף א׳',
          role: 'נציגת תחום סיעוד',
          voiceName: 'Zephyr',
          style: 'Warm, attentive senior care coordinator',
          text: 'שלום עדי, מדברת מיכל ממחלקת סיעוד ירושלים. קיבלנו את הבקשה להגדלת שעות הסיעוד עבור ההורים, יוסף ושרה.',
        },
        {
          speakerLabel: 'משתתף ב׳',
          role: 'בת משפחה ומיופת כוח',
          voiceName: 'Kore',
          style: 'Concerned daughter speaking clearly',
          text: 'שלום מיכל. בחודש האחרון אבא השתחרר מאשפוז ואנחנו צריכים לעבור מדרגה שלוש לדרגה חמש, ובמקביל להמיר חלק מהשעות לגמלה בכסף כדי להעסיק מטפלת קבועה.',
        },
        {
          speakerLabel: 'משתתף א׳',
          role: 'נציגת תחום סיעוד',
          voiceName: 'Zephyr',
          style: 'Clear, structured coordinator',
          text: 'כדי שנוכל לאשר בדיקה מהירה בבית ההורים, אשלח אלייך כעת טופס בחירת גמלה בכסף ונשלח מעריכה מטעמנו לביקור בית בשבוע הבא בימים שלישי או רביעי.',
        },
      ],
    },
    {
      id: 'rec-004',
      uniqueCallName: 'CALL-20261125-1105-HASSON',
      callDate: '2026-11-25T11:05:00+02:00',
      customerId: 'cust-104',
      customerName: 'אמיר חסון',
      department: 'ביטוח וגבייה — עצמאים',
      durationSeconds: 40,
      audioSourceType: 'tts_dialogue',
      mimeType: 'audio/wav',
      status: 'report_returned',
      latestJobId: 'JOB-SEED-904',
      reportId: 'RPT-SEED-904',
      participants: [
        { anonymizedLabel: 'משתתף א׳', role: 'נציג מחלקת גבייה', displayName: 'תומר אלון (רכז גבייה)' },
        { anonymizedLabel: 'משתתף ב׳', role: 'עצמאי מבוטח', displayName: 'אמיר חסון (לקוח)' },
        { anonymizedLabel: 'משתתף ג׳', role: 'רואה חשבון מייצג', displayName: 'גיל ממן (רו״ח)' },
      ],
      dialogueScript: [
        {
          speakerLabel: 'משתתף א׳',
          role: 'נציג מחלקת גבייה',
          voiceName: 'Fenrir',
          style: 'Crisp, authoritative collections specialist',
          text: 'שלום אמיר ורואה החשבון גיל. אנחנו על הקו לגבי הפרשי השומה לשנת המס הקודמת והבקשה להפחתת מקדמות.',
        },
        {
          speakerLabel: 'משתתף ב׳',
          role: 'עצמאי מבוטח',
          voiceName: 'Puck',
          style: 'Direct business owner',
          text: 'העסק שלי בדרום עבר ירידה של ארבעים אחוז בהכנסות ברבעון האחרון, והמקדמות החודשיות חונקות לי את התזרים. אני מבקש לפרוס את החוב ולהתאים מקדמות.',
        },
        {
          speakerLabel: 'משתתף ג׳',
          role: 'רואה חשבון מייצג',
          voiceName: 'Charon',
          style: 'Precise CPA accountant',
          text: 'הפקתי היום דו״ח רווח והפסד חתום לחודשים ינואר עד אוקטובר, ואני מבקש לעצור את העיקול הזמני עד לקליטת הדו״ח והפחתת המקדמה.',
        },
        {
          speakerLabel: 'משתתף א׳',
          role: 'נציג מחלקת גבייה',
          voiceName: 'Fenrir',
          style: 'Constructive financial officer',
          text: 'מאושרת הקפאת הליכי אכיפה לארבעה עשר יום. גיל, תעלה את הדו״ח החתום היום, ואני אכין הסדר תשלומים של שנים עשר תשלומים ללא קנסות לחתימת אמיר.',
        },
      ],
    },
    {
      id: 'rec-005',
      uniqueCallName: 'CALL-20261124-1620-BENDAVID',
      callDate: '2026-11-24T16:20:00+02:00',
      customerId: 'cust-105',
      customerName: 'לירון בן-דוד',
      department: 'נפגעי עבודה',
      durationSeconds: 36,
      audioSourceType: 'tts_dialogue',
      mimeType: 'audio/wav',
      status: 'report_returned',
      latestJobId: 'JOB-SEED-905',
      reportId: 'RPT-SEED-905',
      participants: [
        { anonymizedLabel: 'משתתף א׳', role: 'נציגת תביעות פגיעה בעבודה', displayName: 'נועה כהן (נציגה)' },
        { anonymizedLabel: 'משתתף ב׳', role: 'עובדת נפגעת', displayName: 'לירון בן-דוד (לקוחה)' },
      ],
      dialogueScript: [
        {
          speakerLabel: 'משתתף א׳',
          role: 'נציגת תביעות פגיעה בעבודה',
          voiceName: 'Kore',
          style: 'Supportive, clear claims representative',
          text: 'שלום לירון, כאן נועה ממחלקת נפגעי עבודה. ראיתי שפתחת תביעה לדמי פגיעה בעקבות התאונה במחסן הלוגיסטי.',
        },
        {
          speakerLabel: 'משתתף ב׳',
          role: 'עובדת נפגעת',
          voiceName: 'Zephyr',
          style: 'Polite female employee',
          text: 'כן, יש לי תעודת אי כושר ראשונה לשלושה שבועות מבית החולים, אבל המעסיק עוד לא מסר לי את טופס ב״ל מאתיים וחמישים החתום.',
        },
        {
          speakerLabel: 'משתתף א׳',
          role: 'נציגת תביעות פגיעה בעבודה',
          voiceName: 'Kore',
          style: 'Efficient, helpful representative',
          text: 'אנחנו יכולים לפנות ישירות למעסיק בדרישה לטופס, ובמקביל תקפידי להעלות את דו״ח חדר המיון והמרשמים הרפואיים כדי שלא יתעכב תשלום דמי הפגיעה.',
        },
      ],
    },
    {
      id: 'rec-006',
      uniqueCallName: 'CALL-20261124-1210-SHAPIRA',
      callDate: '2026-11-24T12:10:00+02:00',
      customerId: 'cust-106',
      customerName: 'איתי שפירא',
      department: 'מילואים ותגמולי שירות',
      durationSeconds: 34,
      audioSourceType: 'tts_dialogue',
      mimeType: 'audio/wav',
      status: 'report_returned',
      latestJobId: 'JOB-SEED-906',
      reportId: 'RPT-SEED-906',
      participants: [
        { anonymizedLabel: 'משתתף א׳', role: 'רכז תגמולי מילואים', displayName: 'תומר אלון (רכז מילואים)' },
        { anonymizedLabel: 'משתתף ב׳', role: 'משרת מילואים', displayName: 'איתי שפירא (לקוח)' },
        { anonymizedLabel: 'משתתף ג׳', role: 'נציגת משאבי אנוש מעסיק', displayName: 'שני אברמוב (מש״א)' },
      ],
      dialogueScript: [
        {
          speakerLabel: 'משתתף א׳',
          role: 'רכז תגמולי מילואים',
          voiceName: 'Fenrir',
          style: 'Clear, structured benefits officer',
          text: 'שלום איתי ושני. אנחנו עוברים יחד על תקופת המילואים של ארבעים וחמישה ימים לצורך חישוב הפרשי השכר.',
        },
        {
          speakerLabel: 'משתתף ב׳',
          role: 'משרת מילואים',
          voiceName: 'Puck',
          style: 'Direct reservist caller',
          text: 'המעסיק שילם לי שכר בסיס, אבל קיבלתי גם בונוס רבעוני לפני הגיוס שלא נכלל בחישוב התגמול.',
        },
        {
          speakerLabel: 'משתתף ג׳',
          role: 'נציגת משאבי אנוש מעסיק',
          voiceName: 'Zephyr',
          style: 'Cooperative HR specialist',
          text: 'אני מעלה היום טופס 3010 מעודכן עם פירוט השכר לשלושת החודשים שקדמו לשירות כדי שיועבר ההפרש ישירות לחשבון.',
        },
      ],
    },
    {
      id: 'rec-007',
      uniqueCallName: 'CALL-20261123-1540-FRIEDMAN',
      callDate: '2026-11-23T15:40:00+02:00',
      customerId: 'cust-107',
      customerName: 'מאיה פרידמן',
      department: 'דמי לידה, אימהות וילדים',
      durationSeconds: 32,
      audioSourceType: 'tts_dialogue',
      mimeType: 'audio/wav',
      status: 'report_returned',
      latestJobId: 'JOB-SEED-907',
      reportId: 'RPT-SEED-907',
      participants: [
        { anonymizedLabel: 'משתתף א׳', role: 'נציגת מחלקת אימהות', displayName: 'מיכל שפירא (נציגה)' },
        { anonymizedLabel: 'משתתף ב׳', role: 'יולדת מבוטחת', displayName: 'מאיה פרידמן (לקוחה)' },
      ],
      dialogueScript: [
        {
          speakerLabel: 'משתתף א׳',
          role: 'נציגת מחלקת אימהות',
          voiceName: 'Kore',
          style: 'Warm, reassuring maternity coordinator',
          text: 'שלום מאיה, כאן מיכל ממחלקת אימהות. בדקנו את הבקשה להארכת דמי הלידה בעקבות אשפוז הפגייה.',
        },
        {
          speakerLabel: 'משתתף ב׳',
          role: 'יולדת מבוטחת',
          voiceName: 'Zephyr',
          style: 'Polite new mother',
          text: 'תודה מיכל. התינוק היה מאושפז שלושה שבועות, וצירפתי את סיכום השחרור מבית החולים.',
        },
      ],
    },
    {
      id: 'rec-008',
      uniqueCallName: 'CALL-20261126-1145-KEDMI',
      callDate: '2026-11-26T11:45:00+02:00',
      customerId: 'cust-108',
      customerName: 'רון קדמי',
      department: 'שיקום מקצועי',
      durationSeconds: 38,
      audioSourceType: 'tts_dialogue',
      mimeType: 'audio/wav',
      status: 'pending_transfer',
      participants: [
        { anonymizedLabel: 'משתתף א׳', role: 'עובדת שיקום', displayName: 'אופיר לוי (רכז שיקום)' },
        { anonymizedLabel: 'משתתף ב׳', role: 'משתקם', displayName: 'רון קדמי (לקוח)' },
        { anonymizedLabel: 'משתתף ג׳', role: 'יועץ לימודים מכללה', displayName: 'אורי ברק (מכללה טכנולוגית)' },
      ],
      dialogueScript: [
        {
          speakerLabel: 'משתתף א׳',
          role: 'עובדת שיקום',
          voiceName: 'Charon',
          style: 'Supportive rehabilitation counselor',
          text: 'שלום רון ואורי. אנחנו מתאמים היום את תכנית הלימודים להנדסאי תוכנה במסגרת השיקום המקצועי באשדוד.',
        },
        {
          speakerLabel: 'משתתף ב׳',
          role: 'משתקם',
          voiceName: 'Puck',
          style: 'Motivated student caller',
          text: 'אני מתחיל בשבוע הבא לימודים מלאים של עשרים וחמש שעות שבועיות וחשוב לי שדמי השיקום והנסיעות ייכנסו בזמן.',
        },
        {
          speakerLabel: 'משתתף ג׳',
          role: 'יועץ לימודים מכללה',
          voiceName: 'Fenrir',
          style: 'Clear academic advisor',
          text: 'שלחתי למחלקת השיקום את מערכת השעות החתומה ואת שובר שכר הלימוד השנתי לאישור ישיר מול המוסד.',
        },
      ],
    },
  ];

  private audioCache = new Map<string, AudioCacheEntry>();
  public transferJobs: TransferJob[] = [
    {
      jobId: 'JOB-SEED-903',
      recordingId: 'rec-003',
      uniqueCallName: 'CALL-20261125-1415-BERKOVICH',
      customerId: 'cust-103',
      initiatedBy: 'נועה כהן — מנהלת מוקד',
      initiatedAt: '2026-11-25T14:22:00+02:00',
      completedAt: '2026-11-25T14:22:18+02:00',
      stage: 'completed_and_purged',
      audioPurged: true,
      reportId: 'RPT-SEED-903',
      maskedPayload: {
        jobId: 'JOB-SEED-903',
        uniqueCallName: 'CALL-20261125-1415-BERKOVICH',
        callDate: '2026-11-25T14:15:00+02:00',
        anonymizedParticipants: [
          { anonymizedLabel: 'משתתף א׳', role: 'נציגת תחום סיעוד' },
          { anonymizedLabel: 'משתתף ב׳', role: 'בת משפחה ומיופת כוח' },
        ],
        piiStrippedFields: ['customerName', 'nationalId', 'phone', 'city', 'branch', 'caseNumber', 'crmHistory'],
        tokenScope: 'audio_transcribe_only',
        tokenExpiresAt: '2026-11-25T14:24:00+02:00',
      },
    },
    {
      jobId: 'JOB-SEED-904',
      recordingId: 'rec-004',
      uniqueCallName: 'CALL-20261125-1105-HASSON',
      customerId: 'cust-104',
      initiatedBy: 'נועה כהן — מנהלת מוקד',
      initiatedAt: '2026-11-25T11:18:00+02:00',
      completedAt: '2026-11-25T11:18:22+02:00',
      stage: 'completed_and_purged',
      audioPurged: true,
      reportId: 'RPT-SEED-904',
      maskedPayload: {
        jobId: 'JOB-SEED-904',
        uniqueCallName: 'CALL-20261125-1105-HASSON',
        callDate: '2026-11-25T11:05:00+02:00',
        anonymizedParticipants: [
          { anonymizedLabel: 'משתתף א׳', role: 'נציג מחלקת גבייה' },
          { anonymizedLabel: 'משתתף ב׳', role: 'עצמאי מבוטח' },
          { anonymizedLabel: 'משתתף ג׳', role: 'רואה חשבון מייצג' },
        ],
        piiStrippedFields: ['customerName', 'nationalId', 'phone', 'city', 'branch', 'caseNumber', 'crmHistory'],
        tokenScope: 'audio_transcribe_only',
        tokenExpiresAt: '2026-11-25T11:20:00+02:00',
      },
    },
    {
      jobId: 'JOB-SEED-905',
      recordingId: 'rec-005',
      uniqueCallName: 'CALL-20261124-1620-BENDAVID',
      customerId: 'cust-105',
      initiatedBy: 'נועה כהן — מנהלת מוקד',
      initiatedAt: '2026-11-24T16:35:00+02:00',
      completedAt: '2026-11-24T16:35:15+02:00',
      stage: 'completed_and_purged',
      audioPurged: true,
      reportId: 'RPT-SEED-905',
      maskedPayload: {
        jobId: 'JOB-SEED-905',
        uniqueCallName: 'CALL-20261124-1620-BENDAVID',
        callDate: '2026-11-24T16:20:00+02:00',
        anonymizedParticipants: [
          { anonymizedLabel: 'משתתף א׳', role: 'נציגת תביעות פגיעה בעבודה' },
          { anonymizedLabel: 'משתתף ב׳', role: 'עובדת נפגעת' },
        ],
        piiStrippedFields: ['customerName', 'nationalId', 'phone', 'city', 'branch', 'caseNumber', 'crmHistory'],
        tokenScope: 'audio_transcribe_only',
        tokenExpiresAt: '2026-11-24T16:37:00+02:00',
      },
    },
    {
      jobId: 'JOB-SEED-906',
      recordingId: 'rec-006',
      uniqueCallName: 'CALL-20261124-1210-SHAPIRA',
      customerId: 'cust-106',
      initiatedBy: 'נועה כהן — מנהלת מוקד',
      initiatedAt: '2026-11-24T12:15:00+02:00',
      completedAt: '2026-11-24T12:15:19+02:00',
      stage: 'completed_and_purged',
      audioPurged: true,
      reportId: 'RPT-SEED-906',
      maskedPayload: {
        jobId: 'JOB-SEED-906',
        uniqueCallName: 'CALL-20261124-1210-SHAPIRA',
        callDate: '2026-11-24T12:10:00+02:00',
        anonymizedParticipants: [
          { anonymizedLabel: 'משתתף א׳', role: 'רכז תגמולי מילואים' },
          { anonymizedLabel: 'משתתף ב׳', role: 'משרת מילואים' },
          { anonymizedLabel: 'משתתף ג׳', role: 'נציגת משאבי אנוש מעסיק' },
        ],
        piiStrippedFields: ['customerName', 'nationalId', 'phone', 'city', 'branch', 'caseNumber', 'crmHistory'],
        tokenScope: 'audio_transcribe_only',
        tokenExpiresAt: '2026-11-24T12:17:00+02:00',
      },
    },
    {
      jobId: 'JOB-SEED-907',
      recordingId: 'rec-007',
      uniqueCallName: 'CALL-20261123-1540-FRIEDMAN',
      customerId: 'cust-107',
      initiatedBy: 'נועה כהן — מנהלת מוקד',
      initiatedAt: '2026-11-23T15:46:00+02:00',
      completedAt: '2026-11-23T15:46:14+02:00',
      stage: 'completed_and_purged',
      audioPurged: true,
      reportId: 'RPT-SEED-907',
      maskedPayload: {
        jobId: 'JOB-SEED-907',
        uniqueCallName: 'CALL-20261123-1540-FRIEDMAN',
        callDate: '2026-11-23T15:40:00+02:00',
        anonymizedParticipants: [
          { anonymizedLabel: 'משתתף א׳', role: 'נציגת מחלקת אימהות' },
          { anonymizedLabel: 'משתתף ב׳', role: 'יולדת מבוטחת' },
        ],
        piiStrippedFields: ['customerName', 'nationalId', 'phone', 'city', 'branch', 'caseNumber', 'crmHistory'],
        tokenScope: 'audio_transcribe_only',
        tokenExpiresAt: '2026-11-23T15:48:00+02:00',
      },
    },
  ];

  public reports: CallAnalysisReport[] = [
    {
      id: 'RPT-SEED-903',
      jobId: 'JOB-SEED-903',
      recordingId: 'rec-003',
      uniqueCallName: 'CALL-20261125-1415-BERKOVICH',
      customerId: 'cust-103',
      customerName: 'יוסף ושרה ברקוביץ׳',
      generatedAt: '2026-11-25T14:22:18+02:00',
      returnedAt: '2026-11-25T14:22:18+02:00',
      signatureVerified: true,
      executiveSummary:
        'שיחת תיאום סיעוד עם בת המשפחה ומיופת הכוח בעקבות שחרור מאשפוז. סוכם על קידום בדיקת החמרת מצב מדרגה 3 לדרגה 5, שליחת טופס המרת שעות לגמלה בכסף ותיאום ביקור מעריכה בבית ההורים בשבוע הבא.',
      participantsDetected: [
        { speakerLabel: 'משתתף א׳', role: 'נציגת תחום סיעוד' },
        { speakerLabel: 'משתתף ב׳', role: 'בת משפחה ומיופת כוח' },
      ],
      topics: [
        {
          topicTitle: 'החמרת מצב סיעודי והעלאת דרגה',
          topicSummary: 'בחינת מעבר מדרגת סיעוד 3 לדרגה 5 לאחר אשפוז אחרון של האב.',
          participantStatements: [
            {
              speakerLabel: 'משתתף ב׳',
              role: 'בת משפחה ומיופת כוח',
              statementSummary: 'עדכנה כי לאחר השחרור מאשפוז חלה ירידה תפקודית ונדרשת העלאה לדרגה 5.',
              keyPoints: ['שחרור מאשפוז בחודש האחרון', 'בקשה לבחינת החמרת מצב דחופה'],
            },
            {
              speakerLabel: 'משתתף א׳',
              role: 'נציגת תחום סיעוד',
              statementSummary: 'אישרה את קליטת הבקשה והתחייבה לשיבוץ ביקור מעריכה מהיר בבית ההורים.',
              keyPoints: ['הפניה להערכה מחודשת בבית', 'תיאום לשבוע הקרוב בימים ג׳ או ד׳'],
            },
          ],
        },
        {
          topicTitle: 'המרת שעות סיעוד לגמלה בכסף',
          topicSummary: 'הסדרת טפסים להמרת חלק משעות הטיפול לצורך העסקת מטפלת קבועה.',
          participantStatements: [
            {
              speakerLabel: 'משתתף ב׳',
              role: 'בת משפחה ומיופת כוח',
              statementSummary: 'ביקשה לקבל חלק מהגמלה בכסף כדי לממן מטפלת צמודה.',
              keyPoints: ['העסקת מטפלת קבועה בבית'],
            },
            {
              speakerLabel: 'משתתף א׳',
              role: 'נציגת תחום סיעוד',
              statementSummary: 'שלחה את טופס הבחירה לגמלה בכסף והנחתה להחזירו חתום טרם ביקור המעריכה.',
              keyPoints: ['משלוח טופס בחירת גמלה בכסף', 'קליטה מיידית עם החזרת החתימה'],
            },
          ],
        },
      ],
      actionItems: [
        {
          taskId: 'TASK-903-1',
          title: 'תיאום ביקור בית של מעריכת סיעוד (ירושלים)',
          description: 'שיבוץ מעריכה מטעם המוסד לביקור בית לבחינת מעבר לדרגה 5.',
          owner: 'מיכל שפירא',
          priority: 'דחופה',
          category: 'תיאום פגישה',
          suggestedDate: '2026-12-01',
          suggestedTime: '10:30',
          addedToCalendar: false,
        },
        {
          taskId: 'TASK-903-2',
          title: 'מעקב קליטת טופס בחירת גמלה בכסף',
          description: 'וידוא החזרת טופס חתום ממיופת הכוח והזנת המרת השעות במערכת הגמלאות.',
          owner: 'מיכל שפירא',
          priority: 'גבוהה',
          category: 'מסמכים',
          suggestedDate: '2026-11-29',
          suggestedTime: '09:30',
          addedToCalendar: false,
        },
      ],
      transcript: [
        {
          timestamp: '00:00',
          speakerLabel: 'משתתף א׳',
          role: 'נציגת תחום סיעוד',
          text: 'שלום עדי, מדברת מיכל ממחלקת סיעוד ירושלים. קיבלנו את הבקשה להגדלת שעות הסיעוד עבור ההורים, יוסף ושרה.',
        },
        {
          timestamp: '00:12',
          speakerLabel: 'משתתף ב׳',
          role: 'בת משפחה ומיופת כוח',
          text: 'שלום מיכל. בחודש האחרון אבא השתחרר מאשפוז ואנחנו צריכים לעבור מדרגה שלוש לדרגה חמש, ובמקביל להמיר חלק מהשעות לגמלה בכסף כדי להעסיק מטפלת קבועה.',
        },
        {
          timestamp: '00:26',
          speakerLabel: 'משתתף א׳',
          role: 'נציגת תחום סיעוד',
          text: 'כדי שנוכל לאשר בדיקה מהירה בבית ההורים, אשלח אלייך כעת טופס בחירת גמלה בכסף ונשלח מעריכה מטעמנו לביקור בית בשבוע הבא בימים שלישי או רביעי.',
        },
      ],
    },
    {
      id: 'RPT-SEED-904',
      jobId: 'JOB-SEED-904',
      recordingId: 'rec-004',
      uniqueCallName: 'CALL-20261125-1105-HASSON',
      customerId: 'cust-104',
      customerName: 'אמיר חסון',
      generatedAt: '2026-11-25T11:18:22+02:00',
      returnedAt: '2026-11-25T11:18:22+02:00',
      signatureVerified: true,
      executiveSummary:
        'שיחת ועידה בין נציג הגבייה, המבוטח העצמאי ורואה החשבון המייצג בנושא הפרשי שומה והקלת תזרים. הוסכם על הקפאת הליכי אכיפה ל-14 יום, קליטת דו״ח רווח והפסד עדכני להפחתת מקדמות והכנת פריסת חוב ל-12 תשלומים ללא קנסות.',
      participantsDetected: [
        { speakerLabel: 'משתתף א׳', role: 'נציג מחלקת גבייה' },
        { speakerLabel: 'משתתף ב׳', role: 'עצמאי מבוטח' },
        { speakerLabel: 'משתתף ג׳', role: 'רואה חשבון מייצג' },
      ],
      topics: [
        {
          topicTitle: 'ירידה בהכנסות והפחתת מקדמות חודשיות',
          topicSummary: 'עדכון מקדמות דמי הביטוח בעקבות ירידה של 40% במחזור העסק ברבעון האחרון.',
          participantStatements: [
            {
              speakerLabel: 'משתתף ב׳',
              role: 'עצמאי מבוטח',
              statementSummary: 'הסביר כי ההכנסות ירדו ב-40% והמקדמות הנוכחיות מכבידות על התזרים.',
              keyPoints: ['ירידת הכנסות ב-40% בדרום', 'בקשה להתאמת גובה המקדמה'],
            },
            {
              speakerLabel: 'משתתף ג׳',
              role: 'רואה חשבון מייצג',
              statementSummary: 'דיווח כי הפיק דו״ח רווח והפסד חתום לינואר–אוקטובר לצורך עדכון השומה.',
              keyPoints: ['דו״ח רוו״ה חתום מוכן להגשה מיידית'],
            },
            {
              speakerLabel: 'משתתף א׳',
              role: 'נציג מחלקת גבייה',
              statementSummary: 'אישר קליטת הדו״ח החתום היום לצורך חישוב מחדש והפחתת מקדמות.',
              keyPoints: ['חישוב מקדמה מעודכנת עם קליטת הדו״ח'],
            },
          ],
        },
        {
          topicTitle: 'הקפאת עיקול והסדר פריסת חובות',
          topicSummary: 'עצירת הליכי אכיפה זמניים ובניית הסדר תשלומים של 12 חודשים.',
          participantStatements: [
            {
              speakerLabel: 'משתתף ג׳',
              role: 'רואה חשבון מייצג',
              statementSummary: 'ביקש לעצור את העיקול הזמני עד לסיום עדכון המקדמות.',
              keyPoints: ['בקשת עצירת אכיפה דחופה'],
            },
            {
              speakerLabel: 'משתתף א׳',
              role: 'נציג מחלקת גבייה',
              statementSummary: 'אישר הקפאת אכיפה ל-14 יום והנפקת הסדר של 12 תשלומים ללא קנסות.',
              keyPoints: ['הקפאה ל-14 ימים', '12 תשלומים ללא קנסות פיגורים'],
            },
          ],
        },
      ],
      actionItems: [
        {
          taskId: 'TASK-904-1',
          title: 'קליטת דו״ח רווח והפסד ועדכון מקדמות עצמאי',
          description: 'בדיקת הדו״ח החתום שהוגש על ידי רו״ח גיל ממן והזנת שיעור מקדמה מופחת.',
          owner: 'תומר אלון',
          priority: 'דחופה',
          category: 'תשלום וגבייה',
          suggestedDate: '2026-11-27',
          suggestedTime: '11:00',
          addedToCalendar: false,
        },
        {
          taskId: 'TASK-904-2',
          title: 'הפקת הסדר 12 תשלומים ושליחה לחתימת הלקוח',
          description: 'הנפקת הסדר פריסה ללא קנסות ומעקב חתימה טרם תום הקפאת האכיפה ל-14 יום.',
          owner: 'תומר אלון',
          priority: 'גבוהה',
          category: 'תשלום וגבייה',
          suggestedDate: '2026-12-08',
          suggestedTime: '14:00',
          addedToCalendar: false,
        },
      ],
      transcript: [
        {
          timestamp: '00:00',
          speakerLabel: 'משתתף א׳',
          role: 'נציג מחלקת גבייה',
          text: 'שלום אמיר ורואה החשבון גיל. אנחנו על הקו לגבי הפרשי השומה לשנת המס הקודמת והבקשה להפחתת מקדמות.',
        },
        {
          timestamp: '00:10',
          speakerLabel: 'משתתף ב׳',
          role: 'עצמאי מבוטח',
          text: 'העסק שלי בדרום עבר ירידה של ארבעים אחוז בהכנסות ברבעון האחרון, והמקדמות החודשיות חונקות לי את התזרים. אני מבקש לפרוס את החוב ולהתאים מקדמות.',
        },
        {
          timestamp: '00:22',
          speakerLabel: 'משתתף ג׳',
          role: 'רואה חשבון מייצג',
          text: 'הפקתי היום דו״ח רווח והפסד חתום לחודשים ינואר עד אוקטובר, ואני מבקש לעצור את העיקול הזמני עד לקליטת הדו״ח והפחתת המקדמה.',
        },
        {
          timestamp: '00:31',
          speakerLabel: 'משתתף א׳',
          role: 'נציג מחלקת גבייה',
          text: 'מאושרת הקפאת הליכי אכיפה לארבעה עשר יום. גיל, תעלה את הדו״ח החתום היום, ואני אכין הסדר תשלומים של שנים עשר תשלומים ללא קנסות לחתימת אמיר.',
        },
      ],
    },
    {
      id: 'RPT-SEED-905',
      jobId: 'JOB-SEED-905',
      recordingId: 'rec-005',
      uniqueCallName: 'CALL-20261124-1620-BENDAVID',
      customerId: 'cust-105',
      customerName: 'לירון בן-דוד',
      generatedAt: '2026-11-24T16:35:15+02:00',
      returnedAt: '2026-11-24T16:35:15+02:00',
      signatureVerified: true,
      executiveSummary:
        'בירור השלמת מסמכים לתביעת דמי פגיעה בעבודה בעקבות תאונה במחסן לוגיסטי. המוסד יפנה ישירות למעסיק לדרישת טופס ב״ל 250 חתום, והמבוטחת תצרף דו״ח חדר מיון ומרשמים רפואיים.',
      participantsDetected: [
        { speakerLabel: 'משתתף א׳', role: 'נציגת תביעות פגיעה בעבודה' },
        { speakerLabel: 'משתתף ב׳', role: 'עובדת נפגעת' },
      ],
      topics: [
        {
          topicTitle: 'השגת טופס ב״ל 250 מהמעסיק',
          topicSummary: 'התמודדות עם עיכוב המעסיק במסירת אישור הפגיעה בעבודה.',
          participantStatements: [
            {
              speakerLabel: 'משתתף ב׳',
              role: 'עובדת נפגעת',
              statementSummary: 'מסרה כי ברשותה תעודת אי-כושר לשלושה שבועות אך המעסיק טרם מסר טופס ב״ל 250.',
              keyPoints: ['תעודת אי-כושר ל-21 יום זמינה', 'עיכוב מצד המעסיק בטופס 250'],
            },
            {
              speakerLabel: 'משתתף א׳',
              role: 'נציגת תביעות פגיעה בעבודה',
              statementSummary: 'הבהירה כי המוסד יוציא פנייה רשמית ישירה למעסיק לקבלת הטופס.',
              keyPoints: ['פנייה יזומה של המוקד למעסיק'],
            },
          ],
        },
        {
          topicTitle: 'מסמכים רפואיים להשלמת תשלום דמי פגיעה',
          topicSummary: 'דרישת צירוף דו״ח מיון ומרשמים כדי למנוע עיכוב בתשלום.',
          participantStatements: [
            {
              speakerLabel: 'משתתף א׳',
              role: 'נציגת תביעות פגיעה בעבודה',
              statementSummary: 'ביקשה מהעובדת להעלות דו״ח חדר מיון ומרשמים רפואיים לפורטל האישי.',
              keyPoints: ['העלאת דו״ח מיון', 'העלאת מרשמים רפואיים'],
            },
          ],
        },
      ],
      actionItems: [
        {
          taskId: 'TASK-905-1',
          title: 'משלוח דרישה רשמית למעסיק לטופס ב״ל 250',
          description: 'הפקת מכתב דרישה ממחלקת נפגעי עבודה למעסיק לצורך אישור נסיבות הפגיעה.',
          owner: 'נועה כהן',
          priority: 'גבוהה',
          category: 'מסמכים',
          suggestedDate: '2026-11-28',
          suggestedTime: '09:00',
          addedToCalendar: false,
        },
        {
          taskId: 'TASK-905-2',
          title: 'בדיקת קליטת דו״ח מיון ואישור תשלום דמי פגיעה',
          description: 'וידוא העלאת מסמכי בית החולים על ידי המבוטחת והעברה לחישוב תשלום.',
          owner: 'נועה כהן',
          priority: 'רגילה',
          category: 'תשלום וגבייה',
          suggestedDate: '2026-12-02',
          suggestedTime: '13:00',
          addedToCalendar: false,
        },
      ],
      transcript: [
        {
          timestamp: '00:00',
          speakerLabel: 'משתתף א׳',
          role: 'נציגת תביעות פגיעה בעבודה',
          text: 'שלום לירון, כאן נועה ממחלקת נפגעי עבודה. ראיתי שפתחת תביעה לדמי פגיעה בעקבות התאונה במחסן הלוגיסטי.',
        },
        {
          timestamp: '00:11',
          speakerLabel: 'משתתף ב׳',
          role: 'עובדת נפגעת',
          text: 'כן, יש לי תעודת אי כושר ראשונה לשלושה שבועות מבית החולים, אבל המעסיק עוד לא מסר לי את טופס ב״ל מאתיים וחמישים החתום.',
        },
        {
          timestamp: '00:24',
          speakerLabel: 'משתתף א׳',
          role: 'נציגת תביעות פגיעה בעבודה',
          text: 'אנחנו יכולים לפנות ישירות למעסיק בדרישה לטופס, ובמקביל תקפידי להעלות את דו״ח חדר המיון והמרשמים הרפואיים כדי שלא יתעכב תשלום דמי הפגיעה.',
        },
      ],
    },
    {
      id: 'RPT-SEED-906',
      jobId: 'JOB-SEED-906',
      recordingId: 'rec-006',
      uniqueCallName: 'CALL-20261124-1210-SHAPIRA',
      customerId: 'cust-106',
      customerName: 'איתי שפירא',
      generatedAt: '2026-11-24T12:15:19+02:00',
      returnedAt: '2026-11-24T12:15:19+02:00',
      signatureVerified: true,
      executiveSummary:
        'שיחת ועידה בנושא חישוב הפרשי תגמול מילואים לתקופה של 45 ימים. סוכם כי נציגת משאבי האנוש תעלה טופס 3010 מעודכן הכולל בונוס רבעוני, ולאחר קליטתו יחושב וישולם ההפרש ישירות למבוטח.',
      participantsDetected: [
        { speakerLabel: 'משתתף א׳', role: 'רכז תגמולי מילואים' },
        { speakerLabel: 'משתתף ב׳', role: 'משרת מילואים' },
        { speakerLabel: 'משתתף ג׳', role: 'נציגת משאבי אנוש מעסיק' },
      ],
      topics: [
        {
          topicTitle: 'הכללת בונוס רבעוני בבסיס חישוב תגמול המילואים',
          topicSummary: 'בדיקת זכאות להפרשים בגין רכיב בונוס ששולם לפני הגיוס.',
          participantStatements: [
            {
              speakerLabel: 'משתתף ב׳',
              role: 'משרת מילואים',
              statementSummary: 'ציין כי המעסיק שילם שכר בסיס בלבד וכי הבונוס הרבעוני לא שוקלל בתגמול.',
              keyPoints: ['45 ימי שירות מילואים', 'החרגת בונוס רבעוני מהשכר היומי'],
            },
            {
              speakerLabel: 'משתתף ג׳',
              role: 'נציגת משאבי אנוש מעסיק',
              statementSummary: 'אישרה הגשת טופס 3010 מעודכן עם פירוט השכר המלא של 3 החודשים שקדמו לגיוס.',
              keyPoints: ['משלוח טופס 3010 מתוקן היום'],
            },
            {
              speakerLabel: 'משתתף א׳',
              role: 'רכז תגמולי מילואים',
              statementSummary: 'הבהיר כי עם קליטת הטופס יבוצע חישוב הפרשים ותשלום ישיר.',
              keyPoints: ['חישוב הפרשי תגמול עם קליטת האישור'],
            },
          ],
        },
      ],
      actionItems: [
        {
          taskId: 'TASK-906-1',
          title: 'קליטת טופס 3010 מתוקן וחישוב הפרשי מילואים',
          description: 'בדיקת פירוט השכר כולל בונוס רבעוני והעברת הפרשים לזכות המבוטח.',
          owner: 'תומר אלון',
          priority: 'גבוהה',
          category: 'אישור מעסיק',
          suggestedDate: '2026-11-28',
          suggestedTime: '10:00',
          addedToCalendar: false,
        },
      ],
      transcript: [
        {
          timestamp: '00:00',
          speakerLabel: 'משתתף א׳',
          role: 'רכז תגמולי מילואים',
          text: 'שלום איתי ושני. אנחנו עוברים יחד על תקופת המילואים של ארבעים וחמישה ימים לצורך חישוב הפרשי השכר.',
        },
        {
          timestamp: '00:11',
          speakerLabel: 'משתתף ב׳',
          role: 'משרת מילואים',
          text: 'המעסיק שילם לי שכר בסיס, אבל קיבלתי גם בונוס רבעוני לפני הגיוס שלא נכלל בחישוב התגמול.',
        },
        {
          timestamp: '00:22',
          speakerLabel: 'משתתף ג׳',
          role: 'נציגת משאבי אנוש מעסיק',
          text: 'אני מעלה היום טופס 3010 מעודכן עם פירוט השכר לשלושת החודשים שקדמו לשירות כדי שיועבר ההפרש ישירות לחשבון.',
        },
      ],
    },
    {
      id: 'RPT-SEED-907',
      jobId: 'JOB-SEED-907',
      recordingId: 'rec-007',
      uniqueCallName: 'CALL-20261123-1540-FRIEDMAN',
      customerId: 'cust-107',
      customerName: 'מאיה פרידמן',
      generatedAt: '2026-11-23T15:46:14+02:00',
      returnedAt: '2026-11-23T15:46:14+02:00',
      signatureVerified: true,
      executiveSummary:
        'אישור הארכת זכאות לדמי לידה בגין אשפוז בפגייה למשך שלושה שבועות. סיכום השחרור מבית החולים נקלט בתיק ויופק תשלום השלמה ל-21 ימי חופשת לידה נוספים.',
      participantsDetected: [
        { speakerLabel: 'משתתף א׳', role: 'נציגת מחלקת אימהות' },
        { speakerLabel: 'משתתף ב׳', role: 'יולדת מבוטחת' },
      ],
      topics: [
        {
          topicTitle: 'הארכת דמי לידה עקב אשפוז בפגייה',
          topicSummary: 'השלמת תקופת הזכאות ב-21 ימים נוספים בהתאם לאישור השחרור הרפואי.',
          participantStatements: [
            {
              speakerLabel: 'משתתף ב׳',
              role: 'יולדת מבוטחת',
              statementSummary: 'אישרה כי התינוק שהה בפגייה שלושה שבועות וסיכום האשפוז צורף לתיק.',
              keyPoints: ['אשפוז של 21 יום בפגייה', 'סיכום שחרור הוגש'],
            },
            {
              speakerLabel: 'משתתף א׳',
              role: 'נציגת מחלקת אימהות',
              statementSummary: 'אישרה את תקינות המסמכים והעברה לביצוע תשלום ההפרש.',
              keyPoints: ['המסמך תקין', 'תוספת 21 ימי דמי לידה'],
            },
          ],
        },
      ],
      actionItems: [
        {
          taskId: 'TASK-907-1',
          title: 'אישור תשלום השלמה ל-21 ימי דמי לידה',
          description: 'הזנת תוספת ימי הזכאות בעקבות אשפוז פגייה והוצאת הודעת תשלום למבוטחת.',
          owner: 'מיכל שפירא',
          priority: 'גבוהה',
          category: 'תשלום וגבייה',
          suggestedDate: '2026-11-27',
          suggestedTime: '12:00',
          addedToCalendar: false,
        },
      ],
      transcript: [
        {
          timestamp: '00:00',
          speakerLabel: 'משתתף א׳',
          role: 'נציגת מחלקת אימהות',
          text: 'שלום מאיה, כאן מיכל ממחלקת אימהות. בדקנו את הבקשה להארכת דמי הלידה בעקבות אשפוז הפגייה.',
        },
        {
          timestamp: '00:14',
          speakerLabel: 'משתתף ב׳',
          role: 'יולדת מבוטחת',
          text: 'תודה מיכל. התינוק היה מאושפז שלושה שבועות, וצירפתי את סיכום השחרור מבית החולים.',
        },
      ],
    },
  ];

  public calendarEvents: CalendarEvent[] = [
    {
      id: 'evt-seed-1',
      customerId: 'cust-102',
      customerName: 'רחל אברהם',
      title: 'בדיקת זכאות לשיקום מקצועי — תיק פתוח',
      description: 'פגישת הערכה ראשונית בסניף חיפה לתיאום סל שיקום.',
      date: '2026-12-03',
      time: '11:00',
      category: 'תיאום פגישה',
      priority: 'רגילה',
      owner: 'אופיר לוי',
      completed: false,
      createdAt: '2026-11-24T09:00:00+02:00',
    },
  ];

  public notifications: SystemNotification[] = [
    {
      id: 'ntf-seed-903',
      type: 'report_returned',
      title: 'התקבל דוח תמלול וניתוח חדש עבור יוסף ושרה ברקוביץ׳',
      message: 'השיחה CALL-20261125-1415-BERKOVICH נותחה (2 נושאים, 2 משימות להמשך) ושויכה לכרטיס הלקוח.',
      createdAt: '2026-11-25T14:22:18+02:00',
      read: false,
      customerId: 'cust-103',
      customerName: 'יוסף ושרה ברקוביץ׳',
      recordingId: 'rec-003',
      reportId: 'RPT-SEED-903',
      pendingTaskCount: 2,
    },
    {
      id: 'ntf-seed-904',
      type: 'report_returned',
      title: 'התקבל דוח תמלול וניתוח חדש עבור אמיר חסון',
      message: 'השיחה CALL-20261125-1105-HASSON נותחה (2 נושאים, 2 משימות להמשך) ושויכה לכרטיס הלקוח.',
      createdAt: '2026-11-25T11:18:22+02:00',
      read: false,
      customerId: 'cust-104',
      customerName: 'אמיר חסון',
      recordingId: 'rec-004',
      reportId: 'RPT-SEED-904',
      pendingTaskCount: 2,
    },
    {
      id: 'ntf-seed-905',
      type: 'report_returned',
      title: 'התקבל דוח תמלול וניתוח חדש עבור לירון בן-דוד',
      message: 'השיחה CALL-20261124-1620-BENDAVID נותחה (2 נושאים, 2 משימות להמשך) ושויכה לכרטיס הלקוח.',
      createdAt: '2026-11-24T16:35:15+02:00',
      read: true,
      customerId: 'cust-105',
      customerName: 'לירון בן-דוד',
      recordingId: 'rec-005',
      reportId: 'RPT-SEED-905',
      pendingTaskCount: 2,
    },
    {
      id: 'ntf-seed-906',
      type: 'report_returned',
      title: 'התקבל דוח תמלול וניתוח חדש עבור איתי שפירא',
      message: 'השיחה CALL-20261124-1210-SHAPIRA נותחה (נושא 1, משימה 1 להמשך) ושויכה לכרטיס הלקוח.',
      createdAt: '2026-11-24T12:15:19+02:00',
      read: true,
      customerId: 'cust-106',
      customerName: 'איתי שפירא',
      recordingId: 'rec-006',
      reportId: 'RPT-SEED-906',
      pendingTaskCount: 1,
    },
    {
      id: 'ntf-seed-907',
      type: 'report_returned',
      title: 'התקבל דוח תמלול וניתוח חדש עבור מאיה פרידמן',
      message: 'השיחה CALL-20261123-1540-FRIEDMAN נותחה (נושא 1, משימה 1 להמשך) ושויכה לכרטיס הלקוח.',
      createdAt: '2026-11-23T15:46:14+02:00',
      read: true,
      customerId: 'cust-107',
      customerName: 'מאיה פרידמן',
      recordingId: 'rec-007',
      reportId: 'RPT-SEED-907',
      pendingTaskCount: 1,
    },
  ];

  public auditLogs: AuditLogEntry[] = [
    {
      id: 'aud-seed-903',
      timestamp: '2026-11-25T14:22:18+02:00',
      actor: 'שער קליטה מאובטח (System A)',
      system: 'customer_crm',
      action: 'אימות חתימה ושיוך דוח מלא לכרטיס הלקוח',
      resource: 'יוסף ושרה ברקוביץ׳ · RPT-SEED-903',
      outcome: 'verified',
      details: 'הדוח החוזר אומת בחתימת HMAC ושויך אוטומטית לתיק BTL-2026-19044. 2 משימות זמינות לשיבוץ ביומן.',
    },
    {
      id: 'aud-seed-904',
      timestamp: '2026-11-25T11:18:22+02:00',
      actor: 'שער קליטה מאובטח (System A)',
      system: 'customer_crm',
      action: 'אימות חתימה ושיוך דוח מלא לכרטיס הלקוח',
      resource: 'אמיר חסון · RPT-SEED-904',
      outcome: 'verified',
      details: 'הדוח החוזר אומת בחתימת HMAC ושויך אוטומטית לתיק BTL-2026-67215. 2 משימות זמינות לשיבוץ ביומן.',
    },
    {
      id: 'aud-seed-905',
      timestamp: '2026-11-24T16:35:15+02:00',
      actor: 'מנוע תמלול חיצוני (מבודד)',
      system: 'external_analytics',
      action: 'שליחת דוח חתום ומחיקת קובץ השמע מהאזור החיצוני',
      resource: 'CALL-20261124-1620-BENDAVID · JOB-SEED-905',
      outcome: 'verified',
      details: 'הדוח הוחזר חתום למערכת הפנימית וחוצץ האודיו הזמני נמחק לצמיתות.',
    },
    {
      id: 'aud-init-1',
      timestamp: '2026-11-24T08:00:00+02:00',
      actor: 'שער אבטחה ראשי',
      system: 'security_gateway',
      action: 'אתחול מדיניות הפרדת רשויות',
      resource: 'PBX <-> External Analytics',
      outcome: 'verified',
      details: 'מערכת התמלול החיצונית מוגבלת לחתימת HMAC חד-פעמית בלבד ללא גישה לבסיס נתוני הלקוחות.',
    },
  ];

  // SSE subscribers for real-time notifications when external report returns
  private sseClients = new Set<(event: string, data: unknown) => void>();

  constructor() {
    this.loadFromDisk();
  }

  private safeAudioFilename(recordingId: string): string {
    return `${recordingId.replace(/[^a-zA-Z0-9_-]/g, '')}.bin`;
  }

  private loadFromDisk(): void {
    try {
      fs.mkdirSync(AUDIO_DIR, { recursive: true });
      if (!fs.existsSync(STORE_FILE)) {
        this.save();
        return;
      }
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedStorePayload>;
      if (parsed.claimedOperatorName !== undefined) this.claimedOperatorName = parsed.claimedOperatorName;
      if (parsed.claimedPasscodeHash !== undefined) this.claimedPasscodeHash = parsed.claimedPasscodeHash;
      if (Array.isArray(parsed.customers)) this.customers = parsed.customers;
      if (Array.isArray(parsed.recordings)) {
        this.recordings = parsed.recordings.map((rec) =>
          rec.status === 'analyzing_external' || rec.status === 'transferring'
            ? { ...rec, status: 'pending_transfer' }
            : rec
        );
      }
      if (Array.isArray(parsed.transferJobs)) this.transferJobs = parsed.transferJobs;
      if (Array.isArray(parsed.reports)) this.reports = parsed.reports;
      if (Array.isArray(parsed.calendarEvents)) this.calendarEvents = parsed.calendarEvents;
      if (Array.isArray(parsed.notifications)) this.notifications = parsed.notifications;
      if (Array.isArray(parsed.auditLogs)) this.auditLogs = parsed.auditLogs;
      if (parsed.audioMeta && typeof parsed.audioMeta === 'object') {
        this.audioMeta = parsed.audioMeta;
      }
    } catch {
      // Fallback safely to seeded memory state if disk read fails
    }
  }

  public save(): void {
    try {
      fs.mkdirSync(AUDIO_DIR, { recursive: true });
      const payload: PersistedStorePayload = {
        claimedOperatorName: this.claimedOperatorName,
        claimedPasscodeHash: this.claimedPasscodeHash,
        customers: this.customers,
        recordings: this.recordings,
        transferJobs: this.transferJobs,
        reports: this.reports,
        calendarEvents: this.calendarEvents,
        notifications: this.notifications,
        auditLogs: this.auditLogs,
        audioMeta: this.audioMeta,
      };
      const tmpFile = `${STORE_FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmpFile, STORE_FILE);
    } catch {
      // Non-fatal persistence error
    }
  }

  public isEnvPasscodeConfigured(): boolean {
    return Boolean(process.env.OPERATOR_PASSCODE && process.env.OPERATOR_PASSCODE.trim().length > 0);
  }

  public isClaimed(): boolean {
    return this.claimedPasscodeHash !== null;
  }

  public claimInitialOperator(operatorName: string, passcode: string): void {
    if (this.isEnvPasscodeConfigured() || this.isClaimed()) {
      throw new Error('Operator access is already initialized.');
    }
    this.claimedOperatorName = operatorName.trim();
    this.claimedPasscodeHash = hashPasscode(passcode);
    this.save();
  }

  public verifyOperatorCredentials(passcode: string): { valid: boolean; operatorName: string } {
    const envPasscode = process.env.OPERATOR_PASSCODE?.trim();
    if (envPasscode) {
      const a = Buffer.from(passcode, 'utf8');
      const b = Buffer.from(envPasscode, 'utf8');
      const match = a.length === b.length && crypto.timingSafeEqual(a, b);
      return { valid: match, operatorName: 'נועה כהן — מנהלת מוקד' };
    }
    if (!this.claimedPasscodeHash || !this.claimedOperatorName) {
      return { valid: false, operatorName: '' };
    }
    return {
      valid: verifyPasscode(passcode, this.claimedPasscodeHash),
      operatorName: this.claimedOperatorName,
    };
  }

  public getAudio(recordingId: string): AudioCacheEntry | undefined {
    const cached = this.audioCache.get(recordingId);
    if (cached) return cached;

    const mimeType = this.audioMeta[recordingId];
    if (!mimeType) return undefined;

    try {
      const filePath = path.join(AUDIO_DIR, this.safeAudioFilename(recordingId));
      if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath);
        const entry = { buffer, mimeType };
        this.audioCache.set(recordingId, entry);
        return entry;
      }
    } catch {
      // Missing or unreadable audio file
    }
    return undefined;
  }

  public setAudio(recordingId: string, buffer: Buffer, mimeType: string): void {
    this.audioCache.set(recordingId, { buffer, mimeType });
    this.audioMeta[recordingId] = mimeType;
    try {
      fs.mkdirSync(AUDIO_DIR, { recursive: true });
      fs.writeFileSync(path.join(AUDIO_DIR, this.safeAudioFilename(recordingId)), buffer);
    } catch {
      // Non-fatal audio write failure
    }
    this.save();
  }

  public addAuditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry {
    const created: AuditLogEntry = {
      id: `aud-${crypto.randomUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.auditLogs.unshift(created);
    this.save();
    return created;
  }

  public pushNotification(notification: Omit<SystemNotification, 'id' | 'createdAt' | 'read'>): SystemNotification {
    const created: SystemNotification = {
      id: `ntf-${crypto.randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      read: false,
      ...notification,
    };
    this.notifications.unshift(created);
    this.save();
    this.broadcast('notification', created);
    return created;
  }

  public broadcast(event: string, data: unknown): void {
    for (const listener of this.sseClients) {
      listener(event, data);
    }
  }

  public subscribeSse(listener: (event: string, data: unknown) => void): () => void {
    this.sseClients.add(listener);
    return () => {
      this.sseClients.delete(listener);
    };
  }
}

export const store = new EnterpriseStore();

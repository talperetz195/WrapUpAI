import React, { useMemo, useState } from 'react';
import {
  Calendar,
  CalendarCheck2,
  CalendarPlus,
  Check,
  ClipboardList,
  Clock,
  Eye,
  FileText,
  Layers,
  Loader2,
  MessageSquareText,
  Plus,
  Search,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { createCustomer, fetchWrapupPdfBlob, revealCustomerId, updateCustomerEmails } from '../api';
import { ComplianceAndUpdates } from './wrapup/ComplianceAndUpdates';
import { INSTITUTIONAL_DEPARTMENTS } from '../constants';
import type { CalendarEvent, CallAnalysisReport, CustomerRecord, SystemSnapshot, TaskPriority } from '../types';
import { EMOTION_LABEL, EMOTION_MOOD, Face, MOOD_COLOR, churnColors } from './wrapup/sentimentUi';
import {
  Avatar,
  CodeTag,
  FilterChip,
  PageHeader,
  PageShell,
  StatusPill,
  avatarFor,
  btnOutline,
  btnPrimary,
  btnSm,
  initialsOf,
  whiteCard,
} from './wrapup/pageUi';

interface CustomerCardViewProps {
  token: string;
  customers: CustomerRecord[];
  reports: CallAnalysisReport[];
  calendarEvents: CalendarEvent[];
  selectedCustomerId: string;
  selectedReportId: string | null;
  onSelectCustomer: (customerId: string) => void;
  onSelectReport: (reportId: string) => void;
  onOpenPdf: (reportId: string) => void;
  onCustomerCreated: (customerId: string, snapshot: SystemSnapshot) => void;
  onAddTaskToCalendar: (reportId: string, taskId: string, customDate?: string, customTime?: string) => Promise<void>;
  onAddAllTasksToCalendar: (reportId: string) => Promise<void>;
  onToggleEventCompleted: (eventId: string, completed: boolean) => Promise<void>;
  onRescheduleEvent: (eventId: string, date: string, time: string) => Promise<void>;
}

const PRIORITY_PILL: Record<TaskPriority, [string, string]> = {
  דחופה: ['#FDECEC', '#B3261E'],
  גבוהה: ['#FFF1DE', '#B5651D'],
  רגילה: ['#F1F2F6', '#6B7280'],
};

const dateInput =
  'px-2.5 py-1.5 text-xs font-mono font-semibold text-[#6B66A8] bg-white rounded-lg border border-[#E4E0FB] focus:outline-none focus:ring-2 focus:ring-[#5B4CF0] disabled:opacity-60';

function formatDateTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} · ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`;
}

function formatDayHeader(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('he-IL', { weekday: 'long', day: '2-digit', month: '2-digit' });
}

export const CustomerCardView: React.FC<CustomerCardViewProps> = ({
  token,
  customers,
  reports,
  calendarEvents,
  selectedCustomerId,
  selectedReportId,
  onSelectCustomer,
  onSelectReport,
  onOpenPdf,
  onCustomerCreated,
  onAddTaskToCalendar,
  onAddAllTasksToCalendar,
  onToggleEventCompleted,
  onRescheduleEvent,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'reports' | 'calendar'>('reports');
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [revealedIds, setRevealedIds] = useState<Record<string, string>>({});
  const [busyTaskKey, setBusyTaskKey] = useState<string | null>(null);
  const [busyBatchReportId, setBusyBatchReportId] = useState<string | null>(null);
  const [editingDateMap, setEditingDateMap] = useState<Record<string, { date: string; time: string }>>({});

  // Add New Customer Modal State
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newFullName, setNewFullName] = useState('');
  const [newNationalId, setNewNationalId] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmails, setNewEmails] = useState('');
  const [editingEmails, setEditingEmails] = useState<string | null>(null);
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [newCity, setNewCity] = useState('תל אביב-יפו');
  const [newBranch, setNewBranch] = useState('סניף תל אביב מרכז');
  const [newDepartment, setNewDepartment] = useState('אבטלה והבטחת הכנסה');
  const [newHandler, setNewHandler] = useState('נועה כהן');
  const [newCaseStatus, setNewCaseStatus] = useState('תיק חדש · פעיל');
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const activeCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || customers[0],
    [customers, selectedCustomerId]
  );

  const customerReports = useMemo(
    () => reports.filter((r) => r.customerId === activeCustomer?.id),
    [reports, activeCustomer]
  );

  const activeReport = useMemo(() => {
    if (selectedReportId) {
      const found = customerReports.find((r) => r.id === selectedReportId);
      if (found) return found;
    }
    return customerReports[0] || null;
  }, [customerReports, selectedReportId]);

  const customerEvents = useMemo(
    () =>
      calendarEvents
        .filter((e) => e.customerId === activeCustomer?.id)
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
    [calendarEvents, activeCustomer]
  );

  const sentimentFor = (customerId: string) =>
    reports
      .filter((r) => r.customerId === customerId && r.wrapup?.sentiment)
      .sort((a, b) => (b.returnedAt || '').localeCompare(a.returnedAt || ''))[0]?.wrapup?.sentiment;

  const filteredCustomers = useMemo(() => {
    const q = directoryQuery.trim();
    if (!q) return customers;
    return customers.filter((c) => c.fullName.includes(q) || c.caseNumber.includes(q) || c.nationalId.includes(q));
  }, [customers, directoryQuery]);

  /** יומן מקובץ לפי ימים; משימות שבוצעו בקבוצה נפרדת בסוף */
  const calendarGroups = useMemo(() => {
    const groups = new Map<string, CalendarEvent[]>();
    for (const evt of customerEvents) {
      const key = evt.completed ? '__done' : evt.date;
      groups.set(key, [...(groups.get(key) || []), evt]);
    }
    return [...groups.entries()].sort(([a], [b]) => (a === '__done' ? 1 : b === '__done' ? -1 : a.localeCompare(b)));
  }, [customerEvents]);

  const handleRevealId = async (customerId: string) => {
    const res = await revealCustomerId(token, customerId);
    setRevealedIds((prev) => ({ ...prev, [customerId]: res.nationalId }));
  };

  const handleAddSingleTask = async (reportId: string, taskId: string, defaultDate: string, defaultTime: string) => {
    const custom = editingDateMap[taskId];
    setBusyTaskKey(taskId);
    try {
      await onAddTaskToCalendar(
        reportId,
        taskId,
        custom?.date || defaultDate,
        custom?.time || defaultTime
      );
    } finally {
      setBusyTaskKey(null);
    }
  };

  const handleAddAll = async (reportId: string) => {
    setBusyBatchReportId(reportId);
    try {
      await onAddAllTasksToCalendar(reportId);
    } finally {
      setBusyBatchReportId(null);
    }
  };

  const handleCreateCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreatingCustomer(true);
    try {
      const res = await createCustomer(token, {
        fullName: newFullName,
        nationalId: newNationalId,
        phone: newPhone,
        emails: newEmails,
        city: newCity,
        branch: newBranch,
        department: newDepartment,
        assignedHandler: newHandler,
        caseStatus: newCaseStatus,
      });
      onCustomerCreated(res.customerId, res.snapshot);
      setShowAddCustomer(false);
      setNewFullName('');
      setNewNationalId('');
      setNewPhone('');
      setNewEmails('');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'שגיאה בפתיחת כרטיס הלקוח.');
    } finally {
      setCreatingCustomer(false);
    }
  };

  if (!activeCustomer) return null;

  const displayNationalId = revealedIds[activeCustomer.id] || activeCustomer.nationalId;
  const activeSentiment = sentimentFor(activeCustomer.id);

  return (
    <PageShell>
      <PageHeader title="כרטיסי לקוחות ויומן" subtitle="תיק הלקוח, סיכומי השיחות שחזרו מ-WrapUpAI והמשימות ביומן">
        <button onClick={() => setShowAddCustomer(true)} className={btnPrimary}>
          <Plus className="w-4 h-4" />
          כרטיס לקוח חדש
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-5 items-start">
        {/* Customer Directory Column */}
        <aside className={`${whiteCard} !p-4 space-y-2`}>
          <label className="relative block">
            <Search className="w-4 h-4 text-[#A3A7BD] absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={directoryQuery}
              onChange={(e) => setDirectoryQuery(e.target.value)}
              placeholder="חיפוש לפי שם, ת״ז או תיק..."
              className="w-full pr-10 pl-3 py-2.5 text-sm bg-[#F7F5FF] rounded-xl border border-transparent focus:outline-none focus:ring-2 focus:ring-[#5B4CF0]"
            />
          </label>
          <div className="text-[13px] font-extrabold text-[#9A97C2] px-2 pt-1">{customers.length} מבוטחים פעילים</div>
          <div className="space-y-1">
            {filteredCustomers.map((customer) => {
              const countReports = reports.filter((r) => r.customerId === customer.id).length;
              const countEvents = calendarEvents.filter((e) => e.customerId === customer.id).length;
              const isSelected = customer.id === activeCustomer.id;
              const s = sentimentFor(customer.id);
              return (
                <button
                  key={customer.id}
                  onClick={() => onSelectCustomer(customer.id)}
                  className={`w-full text-right flex items-center gap-3 px-3 py-2.5 rounded-[14px] transition-colors ${
                    isSelected ? 'bg-[#EEF0FF] ring-2 ring-[#8B7CF6]' : 'hover:bg-[#F7F5FF]'
                  }`}
                >
                  <Avatar name={customer.fullName} id={customer.id} size={42} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-extrabold text-[#1E1B4B] truncate">{customer.fullName}</span>
                    <span className="block text-xs font-medium text-[#8A8FA3] truncate">{customer.department}</span>
                    <span className="block text-[11px] font-medium text-[#A3A7BD] tabular-nums">
                      {countReports} סיכומים · {countEvents} ביומן
                    </span>
                  </span>
                  <Face mood={s ? EMOTION_MOOD[s.endEmotion] : 'Neutral'} size={28} active={Boolean(s)} title={s ? EMOTION_LABEL[s.endEmotion] : 'עוד לא נותח'} />
                </button>
              );
            })}
            {filteredCustomers.length === 0 && <div className="text-sm text-[#8A8FA3] px-2 py-4">לא נמצאו לקוחות.</div>}
          </div>
        </aside>

        {/* Main Customer Card & Calendar Area */}
        <div className="space-y-5 min-w-0">
          {/* Customer Header Card */}
          <section className={`${whiteCard} space-y-4`}>
            <div className="flex flex-wrap items-center gap-3">
              <Avatar name={activeCustomer.fullName} id={activeCustomer.id} size={56} />
              <div className="flex-1 min-w-[240px] text-right space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[21px] font-extrabold text-[#1E1B4B]">{activeCustomer.fullName}</h2>
                  <CodeTag>{activeCustomer.caseNumber}</CodeTag>
                  {activeSentiment && (
                    <>
                      <StatusPill bg={MOOD_COLOR[EMOTION_MOOD[activeSentiment.endEmotion]] + '33'} fg="#3D3A6B">
                        רגש בסיום: {EMOTION_LABEL[activeSentiment.endEmotion]}
                      </StatusPill>
                      <StatusPill bg={activeSentiment.churnRisk >= 60 ? '#FDECEC' : activeSentiment.churnRisk >= 30 ? '#FFF1DE' : '#E3F6EA'} fg={churnColors(activeSentiment.churnRisk).text}>
                        סיכון נטישה {activeSentiment.churnRisk}%
                      </StatusPill>
                    </>
                  )}
                </div>
                <div className="text-[13px] font-medium text-[#8A8FA3]">
                  {activeCustomer.department} · {activeCustomer.branch} · רכז/ת: {activeCustomer.assignedHandler}
                </div>
              </div>
              <div className="inline-flex bg-[#EEF0FF] rounded-xl p-1 gap-1 shrink-0">
                {(
                  [
                    ['reports', FileText, `סיכומי שיחה (${customerReports.length})`],
                    ['calendar', Calendar, `יומן (${customerEvents.length})`],
                  ] as const
                ).map(([id, Icon, label]) => (
                  <button
                    key={id}
                    onClick={() => setActiveSubTab(id)}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold rounded-[9px] transition-colors whitespace-nowrap ${
                      activeSubTab === id ? 'bg-white text-[#5B4CF0] shadow-[0_2px_6px_rgba(91,76,240,0.15)]' : 'text-[#6B66A8] hover:text-[#5B4CF0]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="bg-[#F7F8FB] rounded-[14px] px-3.5 py-3">
                <div className="text-xs font-semibold text-[#8A8FA3]">מספר זהות</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono text-[15px] font-bold text-[#1E1B4B] tabular-nums">{displayNationalId}</span>
                  {!revealedIds[activeCustomer.id] && (
                    <button
                      onClick={() => handleRevealId(activeCustomer.id)}
                      className="inline-flex items-center gap-1 text-xs font-bold text-[#5B4CF0] hover:underline"
                    >
                      <Eye className="w-3.5 h-3.5" /> הצג
                    </button>
                  )}
                </div>
              </div>
              <div className="bg-[#F7F8FB] rounded-[14px] px-3.5 py-3">
                <div className="text-xs font-semibold text-[#8A8FA3]">טלפון</div>
                <div className="font-mono text-[15px] font-bold text-[#1E1B4B] tabular-nums mt-0.5 text-right" dir="ltr">
                  {activeCustomer.phone}
                </div>
              </div>
              <div className="bg-[#F7F8FB] rounded-[14px] px-3.5 py-3">
                <div className="text-xs font-semibold text-[#8A8FA3]">יישוב</div>
                <div className="text-[15px] font-extrabold text-[#1E1B4B] mt-0.5">{activeCustomer.city}</div>
              </div>
              <div className="bg-[#F7F8FB] rounded-[14px] px-3.5 py-3">
                <div className="text-xs font-semibold text-[#8A8FA3]">סטטוס תיק</div>
                <div className="text-[15px] font-extrabold text-[#1E1B4B] mt-0.5">{activeCustomer.caseStatus}</div>
              </div>
            </div>

            {activeCustomer.crmFields && Object.keys(activeCustomer.crmFields).length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-[#8A8FA3]">עודכן משיחות (WrapUpAI):</span>
                {Object.entries(activeCustomer.crmFields).map(([k, v]) => (
                  <span key={k} className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#E3F6EA] text-[#1F6B45]">
                    <b>{k}:</b> {v}
                  </span>
                ))}
              </div>
            )}

            <div className="text-xs">
              {editingEmails === null || editingFor !== activeCustomer.id ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-[#8A8FA3]">📧 סיכומי שיחה נשלחים ל:</span>
                  {(activeCustomer.emails || []).length === 0 && <span className="text-[#A3A7BD]">לא הוגדר</span>}
                  {(activeCustomer.emails || []).map((email) => (
                    <span key={email} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F7F5FF] font-mono text-[#3D3A6B]" dir="ltr">
                      {email}
                      {email.endsWith('@example.com') && (
                        <span className="text-[10px] font-sans font-bold px-1.5 py-0.5 rounded-full bg-[#FFF6D6] text-[#8A6100]">כתובת דוגמה</span>
                      )}
                    </span>
                  ))}
                  <button
                    onClick={() => {
                      setEmailError(null);
                      setEditingFor(activeCustomer.id);
                      setEditingEmails((activeCustomer.emails || []).filter((e) => !e.endsWith('@example.com')).join(', '));
                    }}
                    className="font-bold text-[#5B4CF0] hover:underline"
                  >
                    עריכה
                  </button>
                </div>
              ) : (
                <form
                  className="flex items-center gap-2 flex-wrap"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await updateCustomerEmails(token, activeCustomer.id, editingEmails);
                      setEditingEmails(null);
                    } catch (err) {
                      setEmailError(err instanceof Error ? err.message : 'שגיאה בעדכון המייל');
                    }
                  }}
                >
                  <input
                    autoFocus
                    dir="ltr"
                    value={editingEmails}
                    onChange={(e) => setEditingEmails(e.target.value)}
                    placeholder="name@company.com, partner@company.com"
                    className="flex-1 min-w-[220px] px-3 py-2 text-xs font-mono bg-[#F7F5FF] rounded-xl border border-transparent focus:outline-none focus:ring-2 focus:ring-[#5B4CF0]"
                  />
                  <button type="submit" className={`${btnPrimary} ${btnSm}`}>
                    שמירה
                  </button>
                  <button type="button" onClick={() => setEditingEmails(null)} className="px-3 py-2 text-xs font-semibold text-[#6B66A8]">
                    ביטול
                  </button>
                  <span className="w-full text-[11px] text-[#8A8FA3]">אפשר כמה כתובות מופרדות בפסיק. השארה ריקה = כתובת דוגמה אוטומטית.</span>
                  {emailError && <span className="w-full text-[11px] text-[#B3261E]">{emailError}</span>}
                </form>
              )}
            </div>
          </section>

          {/* Subtab 1: Returned Business Reports inside Customer Card */}
          {activeSubTab === 'reports' && (
            <>
              {customerReports.length === 0 ? (
                <section className={`${whiteCard} text-center py-10 space-y-2`}>
                  <FileText className="w-8 h-8 text-[#A3A7BD] mx-auto" />
                  <h3 className="text-base font-extrabold text-[#1E1B4B]">עוד לא התקבלו סיכומי שיחה ללקוח הזה</h3>
                  <p className="text-sm text-[#8A8FA3] max-w-md mx-auto">
                    שלחו הקלטה של {activeCustomer.fullName} מהמרכזייה לניתוח, והסיכום והמשימות יופיעו כאן אוטומטית.
                  </p>
                </section>
              ) : (
                activeReport && (
                  <section className={`${whiteCard} space-y-[18px]`}>
                    {/* Report Header */}
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-[240px] text-right space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-extrabold text-[#1E1B4B]">סיכום שיחה</h3>
                          <CodeTag>{activeReport.uniqueCallName}</CodeTag>
                          {activeReport.signatureVerified && (
                            <StatusPill bg="#E3F6EA" fg="#2F7D52">
                              <ShieldCheck className="w-3.5 h-3.5" /> חתום ומאומת
                            </StatusPill>
                          )}
                        </div>
                        <div className="text-[13px] font-medium text-[#8A8FA3]">התקבל {formatDateTime(activeReport.returnedAt)}</div>
                      </div>
                      {customerReports.length > 1 && (
                        <div className="flex flex-wrap gap-1.5">
                          {customerReports.map((rep) => (
                            <FilterChip key={rep.id} active={activeReport.id === rep.id} onClick={() => onSelectReport(rep.id)}>
                              <span dir="ltr" className="font-mono text-xs">
                                {rep.uniqueCallName}
                              </span>
                            </FilterChip>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {(['business', 'customer'] as const).map((kind) =>
                        (kind === 'business' ? activeReport.wrapup?.pdfFileName : activeReport.wrapup?.customerPdfFileName) ? (
                          <button
                            key={kind}
                            onClick={async () => {
                              try {
                                const blob = await fetchWrapupPdfBlob(token, activeReport.id, kind);
                                window.open(URL.createObjectURL(blob), '_blank');
                              } catch (err) {
                                alert(err instanceof Error ? err.message : 'שגיאה בפתיחת ה-PDF');
                              }
                            }}
                            className={`${kind === 'business' ? btnPrimary : btnOutline} ${btnSm}`}
                          >
                            <FileText className="w-4 h-4" />
                            {kind === 'business' ? 'PDF סיכום ותחושות (WrapUpAI)' : 'PDF שנשלח ללקוח'}
                          </button>
                        ) : null
                      )}
                      <button onClick={() => onOpenPdf(activeReport.id)} className={`${btnOutline} ${btnSm}`}>
                        <FileText className="w-4 h-4" /> מסמך PDF
                      </button>
                      <button onClick={() => setShowTranscript((v) => !v)} className={`${btnOutline} ${btnSm}`}>
                        <MessageSquareText className="w-4 h-4" /> {showTranscript ? 'הסתר תמלול' : 'תמלול מלא'}
                      </button>
                      <button onClick={() => setActiveSubTab('calendar')} className={`${btnOutline} ${btnSm}`}>
                        <Calendar className="w-4 h-4" /> ליומן הלקוח
                      </button>
                    </div>

                    <div className="bg-[#F7F5FF] rounded-2xl px-[18px] py-4 text-sm leading-relaxed text-[#3D3A6B]">
                      <div className="text-xs font-bold text-[#9A97C2] mb-1">סיכום מנהלים</div>
                      {activeReport.executiveSummary}
                    </div>

                    {activeReport.wrapup && (
                      <div className="text-[13px] font-medium text-[#4A3BB8] bg-[#EEF0FF] rounded-2xl px-[18px] py-3">
                        <span className="font-extrabold">WrapUpAI · </span>
                        {activeReport.wrapup.delivery}
                      </div>
                    )}

                    <ComplianceAndUpdates token={token} report={activeReport} />

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-bold text-[#8A8FA3]">משתתפים:</span>
                      {activeReport.participantsDetected.map((p, idx) => (
                        <span
                          key={`${p.speakerLabel}-${idx}`}
                          className="px-3 py-1 rounded-full text-[13px] font-semibold text-[#3D3A6B]"
                          style={{ background: avatarFor(p.speakerLabel + p.role)[0] }}
                        >
                          {p.speakerLabel} · {p.role}
                        </span>
                      ))}
                    </div>

                    {/* Topics */}
                    <div className="space-y-3">
                      <h4 className="text-base font-extrabold text-[#1E1B4B] flex items-center gap-2">
                        <Layers className="w-4 h-4 text-[#5B4CF0]" /> נושאי השיחה · מה אמר כל צד
                      </h4>
                      {activeReport.topics.map((topic, idx) => (
                        <div key={idx} className="bg-[#FBFAFF] rounded-2xl px-[18px] py-4 space-y-3">
                          <div>
                            <div className="text-sm font-extrabold text-[#1E1B4B]">
                              {idx + 1} · {topic.topicTitle}
                            </div>
                            <p className="text-[13px] text-[#5F6672] mt-1 leading-relaxed">{topic.topicSummary}</p>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                            {topic.participantStatements.map((stmt, sIdx) => {
                              const [bg, fg] = avatarFor(stmt.speakerLabel + stmt.role);
                              return (
                                <div key={sIdx} className="bg-white rounded-[14px] px-3.5 py-3 space-y-1.5 shadow-[0_2px_8px_rgba(91,76,240,0.05)]">
                                  <div className="flex items-center gap-2 text-[13px] font-bold text-[#1E1B4B]">
                                    <span
                                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold"
                                      style={{ background: bg, color: fg }}
                                    >
                                      {initialsOf(stmt.speakerLabel)[0]}
                                    </span>
                                    {stmt.speakerLabel}
                                    <span className="font-medium text-[#8A8FA3]">· {stmt.role}</span>
                                  </div>
                                  <p className="text-[13px] text-[#3D3A6B] leading-relaxed">{stmt.statementSummary}</p>
                                  {stmt.keyPoints.length > 0 && (
                                    <ul className="space-y-1 pt-1">
                                      {stmt.keyPoints.map((pt, pIdx) => (
                                        <li key={pIdx} className="text-xs text-[#5F6672] flex items-start gap-1.5">
                                          <span className="text-[#8B7CF6] mt-0.5">•</span>
                                          <span>{pt}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Action items */}
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex-1 min-w-[220px]">
                          <h4 className="text-base font-extrabold text-[#1E1B4B]">משימות להמשך</h4>
                          <p className="text-xs font-medium text-[#8A8FA3]">בחרו מועד ושבצו ביומן הלקוח בלחיצה</p>
                        </div>
                        {activeReport.actionItems.some((t) => !t.addedToCalendar) && (
                          <button
                            onClick={() => handleAddAll(activeReport.id)}
                            disabled={busyBatchReportId === activeReport.id}
                            className={`${btnPrimary} ${btnSm}`}
                          >
                            {busyBatchReportId === activeReport.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
                            הכל ליומן
                          </button>
                        )}
                      </div>

                      {activeReport.actionItems.map((task) => {
                        const editValues = editingDateMap[task.taskId] || {
                          date: task.suggestedDate,
                          time: task.suggestedTime,
                        };
                        const pr = PRIORITY_PILL[task.priority];
                        return (
                          <div key={task.taskId} className="bg-[#F7F8FB] rounded-2xl px-4 py-3.5 flex flex-wrap items-center gap-3.5">
                            <span className="w-10 h-10 rounded-xl bg-[#EEF0FF] flex items-center justify-center shrink-0">
                              <ClipboardList className="w-5 h-5 text-[#5B4CF0]" />
                            </span>
                            <div className="flex-1 min-w-[220px] space-y-0.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-extrabold text-[#1E1B4B]">{task.title}</span>
                                <StatusPill bg={pr[0]} fg={pr[1]}>
                                  {task.priority}
                                </StatusPill>
                              </div>
                              <p className="text-[13px] text-[#5F6672] leading-relaxed">{task.description}</p>
                              <div className="text-xs font-medium text-[#8A8FA3]">
                                {task.category} · אחראי/ת: {task.owner}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <input
                                type="date"
                                value={editValues.date}
                                disabled={task.addedToCalendar}
                                onChange={(e) =>
                                  setEditingDateMap((prev) => ({
                                    ...prev,
                                    [task.taskId]: { ...editValues, date: e.target.value },
                                  }))
                                }
                                className={dateInput}
                              />
                              <input
                                type="time"
                                value={editValues.time}
                                disabled={task.addedToCalendar}
                                onChange={(e) =>
                                  setEditingDateMap((prev) => ({
                                    ...prev,
                                    [task.taskId]: { ...editValues, time: e.target.value },
                                  }))
                                }
                                className={dateInput}
                              />
                              {task.addedToCalendar ? (
                                <StatusPill bg="#E3F6EA" fg="#2F7D52">
                                  <CalendarCheck2 className="w-3.5 h-3.5" /> ביומן
                                </StatusPill>
                              ) : (
                                <button
                                  onClick={() => handleAddSingleTask(activeReport.id, task.taskId, task.suggestedDate, task.suggestedTime)}
                                  disabled={busyTaskKey === task.taskId}
                                  className={`${btnPrimary} ${btnSm}`}
                                >
                                  {busyTaskKey === task.taskId ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
                                  ליומן
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Full Diarized Transcript (Collapsible) */}
                    {showTranscript && (
                      <div className="bg-[#F7F5FF] rounded-2xl p-4 space-y-2.5">
                        <h4 className="text-sm font-extrabold text-[#1E1B4B]">תמלול מלא לפי דוברים</h4>
                        {activeReport.transcript.map((line, idx) => (
                          <div key={idx} className="bg-white rounded-[14px] px-4 py-3 space-y-1">
                            <div className="flex items-center gap-2 text-xs text-[#8A8FA3]">
                              <span className="font-mono tabular-nums">{line.timestamp}</span>
                              <span className="font-extrabold text-[#1E1B4B]">{line.speakerLabel}</span>
                              <span>· {line.role}</span>
                            </div>
                            <p className="text-sm text-[#3D3A6B] leading-relaxed">{line.text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )
              )}
            </>
          )}

          {/* Subtab 2: Customer Calendar */}
          {activeSubTab === 'calendar' && (
            <section className={`${whiteCard} space-y-3`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[220px]">
                  <h3 className="text-lg font-extrabold text-[#1E1B4B]">יומן הלקוח · {activeCustomer.fullName}</h3>
                  <p className="text-[13px] font-medium text-[#8A8FA3]">משימות שנוצרו מסיכומי השיחות · סמנו ✓ כשבוצע</p>
                </div>
                <StatusPill bg="#EEF0FF" fg="#5B4CF0">
                  {customerEvents.filter((e) => !e.completed).length} פתוחות · {customerEvents.filter((e) => e.completed).length} בוצעו
                </StatusPill>
              </div>

              {customerEvents.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <Calendar className="w-8 h-8 text-[#A3A7BD] mx-auto" />
                  <p className="text-sm font-extrabold text-[#1E1B4B]">היומן ריק כרגע</p>
                  <p className="text-xs text-[#8A8FA3]">הוסיפו משימות מתוך סיכומי השיחה כדי לשבץ מעקב ביומן.</p>
                </div>
              ) : (
                calendarGroups.map(([groupKey, events]) => (
                  <div key={groupKey} className="space-y-2">
                    <div className="text-[13px] font-extrabold text-[#9A97C2] px-1 pt-2">
                      {groupKey === '__done' ? 'בוצע' : formatDayHeader(groupKey)}
                    </div>
                    {events.map((evt) => {
                      const pr = PRIORITY_PILL[evt.priority];
                      return (
                        <div
                          key={evt.id}
                          className={`bg-[#F7F8FB] rounded-2xl px-4 py-3.5 flex flex-wrap items-center gap-3.5 ${evt.completed ? 'opacity-60' : ''}`}
                        >
                          <button
                            onClick={() => onToggleEventCompleted(evt.id, !evt.completed)}
                            className={`w-[26px] h-[26px] rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                              evt.completed ? 'bg-[#2F9E6A] border-[#2F9E6A] text-white' : 'border-[#C9C3F5] bg-white hover:border-[#5B4CF0]'
                            }`}
                            title={evt.completed ? 'סמן כפתוחה' : 'סמן כבוצעה'}
                          >
                            {evt.completed && <Check className="w-3.5 h-3.5" />}
                          </button>
                          <div className="flex-1 min-w-[220px] space-y-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`text-sm font-extrabold ${evt.completed ? 'line-through text-[#8A8FA3]' : 'text-[#1E1B4B]'}`}>{evt.title}</span>
                              <StatusPill bg={pr[0]} fg={pr[1]}>
                                {evt.priority}
                              </StatusPill>
                            </div>
                            {evt.description && <p className="text-[13px] text-[#5F6672]">{evt.description}</p>}
                            <div className="text-xs font-medium text-[#8A8FA3] flex flex-wrap items-center gap-1.5">
                              <span>
                                {evt.category} · אחראי/ת: {evt.owner}
                              </span>
                              {evt.reportId && (
                                <>
                                  <span>· מקור:</span>
                                  <CodeTag>{reports.find((r) => r.id === evt.reportId)?.uniqueCallName || evt.reportId}</CodeTag>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-[#A3A7BD]" />
                            <input
                              type="date"
                              value={evt.date}
                              onChange={(e) => onRescheduleEvent(evt.id, e.target.value, evt.time)}
                              className={dateInput}
                            />
                            <input
                              type="time"
                              value={evt.time}
                              onChange={(e) => onRescheduleEvent(evt.id, evt.date, e.target.value)}
                              className={dateInput}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </section>
          )}
        </div>
      </div>

      {/* Add New Customer Modal */}
      {showAddCustomer && (
        <div className="fixed inset-0 z-50 bg-[#1E1B4B]/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-[22px] w-full max-w-lg shadow-[0_20px_50px_rgba(30,27,75,0.25)] overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-xl bg-[#EEF0FF] flex items-center justify-center"><UserPlus className="w-4 h-4 text-[#5B4CF0]" /></span>
                <h3 className="text-lg font-extrabold text-[#1E1B4B]">כרטיס לקוח חדש</h3>
              </div>
              <button
                onClick={() => setShowAddCustomer(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
                aria-label="סגור חלון הוספת לקוח"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomerSubmit} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-[#6B66A8] mb-1">שם מלא *</label>
                  <input
                    type="text"
                    required
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    placeholder="לדוגמה: שירה לוי"
                    className="w-full px-3 py-2 text-sm bg-[#F7F5FF] border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5B4CF0]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#6B66A8] mb-1">מספר זהות *</label>
                  <input
                    type="text"
                    required
                    value={newNationalId}
                    onChange={(e) => setNewNationalId(e.target.value)}
                    placeholder="9 ספרות"
                    className="w-full px-3 py-2 text-sm font-mono bg-[#F7F5FF] border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5B4CF0]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#6B66A8] mb-1">טלפון *</label>
                  <input
                    type="tel"
                    required
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="050-0000000"
                    className="w-full px-3 py-2 text-sm font-mono bg-[#F7F5FF] border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5B4CF0]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#6B66A8] mb-1">
                    דוא״ל לסיכומי שיחה (WrapUpAI) · אפשר כמה, מופרדים בפסיק
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={newEmails}
                    onChange={(e) => setNewEmails(e.target.value)}
                    placeholder="name@example.com, partner@example.com"
                    className="w-full px-3 py-2 text-sm font-mono bg-[#F7F5FF] border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5B4CF0]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#6B66A8] mb-1">יישוב מגורים</label>
                  <input
                    type="text"
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#F7F5FF] border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5B4CF0]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#6B66A8] mb-1">מחלקה / תחום תביעה</label>
                  <select
                    value={newDepartment}
                    onChange={(e) => setNewDepartment(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#F7F5FF] border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5B4CF0]"
                  >
                    {INSTITUTIONAL_DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#6B66A8] mb-1">סניף מטפל</label>
                  <input
                    type="text"
                    value={newBranch}
                    onChange={(e) => setNewBranch(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#F7F5FF] border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5B4CF0]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#6B66A8] mb-1">רכז/ת מטפל/ת</label>
                  <input
                    type="text"
                    value={newHandler}
                    onChange={(e) => setNewHandler(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#F7F5FF] border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5B4CF0]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#6B66A8] mb-1">סטטוס תיק ראשוני</label>
                  <input
                    type="text"
                    value={newCaseStatus}
                    onChange={(e) => setNewCaseStatus(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#F7F5FF] border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5B4CF0]"
                  />
                </div>
              </div>

              {createError && (
                <div className="text-xs font-medium text-[#B3261E] bg-[#FDECEC] rounded-xl px-3 py-2">
                  {createError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddCustomer(false)}
                  className="px-4 py-2.5 text-sm font-semibold text-[#6B66A8] hover:text-[#1E1B4B] rounded-xl"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  disabled={creatingCustomer}
                  className={btnPrimary}
                >
                  {creatingCustomer && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{creatingCustomer ? 'פותח כרטיס...' : 'צור כרטיס לקוח'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageShell>
  );
};

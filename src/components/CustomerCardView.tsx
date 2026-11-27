import React, { useMemo, useState } from 'react';
import {
  Calendar,
  CalendarCheck2,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Layers,
  Loader2,
  MessageSquareText,
  Plus,
  ShieldCheck,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { createCustomer, fetchWrapupPdfBlob, revealCustomerId, updateCustomerEmails } from '../api';
import { ComplianceAndUpdates } from './wrapup/ComplianceAndUpdates';
import { INSTITUTIONAL_DEPARTMENTS } from '../constants';
import type { CalendarEvent, CallAnalysisReport, CustomerRecord, SystemSnapshot, TaskPriority } from '../types';

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

function priorityStyle(priority: TaskPriority): string {
  switch (priority) {
    case 'דחופה':
      return 'text-red-700 font-semibold';
    case 'גבוהה':
      return 'text-amber-700 font-semibold';
    case 'רגילה':
      return 'text-slate-600 font-medium';
  }
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Customer Directory Column */}
      <aside className="lg:col-span-3 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">תיקי לקוחות במערכת הראשית</h2>
            <p className="text-xs text-slate-500 mt-0.5">{customers.length} מבוטחים פעילים</p>
          </div>
          <button
            onClick={() => setShowAddCustomer(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-[#0F2942] hover:bg-slate-800 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>לקוח חדש</span>
          </button>
        </div>
        <div className="divide-y divide-slate-100">
          {customers.map((customer) => {
            const countReports = reports.filter((r) => r.customerId === customer.id).length;
            const countEvents = calendarEvents.filter((e) => e.customerId === customer.id).length;
            const isSelected = customer.id === activeCustomer.id;
            return (
              <button
                key={customer.id}
                onClick={() => onSelectCustomer(customer.id)}
                className={`w-full text-right px-4 py-3.5 transition-colors block ${
                  isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900 truncate">{customer.fullName}</span>
                  <span className="text-xs font-mono tabular-nums text-slate-500 shrink-0">
                    {customer.caseNumber}
                  </span>
                </div>
                <div className="text-xs text-slate-600 mt-1 truncate">{customer.department}</div>
                <div className="text-xs text-slate-500 mt-1.5 flex items-center gap-2 tabular-nums">
                  <span>{countReports} דוחות</span>
                  <span aria-hidden="true">·</span>
                  <span>{countEvents} אירועי יומן</span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Main Customer Card & Calendar Area */}
      <div className="lg:col-span-9 space-y-6">
        {/* Customer Header Card */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-4 border-b border-slate-100">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <User className="w-5 h-5 text-[#0F2942]" />
                <h2 className="text-xl font-bold text-slate-900">{activeCustomer.fullName}</h2>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span className="font-mono text-xs text-slate-600">{activeCustomer.caseNumber}</span>
              </div>
              <div className="text-xs text-slate-600 flex items-center gap-2 flex-wrap">
                <span>{activeCustomer.department}</span>
                <span aria-hidden="true">·</span>
                <span>{activeCustomer.branch}</span>
                <span aria-hidden="true">·</span>
                <span>רכז מטפל: {activeCustomer.assignedHandler}</span>
              </div>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0 self-start">
              <button
                onClick={() => setActiveSubTab('reports')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  activeSubTab === 'reports'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>דוחות שיחה וסיכומים ({customerReports.length})</span>
              </button>
              <button
                onClick={() => setActiveSubTab('calendar')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  activeSubTab === 'calendar'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>יומן הלקוח ({customerEvents.length})</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <div className="text-slate-500 mb-1">מספר זהות</div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-medium text-slate-900 tabular-nums">{displayNationalId}</span>
                {!revealedIds[activeCustomer.id] && (
                  <button
                    onClick={() => handleRevealId(activeCustomer.id)}
                    className="inline-flex items-center gap-1 text-blue-700 hover:underline font-medium"
                  >
                    <Eye className="w-3 h-3" />
                    <span>חשוף</span>
                  </button>
                )}
              </div>
            </div>
            <div>
              <div className="text-slate-500 mb-1">טלפון</div>
              <div className="font-mono font-medium text-slate-900 tabular-nums" dir="ltr">
                {activeCustomer.phone}
              </div>
            </div>
            <div>
              <div className="text-slate-500 mb-1">יישוב</div>
              <div className="font-medium text-slate-900">{activeCustomer.city}</div>
            </div>
            <div>
              <div className="text-slate-500 mb-1">סטטוס תיק</div>
              <div className="font-medium text-slate-900">{activeCustomer.caseStatus}</div>
            </div>
            {activeCustomer.crmFields && Object.keys(activeCustomer.crmFields).length > 0 && (
              <div className="col-span-2 sm:col-span-4">
                <div className="text-slate-500 mb-1">שדות שעודכנו מתוך שיחות (WrapUpAI)</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(activeCustomer.crmFields).map(([k, v]) => (
                    <span key={k} className="px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-900">
                      <b>{k}:</b> {v}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="col-span-2 sm:col-span-4">
              <div className="text-slate-500 mb-1">דוא״ל לסיכומי שיחה (WrapUpAI)</div>
              {editingEmails === null || editingFor !== activeCustomer.id ? (
                <div className="flex items-center gap-2 flex-wrap">
                  {(activeCustomer.emails || []).map((email) => (
                    <span key={email} className="inline-flex items-center gap-1.5 font-mono text-slate-900" dir="ltr">
                      {email}
                      {email.endsWith('@example.com') && (
                        <span className="text-[10px] font-sans px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                          כתובת דוגמה
                        </span>
                      )}
                    </span>
                  ))}
                  <button
                    onClick={() => {
                      setEmailError(null);
                      setEditingFor(activeCustomer.id);
                      setEditingEmails((activeCustomer.emails || []).filter((e) => !e.endsWith('@example.com')).join(', '));
                    }}
                    className="text-blue-700 hover:underline font-medium"
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
                    className="flex-1 min-w-[220px] px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button type="submit" className="px-3 py-1.5 text-xs font-medium bg-[#0F2942] text-white rounded-lg">
                    שמירה
                  </button>
                  <button type="button" onClick={() => setEditingEmails(null)} className="px-3 py-1.5 text-xs text-slate-600">
                    ביטול
                  </button>
                  <span className="w-full text-[11px] text-slate-500">
                    אפשר כמה כתובות מופרדות בפסיק. השארה ריקה = כתובת דוגמה אוטומטית.
                  </span>
                  {emailError && <span className="w-full text-[11px] text-red-700">{emailError}</span>}
                </form>
              )}
            </div>
          </div>
        </section>

        {/* Subtab 1: Returned Business Reports inside Customer Card */}
        {activeSubTab === 'reports' && (
          <>
            {customerReports.length === 0 ? (
              <section className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
                <FileText className="w-8 h-8 text-slate-400 mx-auto" />
                <h3 className="text-base font-semibold text-slate-900">טרם התקבלו דוחות תמלול לכרטיס לקוח זה</h3>
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                  שלחו את אחת מהקלטות השיחה של {activeCustomer.fullName} במרכזיה למערכת התמלול החיצונית — הסיכום המלא והמשימות יוזרמו לכאן אוטומטית.
                </p>
              </section>
            ) : (
              <div className="space-y-6">
                {/* Report selector if customer has multiple reports */}
                {customerReports.length > 1 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {customerReports.map((rep) => (
                      <button
                        key={rep.id}
                        onClick={() => onSelectReport(rep.id)}
                        className={`px-3 py-1.5 text-xs font-mono rounded-lg border transition-colors ${
                          activeReport?.id === rep.id
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {rep.uniqueCallName}
                      </button>
                    ))}
                  </div>
                )}

                {activeReport && (
                  <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    {/* Report Header & Executive Summary */}
                    <div className="p-6 border-b border-slate-200 space-y-4">
                      <div className="flex flex-col gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
                            <ShieldCheck className="w-4 h-4" />
                            <span>דוח עסקי מאומת חתימת HMAC · שויך ישירות לכרטיס הלקוח</span>
                          </div>
                          <h3 className="text-lg font-bold text-slate-900">
                            סיכום שיחה <span className="font-mono text-base">{activeReport.uniqueCallName}</span>
                          </h3>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 flex-wrap">
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
                                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                                  kind === 'business'
                                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                    : 'bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50'
                                }`}
                              >
                                <FileText className="w-3.5 h-3.5" />
                                <span>{kind === 'business' ? 'PDF סיכום ותחושות לקוח (WrapUpAI)' : 'PDF שנשלח ללקוח'}</span>
                              </button>
                            ) : null
                          )}
                          <button
                            onClick={() => onOpenPdf(activeReport.id)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#0F2942] hover:bg-slate-800 text-white rounded-lg transition-colors whitespace-nowrap"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>פתח מסמך PDF</span>
                          </button>
                          <button
                            onClick={() => setShowTranscript((v) => !v)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
                          >
                            <MessageSquareText className="w-3.5 h-3.5" />
                            <span>{showTranscript ? 'הסתר תמלול מלא' : 'הצג תמלול מלא'}</span>
                          </button>
                          <button
                            onClick={() => setActiveSubTab('calendar')}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap"
                          >
                            <Calendar className="w-3.5 h-3.5" />
                            <span>פתח יומן לקוח</span>
                          </button>
                        </div>
                      </div>

                      <div className="text-sm text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-4">
                        <div className="text-xs font-semibold text-slate-500 mb-1">סיכום מנהלים</div>
                        {activeReport.executiveSummary}
                      </div>

                      {activeReport.wrapup && (
                        <div className="text-xs text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2.5">
                          <span className="font-bold tracking-wide">WRAPUP AI · </span>
                          {activeReport.wrapup.delivery}
                        </div>
                      )}

                      <ComplianceAndUpdates token={token} report={activeReport} />

                      <div className="flex items-center gap-2 text-xs text-slate-600 flex-wrap">
                        <Users className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="font-semibold text-slate-700">משתתפים בדוח:</span>
                        {activeReport.participantsDetected.map((p, idx) => (
                          <React.Fragment key={`${p.speakerLabel}-${idx}`}>
                            {idx > 0 && <span aria-hidden="true">·</span>}
                            <span>
                              {p.speakerLabel} ({p.role})
                            </span>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>

                    {/* Section: Topics Breakdown — What Each Side Says */}
                    <div className="p-6 border-b border-slate-200 space-y-5">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-blue-700" />
                        <h4 className="text-base font-bold text-slate-900">
                          פילוח עסקי לפי נושאים — עמדת כל צד בשיחה
                        </h4>
                      </div>

                      <div className="divide-y divide-slate-200">
                        {activeReport.topics.map((topic, idx) => (
                          <div key={idx} className="py-4 first:pt-0 last:pb-0 space-y-3">
                            <div>
                              <h5 className="text-sm font-bold text-slate-900">
                                {idx + 1}. {topic.topicTitle}
                              </h5>
                              <p className="text-xs text-slate-600 mt-1 leading-relaxed">{topic.topicSummary}</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              {topic.participantStatements.map((stmt, sIdx) => (
                                <div
                                  key={sIdx}
                                  className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2"
                                >
                                  <div className="text-xs font-bold text-slate-900">
                                    {stmt.speakerLabel}{' '}
                                    <span className="font-normal text-slate-500">· {stmt.role}</span>
                                  </div>
                                  <p className="text-xs text-slate-700 leading-relaxed">
                                    {stmt.statementSummary}
                                  </p>
                                  {stmt.keyPoints.length > 0 && (
                                    <ul className="space-y-1 pt-1 border-t border-slate-200/70">
                                      {stmt.keyPoints.map((pt, pIdx) => (
                                        <li key={pIdx} className="text-xs text-slate-600 flex items-start gap-1.5">
                                          <span className="text-blue-700 mt-0.5">•</span>
                                          <span>{pt}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Section: Structured Action Items -> Add to Customer Calendar */}
                    <div className="p-6 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <h4 className="text-base font-bold text-slate-900">משימות להמשך בתבנית מסודרת</h4>
                          <p className="text-xs text-slate-500">
                            בחרו מועד ושבצו בלחיצה ישירות לתוך יומן הלקוח במערכת הפנימית
                          </p>
                        </div>

                        {activeReport.actionItems.some((t) => !t.addedToCalendar) && (
                          <button
                            onClick={() => handleAddAll(activeReport.id)}
                            disabled={busyBatchReportId === activeReport.id}
                            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                          >
                            {busyBatchReportId === activeReport.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CalendarPlus className="w-3.5 h-3.5" />
                            )}
                            <span>הוסף את כל המשימות ליומן הלקוח</span>
                          </button>
                        )}
                      </div>

                      <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                        {activeReport.actionItems.map((task) => {
                          const editValues = editingDateMap[task.taskId] || {
                            date: task.suggestedDate,
                            time: task.suggestedTime,
                          };
                          return (
                            <div
                              key={task.taskId}
                              className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white"
                            >
                              <div className="space-y-1 flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-bold text-slate-900">{task.title}</span>
                                  <span className="text-slate-300" aria-hidden="true">·</span>
                                  <span className={`text-xs ${priorityStyle(task.priority)}`}>
                                    עדיפות {task.priority}
                                  </span>
                                  <span className="text-slate-300" aria-hidden="true">·</span>
                                  <span className="text-xs text-slate-500">{task.category}</span>
                                </div>
                                <p className="text-xs text-slate-600 leading-relaxed">{task.description}</p>
                                <div className="text-xs text-slate-500">אחראי לביצוע: {task.owner}</div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0 flex-wrap">
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
                                  className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md bg-slate-50 disabled:opacity-60"
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
                                  className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md bg-slate-50 disabled:opacity-60"
                                />

                                {task.addedToCalendar ? (
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg whitespace-nowrap">
                                    <CalendarCheck2 className="w-3.5 h-3.5" />
                                    <span>נוסף ליומן הלקוח</span>
                                  </span>
                                ) : (
                                  <button
                                    onClick={() =>
                                      handleAddSingleTask(
                                        activeReport.id,
                                        task.taskId,
                                        task.suggestedDate,
                                        task.suggestedTime
                                      )
                                    }
                                    disabled={busyTaskKey === task.taskId}
                                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-[#0F2942] hover:bg-slate-800 disabled:opacity-60 text-white rounded-lg transition-colors whitespace-nowrap"
                                  >
                                    {busyTaskKey === task.taskId ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <CalendarPlus className="w-3.5 h-3.5" />
                                    )}
                                    <span>הוסף ליומן הלקוח</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Full Diarized Transcript (Collapsible) */}
                    {showTranscript && (
                      <div className="p-6 border-t border-slate-200 bg-slate-50 space-y-3">
                        <h4 className="text-sm font-bold text-slate-900">תמלול מלא לפי דוברים</h4>
                        <div className="space-y-2.5">
                          {activeReport.transcript.map((line, idx) => (
                            <div
                              key={idx}
                              className="bg-white border border-slate-200 rounded-lg px-4 py-3 text-xs space-y-1"
                            >
                              <div className="flex items-center gap-2 text-slate-500">
                                <span className="font-mono tabular-nums">{line.timestamp}</span>
                                <span aria-hidden="true">·</span>
                                <span className="font-bold text-slate-900">{line.speakerLabel}</span>
                                <span aria-hidden="true">·</span>
                                <span>{line.role}</span>
                              </div>
                              <p className="text-sm text-slate-800 leading-relaxed">{line.text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}
          </>
        )}

        {/* Subtab 2: Customer Calendar */}
        {activeSubTab === 'calendar' && (
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">יומן הלקוח — {activeCustomer.fullName}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  משימות המשך, ועדות וזימונים ששויכו מתוך דוחות המרכזיה
                </p>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-600">
                {customerEvents.filter((e) => !e.completed).length} משימות פתוחות
              </span>
            </div>

            {customerEvents.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <Calendar className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-sm font-medium text-slate-700">יומן הלקוח ריק כרגע</p>
                <p className="text-xs text-slate-500">
                  הוסיפו משימות מתוך דוחות התמלול שהתקבלו כדי לשבץ מעקב ביומן.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                {customerEvents.map((evt) => (
                  <div
                    key={evt.id}
                    className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                      evt.completed ? 'bg-slate-50/70' : 'bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <button
                        onClick={() => onToggleEventCompleted(evt.id, !evt.completed)}
                        className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0 ${
                          evt.completed
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'border-slate-300 hover:border-blue-600 bg-white'
                        }`}
                        title={evt.completed ? 'סמן כפתוחה' : 'סמן כהושלמה'}
                      >
                        {evt.completed && <Check className="w-3.5 h-3.5" />}
                      </button>

                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-sm font-semibold ${
                              evt.completed ? 'line-through text-slate-400' : 'text-slate-900'
                            }`}
                          >
                            {evt.title}
                          </span>
                          <span className="text-slate-300" aria-hidden="true">·</span>
                          <span className="text-xs text-slate-500">{evt.category}</span>
                          <span className="text-slate-300" aria-hidden="true">·</span>
                          <span className={`text-xs ${priorityStyle(evt.priority)}`}>{evt.priority}</span>
                        </div>
                        <p className="text-xs text-slate-600">{evt.description}</p>
                        <div className="text-xs text-slate-500 flex items-center gap-2">
                          <span>אחראי: {evt.owner}</span>
                          {evt.reportId && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono">מקור: {evt.reportId}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                        <Clock className="w-3.5 h-3.5" />
                      </div>
                      <input
                        type="date"
                        value={evt.date}
                        onChange={(e) => onRescheduleEvent(evt.id, e.target.value, evt.time)}
                        className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md bg-slate-50"
                      />
                      <input
                        type="time"
                        value={evt.time}
                        onChange={(e) => onRescheduleEvent(evt.id, evt.date, e.target.value)}
                        className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md bg-slate-50"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Add New Customer Modal */}
      {showAddCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-[#0F2942]" />
                <h3 className="text-base font-bold text-slate-900">פתיחת כרטיס לקוח חדש במערכת הראשית</h3>
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
                  <label className="block text-xs font-medium text-slate-700 mb-1">שם מלא *</label>
                  <input
                    type="text"
                    required
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    placeholder="לדוגמה: שירה לוי"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">מספר זהות *</label>
                  <input
                    type="text"
                    required
                    value={newNationalId}
                    onChange={(e) => setNewNationalId(e.target.value)}
                    placeholder="9 ספרות"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">טלפון *</label>
                  <input
                    type="tel"
                    required
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="050-0000000"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    דוא״ל לסיכומי שיחה (WrapUpAI) · אפשר כמה, מופרדים בפסיק
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={newEmails}
                    onChange={(e) => setNewEmails(e.target.value)}
                    placeholder="name@example.com, partner@example.com"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">יישוב מגורים</label>
                  <input
                    type="text"
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">מחלקה / תחום תביעה</label>
                  <select
                    value={newDepartment}
                    onChange={(e) => setNewDepartment(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {INSTITUTIONAL_DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">סניף מטפל</label>
                  <input
                    type="text"
                    value={newBranch}
                    onChange={(e) => setNewBranch(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">רכז/ת מטפל/ת</label>
                  <input
                    type="text"
                    value={newHandler}
                    onChange={(e) => setNewHandler(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">סטטוס תיק ראשוני</label>
                  <input
                    type="text"
                    value={newCaseStatus}
                    onChange={(e) => setNewCaseStatus(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              {createError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {createError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddCustomer(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  disabled={creatingCustomer}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white rounded-lg"
                >
                  {creatingCustomer && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{creatingCustomer ? 'פותח כרטיס...' : 'צור כרטיס לקוח'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

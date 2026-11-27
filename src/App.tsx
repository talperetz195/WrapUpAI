import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CalendarPlus,
  CheckCircle2,
  FileText,
  Headphones,
  Lock,
  LogOut,
  Menu,
  ShieldCheck,
  Smile,
  Users,
  X,
} from 'lucide-react';
import {
  addAllReportTasksToCalendar,
  addTaskToCalendar,
  fetchBootstrap,
  getAuthStatus,
  markNotificationsRead,
  transferRecordingToExternal,
  updateCalendarEvent,
  type AuthStatusResponse,
} from './api';
import { AuditLogView } from './components/AuditLogView';
import { AuthGate } from './components/AuthGate';
import { CustomerCardView } from './components/CustomerCardView';
import { CustomerSentimentView } from './components/wrapup/CustomerSentimentView';
import { HomeDashboard, buildRows } from './components/wrapup/HomeDashboard';
import { ExternalSystemView } from './components/ExternalSystemView';
import { NotificationDrawer } from './components/NotificationDrawer';
import { PbxCenter } from './components/PbxCenter';
import { PdfViewerModal } from './components/PdfViewerModal';
import type { SystemNotification, SystemSnapshot } from './types';

type ActiveSection = 'home' | 'sentiment' | 'pbx' | 'external' | 'customers' | 'audit';

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [operator, setOperator] = useState<{ name: string; role: string } | null>(null);

  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<ActiveSection>('home');
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>('rec-001');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('cust-101');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [transferringId, setTransferringId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [liveToast, setLiveToast] = useState<SystemNotification | null>(null);
  const [toastBusy, setToastBusy] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [pdfReportId, setPdfReportId] = useState<string | null>(null);

  useEffect(() => {
    getAuthStatus()
      .then(setAuthStatus)
      .catch(() => setAuthStatus({ envConfigured: false, claimed: false }));
  }, []);

  const loadBootstrap = useCallback(async (authToken: string) => {
    try {
      const data = await fetchBootstrap(authToken);
      setSnapshot(data);
      setLoadingError(null);
    } catch (err) {
      setLoadingError(err instanceof Error ? err.message : 'שגיאה בטעינת נתוני המערכת.');
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadBootstrap(token);
  }, [token, loadBootstrap]);

  // Authenticated SSE stream over fetch (keeps Bearer token strictly out of URLs)
  useEffect(() => {
    if (!token) return;
    const abortController = new AbortController();

    const connectSse = async () => {
      try {
        const res = await fetch('/api/internal/events', {
          headers: { Authorization: `Bearer ${token}` },
          signal: abortController.signal,
        });
        if (!res.ok || !res.body) return;

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';

          for (const frame of frames) {
            if (!frame.trim() || frame.startsWith(':')) continue;
            const lines = frame.split('\n');
            let eventType = 'message';
            let dataStr = '';
            for (const line of lines) {
              if (line.startsWith('event:')) eventType = line.slice(6).trim();
              if (line.startsWith('data:')) dataStr += line.slice(5).trim();
            }
            if (!dataStr) continue;

            try {
              const parsed = JSON.parse(dataStr);
              if (eventType === 'state_update') {
                setSnapshot(parsed as SystemSnapshot);
              } else if (eventType === 'notification') {
                const notif = parsed as SystemNotification;
                setLiveToast(notif);
              }
            } catch {
              // Ignore malformed keepalive frames
            }
          }
        }
      } catch {
        // Stream aborted or disconnected
      }
    };

    void connectSse();
    return () => {
      abortController.abort();
    };
  }, [token]);

  // Safety fallback polling while any job is actively analyzing externally
  const hasActiveExternalJobs = useMemo(() => {
    if (!snapshot) return false;
    return snapshot.recordings.some(
      (r) => r.status === 'analyzing_external' || r.status === 'transferring'
    );
  }, [snapshot]);

  useEffect(() => {
    if (!token || !hasActiveExternalJobs) return;
    const timer = setInterval(() => {
      void loadBootstrap(token);
    }, 2500);
    return () => clearInterval(timer);
  }, [token, hasActiveExternalJobs, loadBootstrap]);

  const unreadCount = useMemo(
    () => (snapshot ? snapshot.notifications.filter((n) => !n.read).length : 0),
    [snapshot]
  );

  const handleTransferToExternal = async (recordingId: string, sendCustomerEmail = false) => {
    if (!token) return;
    setTransferringId(recordingId);
    setLoadingError(null);
    try {
      const res = await transferRecordingToExternal(token, recordingId, sendCustomerEmail);
      setSnapshot(res.snapshot);
      setActionFeedback('הקובץ הועבר בצורה מאובטחת למערכת התמלול החיצונית. התראה תתקבל עם סיום הניתוח.');
      setTimeout(() => setActionFeedback(null), 5000);
    } catch (err) {
      setLoadingError(err instanceof Error ? err.message : 'שגיאה בהעברת ההקלטה למערכת החיצונית.');
    } finally {
      setTransferringId(null);
    }
  };

  // WrapUpAI: מעבר לדף תחושות הלקוח / להקלטה במרכזייה
  const scrollToTop = () => {
    window.scrollTo({ top: 0 });
    document.querySelectorAll('main, [data-scroll-root]').forEach((el) => el.scrollTo({ top: 0 }));
  };
  const handleOpenSentiment = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setActiveSection('sentiment');
    setMobileNavOpen(false);
    scrollToTop();
  };
  const handleOpenRecording = (recordingId: string) => {
    setSelectedRecordingId(recordingId);
    setActiveSection('pbx');
    setMobileNavOpen(false);
  };

  const handleOpenCustomerReport = (customerId: string, reportId?: string) => {
    setSelectedCustomerId(customerId);
    setSelectedReportId(reportId || null);
    setActiveSection('customers');
    setMobileNavOpen(false);
  };

  const handleAddTaskToCalendar = async (
    reportId: string,
    taskId: string,
    customDate?: string,
    customTime?: string
  ) => {
    if (!token) return;
    const next = await addTaskToCalendar(token, reportId, taskId, customDate, customTime);
    setSnapshot(next);
  };

  const handleAddAllTasksToCalendar = async (reportId: string) => {
    if (!token) return;
    const res = await addAllReportTasksToCalendar(token, reportId);
    setSnapshot(res);
    setActionFeedback(`נוספו ${res.addedCount} משימות ליומן הלקוח בהצלחה.`);
    setTimeout(() => setActionFeedback(null), 4000);
  };

  const handleAddAllFromNotification = async (notification: SystemNotification) => {
    if (!token || !notification.reportId) return;
    const res = await addAllReportTasksToCalendar(token, notification.reportId);
    setSnapshot(res);
    if (notification.customerId) {
      setSelectedCustomerId(notification.customerId);
      setSelectedReportId(notification.reportId);
    }
    setActionFeedback(`שובצו ${res.addedCount} משימות ביומן של ${notification.customerName || 'הלקוח'}.`);
    setTimeout(() => setActionFeedback(null), 4000);
  };

  const handleToastScheduleCalendar = async () => {
    if (!liveToast) return;
    setToastBusy(true);
    try {
      await handleAddAllFromNotification(liveToast);
      if (token) {
        const next = await markNotificationsRead(token, liveToast.id);
        setSnapshot(next);
      }
      setLiveToast(null);
      if (liveToast.customerId) {
        handleOpenCustomerReport(liveToast.customerId, liveToast.reportId);
      }
    } finally {
      setToastBusy(false);
    }
  };

  const handleToggleEventCompleted = async (eventId: string, completed: boolean) => {
    if (!token) return;
    const next = await updateCalendarEvent(token, eventId, { completed });
    setSnapshot(next);
  };

  const handleRescheduleEvent = async (eventId: string, date: string, time: string) => {
    if (!token) return;
    const next = await updateCalendarEvent(token, eventId, { date, time });
    setSnapshot(next);
  };

  const handleMarkAllRead = async () => {
    if (!token) return;
    const next = await markNotificationsRead(token);
    setSnapshot(next);
  };

  const handleLogout = () => {
    setToken(null);
    setOperator(null);
    setSnapshot(null);
    setLiveToast(null);
  };

  if (!authStatus) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">
        טוען סביבה מאובטחת...
      </div>
    );
  }

  if (!token || !operator) {
    return (
      <AuthGate
        status={authStatus}
        onAuthenticated={(newToken, op) => {
          setToken(newToken);
          setOperator(op);
        }}
      />
    );
  }

  const navItems: Array<{ id: ActiveSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'home', label: 'דף הבית · תחושות לקוחות', icon: Smile },
    { id: 'pbx', label: 'מרכזיה והקלטות', icon: Headphones },
    { id: 'external', label: 'מערכת תמלול חיצונית', icon: Lock },
    { id: 'customers', label: 'כרטיסי לקוחות ויומן', icon: Users },
    { id: 'audit', label: 'בקרת אבטחה והרשאות', icon: ShieldCheck },
  ];

  const sectionTitleMap: Record<ActiveSection, string> = {
    home: 'דף הבית / תחושות הלקוחות',
    sentiment: 'דף הבית / תחושות הלקוח בשיחה',
    pbx: 'המערכת הפנימית / מרכזיית הקלטות שיחה',
    external: 'המערכת החיצונית / תמלול וניתוח אוטומטי מוגבל',
    customers: 'המערכת הפנימית / כרטיסי לקוחות ויומן',
    audit: 'שער אבטחה / יומן בקרת גישה והרשאות',
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* RTL Right Sidebar */}
      <aside
        className={`fixed inset-y-0 right-0 z-40 w-64 bg-[#0F2942] text-white flex flex-col transition-transform lg:static lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <div className="text-base font-bold tracking-tight">מוסד תגמולים וביטוח</div>
            <div className="text-xs text-slate-300 mt-0.5">מרכזיה ותיקי מבוטחים</div>
          </div>
          <button
            onClick={() => setMobileNavOpen(false)}
            className="lg:hidden p-1 text-slate-300 hover:text-white"
            aria-label="סגור תפריט"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id || (item.id === 'home' && activeSection === 'sentiment');
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveSection(item.id);
                  setMobileNavOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-white/15 text-white'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10 space-y-3">
          <div className="text-xs">
            <div className="text-slate-400">נציג מחובר</div>
            <div className="font-semibold text-white mt-0.5 truncate">{operator.name}</div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium bg-white/10 hover:bg-white/15 text-slate-100 rounded-lg transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>נעילת מערכת והתנתקות</span>
          </button>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Breadcrumb + Primary Actions */}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-6 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200"
              aria-label="פתח תפריט ניווט"
            >
              <Menu className="w-4 h-4" />
            </button>
            <h1 className="text-sm sm:text-base font-bold text-slate-900 truncate">
              {sectionTitleMap[activeSection]}
            </h1>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setNotificationsOpen(true)}
              className="relative inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Bell className="w-4 h-4 text-slate-600" />
              <span>התראות</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 text-[11px] font-mono tabular-nums font-bold bg-blue-700 text-white rounded">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Feedback / Error Banners */}
        <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto space-y-5">
          {loadingError && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-4">
              <span>{loadingError}</span>
              <button
                onClick={() => setLoadingError(null)}
                className="text-xs font-medium text-red-700 hover:underline shrink-0"
              >
                סגור
              </button>
            </div>
          )}

          {actionFeedback && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{actionFeedback}</span>
              </div>
              <button
                onClick={() => setActionFeedback(null)}
                className="text-xs font-medium text-emerald-700 hover:underline shrink-0"
              >
                סגור
              </button>
            </div>
          )}

          {!snapshot ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
              טוען נתוני מרכזיה וכרטיסי לקוחות...
            </div>
          ) : (
            <>
              {activeSection === 'home' && (
                <HomeDashboard
                  operatorName={operator.name}
                  customers={snapshot.customers}
                  reports={snapshot.reports}
                  recordings={snapshot.recordings}
                  onOpenSentiment={handleOpenSentiment}
                  onOpenCustomerCard={(cid) => handleOpenCustomerReport(cid)}
                  onOpenRecording={handleOpenRecording}
                />
              )}

              {activeSection === 'sentiment' &&
                (() => {
                  const row = buildRows(snapshot.customers, snapshot.reports, snapshot.recordings).find(
                    (r) => r.customer.id === selectedCustomerId
                  );
                  return row ? (
                    <CustomerSentimentView
                      token={token}
                      customer={row.customer}
                      report={row.sentiment ? row.report : undefined}
                      onBack={() => {
                        setActiveSection('home');
                        scrollToTop();
                      }}
                      onOpenCustomerCard={handleOpenCustomerReport}
                    />
                  ) : null;
                })()}

              {activeSection === 'pbx' && (
                <PbxCenter
                  token={token}
                  recordings={snapshot.recordings}
                  customers={snapshot.customers}
                  reports={snapshot.reports}
                  selectedRecordingId={selectedRecordingId}
                  onSelectRecording={setSelectedRecordingId}
                  onTransferToExternal={handleTransferToExternal}
                  onOpenCustomerReport={handleOpenCustomerReport}
                  onOpenPdf={setPdfReportId}
                  onSnapshotUpdate={setSnapshot}
                  transferringId={transferringId}
                />
              )}

              {activeSection === 'external' && (
                <ExternalSystemView
                  transferJobs={snapshot.transferJobs}
                  reports={snapshot.reports}
                  onOpenCustomerReport={handleOpenCustomerReport}
                  onOpenPdf={setPdfReportId}
                />
              )}

              {activeSection === 'customers' && (
                <CustomerCardView
                  token={token}
                  customers={snapshot.customers}
                  reports={snapshot.reports}
                  calendarEvents={snapshot.calendarEvents}
                  selectedCustomerId={selectedCustomerId}
                  selectedReportId={selectedReportId}
                  onSelectCustomer={(cid) => {
                    setSelectedCustomerId(cid);
                    setSelectedReportId(null);
                  }}
                  onSelectReport={setSelectedReportId}
                  onOpenPdf={setPdfReportId}
                  onCustomerCreated={(newCustomerId, nextSnapshot) => {
                    setSnapshot(nextSnapshot);
                    setSelectedCustomerId(newCustomerId);
                    setSelectedReportId(null);
                    setActionFeedback('כרטיס הלקוח החדש נפתח ונשמר במערכת הראשית.');
                    setTimeout(() => setActionFeedback(null), 4000);
                  }}
                  onAddTaskToCalendar={handleAddTaskToCalendar}
                  onAddAllTasksToCalendar={handleAddAllTasksToCalendar}
                  onToggleEventCompleted={handleToggleEventCompleted}
                  onRescheduleEvent={handleRescheduleEvent}
                />
              )}

              {activeSection === 'audit' && <AuditLogView logs={snapshot.auditLogs} />}
            </>
          )}
        </main>
      </div>

      {/* Live Notification Toast with One-Click "Add to Customer Calendar" Button */}
      {liveToast && (
        <div className="fixed bottom-5 left-5 z-50 w-full max-w-md bg-white border border-slate-300 rounded-xl shadow-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 mt-0.5">
                <Bell className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-bold text-slate-900">{liveToast.title}</div>
                <p className="text-xs text-slate-600 leading-relaxed">{liveToast.message}</p>
              </div>
            </div>
            <button
              onClick={() => setLiveToast(null)}
              className="p-1 text-slate-400 hover:text-slate-700 rounded"
              aria-label="סגור התראה"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {liveToast.type === 'report_returned' && liveToast.customerId && (
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button
                onClick={handleToastScheduleCalendar}
                disabled={toastBusy}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white rounded-lg transition-colors whitespace-nowrap"
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                <span>{toastBusy ? 'מוסיף ליומן...' : 'הוסף ליומן הלקוח'}</span>
              </button>

              {liveToast.reportId && (
                <button
                  onClick={() => {
                    setPdfReportId(liveToast.reportId!);
                    setLiveToast(null);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#0F2942] hover:bg-slate-800 text-white rounded-lg transition-colors whitespace-nowrap"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>פתח PDF</span>
                </button>
              )}

              <button
                onClick={() => {
                  handleOpenCustomerReport(liveToast.customerId!, liveToast.reportId);
                  setLiveToast(null);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>פתח כרטיס לקוח</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Notification Drawer */}
      <NotificationDrawer
        open={notificationsOpen}
        notifications={snapshot?.notifications || []}
        onClose={() => setNotificationsOpen(false)}
        onMarkAllRead={handleMarkAllRead}
        onAddAllFromNotification={handleAddAllFromNotification}
        onOpenReport={handleOpenCustomerReport}
        onOpenPdf={setPdfReportId}
      />

      {/* Structured PDF Document Viewer Modal */}
      <PdfViewerModal
        report={snapshot?.reports.find((r) => r.id === pdfReportId) || null}
        customer={snapshot?.customers.find(
          (c) => c.id === snapshot.reports.find((r) => r.id === pdfReportId)?.customerId
        )}
        onClose={() => setPdfReportId(null)}
        onAddAllTasksToCalendar={handleAddAllTasksToCalendar}
      />
    </div>
  );
}

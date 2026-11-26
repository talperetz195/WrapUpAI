import React, { useState } from 'react';
import { Bell, CalendarPlus, CheckCheck, FileText, Loader2, X } from 'lucide-react';
import type { SystemNotification } from '../types';

interface NotificationDrawerProps {
  open: boolean;
  notifications: SystemNotification[];
  onClose: () => void;
  onMarkAllRead: () => Promise<void>;
  onAddAllFromNotification: (notification: SystemNotification) => Promise<void>;
  onOpenReport: (customerId: string, reportId?: string) => void;
  onOpenPdf: (reportId: string) => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  open,
  notifications,
  onClose,
  onMarkAllRead,
  onAddAllFromNotification,
  onOpenReport,
  onOpenPdf,
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addedReportIds, setAddedReportIds] = useState<Record<string, boolean>>({});

  if (!open) return null;

  const handleScheduleAll = async (notification: SystemNotification) => {
    setBusyId(notification.id);
    try {
      await onAddAllFromNotification(notification);
      if (notification.reportId) {
        setAddedReportIds((prev) => ({ ...prev, [notification.reportId!]: true }));
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30">
      <div className="w-full max-w-md bg-white h-full border-r border-slate-200 shadow-xl flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-blue-700" />
            <h2 className="text-base font-bold text-slate-900">התראות מערכת ודוחות חוזרים</h2>
          </div>
          <div className="flex items-center gap-2">
            {notifications.some((n) => !n.read) && (
              <button
                onClick={onMarkAllRead}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline px-2 py-1"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>סמן הכל כנקרא</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
              aria-label="סגור חלונית התראות"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
          {notifications.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Bell className="w-7 h-7 text-slate-300 mx-auto" />
              <p className="text-sm font-medium text-slate-700">אין התראות חדשות</p>
              <p className="text-xs text-slate-500">
                כאשר המערכת החיצונית תחזיר דוח סיכום ומשימות, תופיע כאן התראה עם כפתור שיבוץ מהיר ליומן הלקוח.
              </p>
            </div>
          ) : (
            notifications.map((n) => {
              const isScheduled = Boolean(n.reportId && addedReportIds[n.reportId]);
              return (
                <div key={n.id} className={`p-4 space-y-3 ${n.read ? 'bg-white' : 'bg-blue-50/40'}`}>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900">{n.title}</span>
                      <span className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
                        {new Intl.DateTimeFormat('he-IL', {
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(new Date(n.createdAt))}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{n.message}</p>
                  </div>

                  {n.type === 'report_returned' && n.customerId && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => handleScheduleAll(n)}
                        disabled={busyId === n.id || isScheduled}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 disabled:bg-emerald-700 text-white rounded-lg transition-colors whitespace-nowrap"
                      >
                        {busyId === n.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CalendarPlus className="w-3.5 h-3.5" />
                        )}
                        <span>{isScheduled ? 'המשימות נוספו ליומן הלקוח' : 'הוסף ליומן הלקוח'}</span>
                      </button>

                      {n.reportId && (
                        <button
                          onClick={() => {
                            onOpenPdf(n.reportId!);
                            onClose();
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#0F2942] hover:bg-slate-800 text-white rounded-lg transition-colors whitespace-nowrap"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>פתח PDF</span>
                        </button>
                      )}

                      <button
                        onClick={() => {
                          onOpenReport(n.customerId!, n.reportId);
                          onClose();
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>כרטיס לקוח</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

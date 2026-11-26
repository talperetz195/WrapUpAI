import React from 'react';
import { CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { AuditLogEntry } from '../types';

interface AuditLogViewProps {
  logs: AuditLogEntry[];
}

function systemLabel(system: AuditLogEntry['system']): string {
  switch (system) {
    case 'internal_pbx':
      return 'מרכזיה פנימית';
    case 'security_gateway':
      return 'שער אבטחה וטוקנים';
    case 'external_analytics':
      return 'מערכת תמלול חיצונית';
    case 'customer_crm':
      return 'כרטיס לקוח ויומן';
  }
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

export const AuditLogView: React.FC<AuditLogViewProps> = ({ logs }) => {
  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">יומן אבטחה, בקרת גישה והפרדת רשויות</h2>
          <p className="text-xs text-slate-600 mt-1">
            תיעוד מלא של גישות להקלטות, הנפקת טוקנים חד-פעמיים, הסרת פרטים מזהים, חסימות גישה ואימות חתימות חוזרות.
          </p>
        </div>
        <div className="text-xs font-mono tabular-nums text-slate-600 shrink-0">
          {logs.length} רשומות אבטחה מאומתות
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">זמן אירוע</th>
                <th className="py-3 px-4">רכיב מערכת</th>
                <th className="py-3 px-4">גורם מבצע</th>
                <th className="py-3 px-4">פעולה</th>
                <th className="py-3 px-4">משאב</th>
                <th className="py-3 px-4">תוצאה</th>
                <th className="py-3 px-4">פירוט אבטחה</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {logs.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                    {formatTime(entry.timestamp)}
                  </td>
                  <td className="py-3 px-4 font-medium text-slate-800 whitespace-nowrap">
                    {systemLabel(entry.system)}
                  </td>
                  <td className="py-3 px-4 text-slate-700 whitespace-nowrap">{entry.actor}</td>
                  <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">{entry.action}</td>
                  <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">{entry.resource}</td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {entry.outcome === 'blocked' ? (
                      <span className="inline-flex items-center gap-1 font-medium text-red-700">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>נחסם</span>
                      </span>
                    ) : entry.outcome === 'verified' ? (
                      <span className="inline-flex items-center gap-1 font-medium text-blue-700">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>אומת קריפטוגרפית</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>מאושר</span>
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-slate-600 max-w-md">{entry.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

/**
 * WrapUpAI · בקרת ציות רגולטורית (רמזור) + עדכוני שדות בתיק הלקוח, בתוך הדוח בכרטיס הלקוח.
 */
import React, { useState } from 'react';
import { commitFieldUpdates, decideFieldUpdate } from '../../api';
import type { CallAnalysisReport, WrapUpFieldUpdate } from '../../types';

const LIGHT = {
  green: { color: '#2F9E6A', bg: '#E7F6EE', title: 'תקין', sub: 'כל בדיקות הציות עברו' },
  yellow: { color: '#C77A12', bg: '#FFF4D6', title: 'דורש אימות', sub: 'יש פרטים שצריך לוודא מול הלקוח' },
  red: { color: '#E5534B', bg: '#FDECEC', title: 'חסר רכיב חובה', sub: 'יש בדיקה שלא בוצעה בשיחה' },
} as const;
const CHECK = {
  pass: { dot: '#2F9E6A', label: 'תקין' },
  warning: { dot: '#E0A43A', label: 'לאימות' },
  fail: { dot: '#E5534B', label: 'חסר' },
} as const;

function TrafficLight({ overall }: { overall: 'green' | 'yellow' | 'red' }) {
  return (
    <div className="flex flex-col gap-1.5 bg-[#26282E] rounded-[14px] p-2 shrink-0" aria-label={`רמזור ציות: ${LIGHT[overall].title}`}>
      {(['red', 'yellow', 'green'] as const).map((c) => (
        <span
          key={c}
          className="w-6 h-6 rounded-full"
          style={{ background: c === overall ? LIGHT[c].color : '#4A4D55', boxShadow: c === overall ? `0 0 12px ${LIGHT[c].color}` : 'none' }}
        />
      ))}
    </div>
  );
}

export const ComplianceAndUpdates: React.FC<{ token: string; report: CallAnalysisReport }> = ({ token, report }) => {
  const w = report.wrapup;
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!w || (!w.compliance && !w.fieldUpdates?.length && !w.intents?.length)) return null;

  const decide = async (u: WrapUpFieldUpdate, action: 'approve' | 'reject' | 'reset', value?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await decideFieldUpdate(token, report.id, u.id, action, value);
      setEditing((e) => {
        const next = { ...e };
        delete next[u.id];
        return next;
      });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'שגיאה');
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    setBusy(true);
    try {
      const r = await commitFieldUpdates(token, report.id);
      setMsg(`נשמרו ${r.saved} עדכונים בתיק הלקוח`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'שגיאה');
    } finally {
      setBusy(false);
    }
  };
  const updates = w.fieldUpdates || [];
  const approvedCount = updates.filter((u) => u.status === 'approved').length;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {w.compliance && (
        <section className="rounded-xl border p-4 space-y-3" style={{ background: LIGHT[w.compliance.overall].bg, borderColor: LIGHT[w.compliance.overall].color }}>
          <div className="flex items-center gap-3">
            <TrafficLight overall={w.compliance.overall} />
            <div>
              <div className="text-xs font-bold tracking-wide text-slate-500">בקרת ציות רגולטורית</div>
              <div className="text-lg font-extrabold" style={{ color: LIGHT[w.compliance.overall].color }}>
                {LIGHT[w.compliance.overall].title}
              </div>
              <div className="text-xs text-slate-600">{LIGHT[w.compliance.overall].sub}</div>
            </div>
          </div>
          <ul className="space-y-2">
            {w.compliance.checks.map((c, i) => (
              <li key={i} className="bg-white rounded-lg px-3 py-2 text-xs space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHECK[c.status].dot }} />
                  <span className="font-bold text-slate-900">{c.check}</span>
                  <span className="mr-auto font-bold" style={{ color: CHECK[c.status].dot }}>
                    {CHECK[c.status].label}
                  </span>
                </div>
                {c.note.trim() && <div className="text-slate-600">{c.note}</div>}
                <div className="text-slate-500 italic">"{c.evidence}"</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(updates.length > 0 || (w.intents?.length ?? 0) > 0) && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div>
            <div className="text-xs font-bold tracking-wide text-slate-500">WRAPUP AI</div>
            <div className="text-lg font-extrabold text-slate-900">עדכוני שדות בתיק הלקוח</div>
            <div className="text-xs text-slate-600">סיכון נמוך נשמר אוטומטית. סכומים, שינויי פוליסה ופרטים לא ודאיים נעולים לאישור שלך.</div>
          </div>
          <ul className="space-y-2">
            {updates.map((u) => {
              const saved = u.status === 'saved' || u.status === 'auto_approved';
              const isEditing = u.id in editing;
              return (
                <li
                  key={u.id}
                  className="rounded-lg px-3 py-2.5 text-xs border"
                  style={{
                    background: saved ? '#E7F6EE' : u.status === 'approved' ? '#EEF0FF' : u.status === 'rejected' ? '#F4F5F7' : '#FFF8E6',
                    borderColor: saved ? '#A6DDBE' : u.status === 'approved' ? '#C6C1FA' : '#F1D9A0',
                  }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-900">{u.label}:</span>
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editing[u.id]}
                        onChange={(e) => setEditing((x) => ({ ...x, [u.id]: e.target.value }))}
                        className="px-2 py-1 border border-slate-300 rounded font-mono text-xs"
                      />
                    ) : (
                      <span className={`font-mono ${u.status === 'rejected' ? 'line-through text-slate-400' : 'text-slate-900'}`}>{u.newValue}</span>
                    )}
                    {!u.certain && !saved && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">לא ודאי</span>}
                    <span className="mr-auto font-bold">
                      {saved && (
                        <span className="text-emerald-700">
                          ✓ {u.status === 'auto_approved' || u.decidedBy?.startsWith('WrapUpAI') ? 'אושר אוטומטית ונשמר' : `נשמר ע״י ${u.decidedBy}`}
                        </span>
                      )}
                      {u.status === 'pending' && <span className="text-amber-700">🔒 ממתין לאישור הנציג</span>}
                      {u.status === 'approved' && <span className="text-indigo-700">✓ אושר, ממתין לשמירה</span>}
                      {u.status === 'rejected' && <span className="text-slate-500">נדחה</span>}
                    </span>
                  </div>
                  <div className="text-slate-500 italic mt-0.5">"{u.evidence}"</div>
                  {!saved && (
                    <div className="flex gap-2 mt-2">
                      {isEditing ? (
                        <>
                          <button disabled={busy} onClick={() => decide(u, 'approve', editing[u.id])} className="px-3 py-1 rounded-md bg-[#5B4CF0] text-white font-semibold">
                            שמור ואשר
                          </button>
                          <button onClick={() => setEditing((e) => { const n = { ...e }; delete n[u.id]; return n; })} className="px-3 py-1 rounded-md text-slate-600">
                            ביטול
                          </button>
                        </>
                      ) : u.status === 'pending' ? (
                        <>
                          <button disabled={busy} onClick={() => decide(u, 'approve')} className="px-3 py-1 rounded-md bg-[#5B4CF0] text-white font-semibold">
                            אשר
                          </button>
                          <button onClick={() => setEditing((e) => ({ ...e, [u.id]: u.newValue }))} className="px-3 py-1 rounded-md bg-white border border-[#5B4CF0] text-[#5B4CF0] font-semibold">
                            ערוך
                          </button>
                          <button disabled={busy} onClick={() => decide(u, 'reject')} className="px-3 py-1 rounded-md text-slate-600">
                            דחה
                          </button>
                        </>
                      ) : (
                        <button disabled={busy} onClick={() => decide(u, 'reset')} className="px-3 py-1 rounded-md text-slate-600 underline">
                          בטל החלטה
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {(w.intents?.length ?? 0) > 0 && (
            <div className="rounded-lg bg-[#EEF0FF] px-3 py-2.5 text-xs space-y-1">
              <div className="font-bold text-[#3D2FD1]">כוונה, לא עובדה: לא שונה דבר בתיק</div>
              {w.intents!.map((it, i) => (
                <div key={i} className="text-slate-700">
                  הלקוח {it.label}: {it.description} <span className="italic text-slate-500">"{it.evidence}"</span> → נפתחה משימת שימור
                </div>
              ))}
            </div>
          )}
          {updates.some((u) => u.status === 'pending' || u.status === 'approved') && (
            <button
              disabled={busy || approvedCount === 0}
              onClick={commit}
              className="w-full py-2.5 rounded-lg bg-[#0F2942] disabled:opacity-40 text-white text-sm font-semibold"
            >
              אשר ושמור ב-CRM {approvedCount ? `(${approvedCount})` : ''}
            </button>
          )}
          {msg && <div className="text-xs font-semibold text-emerald-700">{msg}</div>}
        </section>
      )}
    </div>
  );
};

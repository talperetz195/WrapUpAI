/**
 * WrapUpAI · דף הבית: איך הרגישו כל הלקוחות לפי סיכום השיחה האחרונה של כל אחד.
 */
import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { CallAnalysisReport, CustomerRecord, PbxRecording, WrapUpSentiment } from '../../types';
import { ChurnBar, EMOTION_LABEL, EMOTION_MOOD, Face, Gauge, KpiCard, MOOD_COLOR, card, type Mood } from './sentimentUi';

type Status = 'report' | 'analyzing' | 'pending' | 'no_sentiment' | 'none';

export interface CustomerSentimentRow {
  customer: CustomerRecord;
  report?: CallAnalysisReport;
  sentiment?: WrapUpSentiment;
  status: Status;
  lastCall?: string;
  pendingRecordingId?: string;
}

export function buildRows(customers: CustomerRecord[], reports: CallAnalysisReport[], recordings: PbxRecording[]): CustomerSentimentRow[] {
  return customers.map((customer) => {
    const recs = recordings
      .filter((r) => r.customerId === customer.id)
      .sort((a, b) => b.callDate.localeCompare(a.callDate));
    const reps = reports
      .filter((r) => r.customerId === customer.id)
      .sort((a, b) => (b.returnedAt || '').localeCompare(a.returnedAt || ''));
    const withSentiment = reps.find((r) => r.wrapup?.sentiment);
    const latestRec = recs[0];
    let status: Status = 'none';
    if (latestRec?.status === 'analyzing_external' || latestRec?.status === 'transferring') status = 'analyzing';
    else if (withSentiment) status = 'report';
    else if (latestRec?.status === 'pending_transfer') status = 'pending';
    else if (reps.length > 0) status = 'no_sentiment';
    return {
      customer,
      report: withSentiment || reps[0],
      sentiment: withSentiment?.wrapup?.sentiment,
      status,
      lastCall: latestRec?.callDate,
      pendingRecordingId: recs.find((r) => r.status === 'pending_transfer')?.id,
    };
  });
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} · ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`;
}

const STATUS_CHIP: Record<Status, [string, string, string]> = {
  report: ['דוח התקבל', '#E3F4E9', '#2F7D52'],
  analyzing: ['בניתוח עכשיו', '#EEF0FF', '#5B4CF0'],
  pending: ['ממתין להעברה', '#EEF0F4', '#6B7280'],
  no_sentiment: ['דוח ללא ניתוח רגשי', '#FFF4D6', '#8A6100'],
  none: ['אין שיחות', '#EEF0F4', '#6B7280'],
};

type Filter = 'all' | 'risk' | 'policy' | 'pending';

interface HomeDashboardProps {
  operatorName: string;
  customers: CustomerRecord[];
  reports: CallAnalysisReport[];
  recordings: PbxRecording[];
  onOpenSentiment: (customerId: string) => void;
  onOpenCustomerCard: (customerId: string) => void;
  onOpenRecording: (recordingId: string) => void;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  operatorName,
  customers,
  reports,
  recordings,
  onOpenSentiment,
  onOpenCustomerCard,
  onOpenRecording,
}) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const rows = useMemo(() => buildRows(customers, reports, recordings), [customers, reports, recordings]);

  const analyzed = rows.filter((r) => r.sentiment);
  const atRisk = analyzed.filter((r) => r.sentiment!.churnRisk >= 60);
  const withPolicy = analyzed.filter((r) => r.sentiment!.policyConflicts.length > 0);
  const policyCount = withPolicy.reduce((n, r) => n + r.sentiment!.policyConflicts.length, 0);
  const pending = rows.filter((r) => r.status === 'pending' || r.status === 'analyzing');
  const avgScore = analyzed.length ? Math.round(analyzed.reduce((n, r) => n + r.sentiment!.score, 0) / analyzed.length) : 0;

  const distribution: Array<[Mood, string, number]> = (
    [
      ['Happy', 'מרוצה'],
      ['Smile', 'מבין / רגוע'],
      ['Neutral', 'מבולבל'],
      ['Sad', 'לחוץ'],
      ['Angry', 'מתוסכל / כועס'],
    ] as Array<[Mood, string]>
  ).map(([m, l]) => [m, l, analyzed.filter((r) => EMOTION_MOOD[r.sentiment!.endEmotion] === m).length]);
  const maxDist = Math.max(1, ...distribution.map((d) => d[2]));

  const attention = analyzed
    .filter((r) => r.sentiment!.churnRisk >= 60 || r.sentiment!.policyConflicts.length > 0)
    .sort((a, b) => b.sentiment!.churnRisk - a.sentiment!.churnRisk);

  const visible = rows
    .filter((r) => {
      if (filter === 'risk') return (r.sentiment?.churnRisk ?? 0) >= 60;
      if (filter === 'policy') return (r.sentiment?.policyConflicts.length ?? 0) > 0;
      if (filter === 'pending') return r.status === 'pending' || r.status === 'analyzing';
      return true;
    })
    .filter((r) => !query.trim() || r.customer.fullName.includes(query.trim()))
    .sort((a, b) => (b.sentiment?.churnRisk ?? -1) - (a.sentiment?.churnRisk ?? -1));

  const firstName = operatorName.split(/[\s—-]/)[0];
  const today = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <div className="space-y-7 max-w-[1360px] mx-auto">
      <div className="text-right">
        <h2 className="text-[30px] font-extrabold text-[#0F2942]">שלום {firstName}, כך הרגישו הלקוחות בשיחות האחרונות</h2>
        <p className="text-[15px] font-medium text-[#6B7280]">{today} · מבוסס על סיכום השיחה האחרונה של כל לקוח</p>
      </div>

      {/* Overview: overall gauge (right) + KPI cards (left) */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_656px] gap-6">
        <section className={card('p-6 flex flex-col items-center gap-4')}>
          <div className="self-stretch text-right">
            <h3 className="text-lg font-bold text-[#0F2942]">מדד חוויית לקוחות כללי</h3>
            <p className="text-[13px] font-medium text-[#8A909C]">ממוצע הרגש בסיום השיחות של כל הלקוחות שנותחו</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-7">
            <div className="flex flex-col items-center gap-1">
              <Gauge value={avgScore} width={300} />
              <div className="flex items-baseline gap-2">
                <span className="text-[52px] font-extrabold text-[#26282E] leading-none">{analyzed.length ? avgScore : '—'}</span>
                <span className="text-sm font-semibold text-[#9AA0AA]">מתוך 100</span>
              </div>
              <span className="text-[13px] font-semibold text-[#8A909C]">מבוסס על {analyzed.length} לקוחות</span>
            </div>
            <div className="space-y-2">
              <div className="text-[13px] font-bold text-[#5F6672]">איך הלקוחות סיימו את השיחה</div>
              {distribution.map(([m, l, n]) => (
                <div key={m} className="flex items-center gap-2">
                  <Face mood={m} size={26} />
                  <span className="text-[13px] font-medium text-[#5F6672] w-24">{l}</span>
                  <div className="h-2.5 rounded-full" style={{ width: 18 + (n / maxDist) * 110, background: MOOD_COLOR[m], opacity: n ? 1 : 0.35 }} />
                  <span className="text-sm font-extrabold text-[#26282E]">{n}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 content-start">
          <KpiCard label="שיחות שנותחו" value={String(analyzed.length)} sub={`מתוך ${customers.length} לקוחות`} mood="Smile" />
          <KpiCard
            label="לקוחות בסיכון נטישה"
            value={String(atRisk.length)}
            sub={atRisk[0] ? `${atRisk[0].customer.fullName} · ${atRisk[0].sentiment!.churnRisk}%` : 'אין כרגע'}
            mood={atRisk.length ? 'Angry' : 'Happy'}
          />
          <KpiCard
            label="סתירות לתקנון"
            value={String(policyCount)}
            sub={withPolicy[0] ? `בשיחה של ${withPolicy[0].customer.fullName}` : 'אין הבטחות סותרות'}
            mood={policyCount ? 'Sad' : 'Happy'}
          />
          <KpiCard
            label="ממתינים לניתוח"
            value={String(pending.length)}
            sub={pending.map((p) => p.customer.fullName).slice(0, 2).join(', ') || 'הכל נותח'}
            mood="Neutral"
          />
        </div>
      </div>

      {/* Needs attention */}
      {attention.length > 0 && (
        <section className="bg-[#EEF0FF] rounded-[20px] p-6 space-y-3">
          <h3 className="text-lg font-extrabold text-[#3D2FD1] text-right">דורשים תשומת לב עכשיו</h3>
          {attention.map((r) => {
            const s = r.sentiment!;
            const tags = [
              s.churnRisk >= 60 ? `סיכון נטישה ${s.churnRisk}%` : '',
              s.policyConflicts.length ? `${s.policyConflicts.length} סתירות לתקנון` : '',
            ].filter(Boolean);
            return (
              <div key={r.customer.id} className="bg-white rounded-[14px] px-[18px] py-3.5 flex flex-wrap items-center gap-4">
                <Face mood={EMOTION_MOOD[s.endEmotion]} size={48} />
                <div className="flex-1 min-w-[240px] text-right">
                  <div className="text-[15px] font-extrabold text-[#26282E]">
                    {r.customer.fullName} · {tags.join(' · ')}
                  </div>
                  <div className="text-[13px] font-medium text-[#5F6672]">{s.recommendation || s.churnReason}</div>
                </div>
                <button
                  onClick={() => onOpenSentiment(r.customer.id)}
                  className="px-5 py-2.5 rounded-xl bg-[#5B4CF0] hover:bg-[#4A3BDF] text-white text-sm font-semibold"
                >
                  לדף התחושות
                </button>
                <button
                  onClick={() => onOpenCustomerCard(r.customer.id)}
                  className="px-5 py-2.5 rounded-xl bg-white border-[1.5px] border-[#5B4CF0] text-[#5B4CF0] text-sm font-semibold hover:bg-[#F5F4FF]"
                >
                  לכרטיס הלקוח
                </button>
              </div>
            );
          })}
        </section>
      )}

      {/* All customers */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-[22px] font-extrabold text-[#0F2942] flex-1">כל הלקוחות</h3>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['all', `הכל (${rows.length})`],
                ['risk', `בסיכון נטישה (${atRisk.length})`],
                ['policy', `סתירות לתקנון (${withPolicy.length})`],
                ['pending', `ממתינים לניתוח (${pending.length})`],
              ] as Array<[Filter, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors ${
                  filter === id ? 'bg-[#0F2942] border-[#0F2942] text-white' : 'bg-white border-[#D9DCE3] text-[#5F6672] hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="relative">
            <Search className="w-4 h-4 text-[#A3A9B3] absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש לקוח..."
              className="w-[260px] pr-9 pl-3 py-2.5 text-sm bg-white border border-[#D9DCE3] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5B4CF0]"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6">
          {visible.map((r) => {
            const s = r.sentiment;
            const [chipText, chipBg, chipFg] = STATUS_CHIP[r.status];
            const mood: Mood = s ? EMOTION_MOOD[s.endEmotion] : 'Neutral';
            return (
              <article key={r.customer.id} className={card('p-5 flex flex-col gap-3.5')}>
                <div className="flex items-center gap-3.5">
                  <Face mood={mood} size={56} active={Boolean(s)} />
                  <div className="flex-1 min-w-0 text-right">
                    <div className="text-[19px] font-extrabold text-[#0F2942] truncate">{r.customer.fullName}</div>
                    <div className="text-[13px] font-medium text-[#7A808C] truncate">{r.customer.department}</div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap" style={{ background: chipBg, color: chipFg }}>
                    {chipText}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 bg-[#F7F8FB] rounded-xl px-3 py-2.5">
                  <span className="text-[13px] font-medium text-[#7A808C]">רגש בסיום:</span>
                  <span className="text-sm font-extrabold text-[#26282E]">{s ? EMOTION_LABEL[s.endEmotion] : '—'}</span>
                  <span className="flex-1 text-left text-xs font-medium text-[#9AA0AA]">
                    {r.lastCall ? `שיחה אחרונה · ${formatDate(r.lastCall)}` : ''}
                  </span>
                </div>
                <ChurnBar risk={s ? s.churnRisk : null} />
                {s && s.policyConflicts.length > 0 && (
                  <span className="self-start px-2.5 py-1.5 rounded-[10px] bg-[#FDECEC] text-[#B3261E] text-xs font-bold">
                    {s.policyConflicts.length} סתירות לתקנון
                  </span>
                )}
                <div className="mt-auto">
                  {s ? (
                    <button
                      onClick={() => onOpenSentiment(r.customer.id)}
                      className="w-full py-3 rounded-xl bg-[#5B4CF0] hover:bg-[#4A3BDF] text-white font-semibold"
                    >
                      לדף תחושות הלקוח ←
                    </button>
                  ) : r.pendingRecordingId ? (
                    <button
                      onClick={() => onOpenRecording(r.pendingRecordingId!)}
                      className="w-full py-3 rounded-xl bg-white border-[1.5px] border-[#5B4CF0] text-[#5B4CF0] font-semibold hover:bg-[#F5F4FF]"
                    >
                      למרכזייה · שליחה לניתוח WrapUpAI
                    </button>
                  ) : (
                    <button
                      onClick={() => onOpenCustomerCard(r.customer.id)}
                      className="w-full py-3 rounded-xl bg-white border-[1.5px] border-[#D9DCE3] text-[#5F6672] font-semibold hover:bg-slate-50"
                    >
                      לכרטיס הלקוח
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          {visible.length === 0 && <div className="text-sm text-[#7A808C] p-6">אין לקוחות בסינון הזה.</div>}
        </div>
      </section>
    </div>
  );
};

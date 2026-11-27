import React, { useMemo, useState } from 'react';
import { Ban, CheckCircle2, ClipboardList, Headphones, KeyRound, Lock, Search, ShieldCheck, Users } from 'lucide-react';
import type { AuditLogEntry } from '../types';
import { Avatar, CodeTag, FilterChip, PageHeader, PageShell, StatCard, StatusPill } from './wrapup/pageUi';

interface AuditLogViewProps {
  logs: AuditLogEntry[];
}

type System = AuditLogEntry['system'];

const SYSTEM_META: Record<System, { label: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; bg: string; fg: string }> = {
  internal_pbx: { label: 'מרכזייה', Icon: Headphones, bg: '#FFF1DE', fg: '#D9822B' },
  security_gateway: { label: 'שער אבטחה', Icon: KeyRound, bg: '#E0F2FE', fg: '#0369A1' },
  external_analytics: { label: 'תמלול חיצוני', Icon: Lock, bg: '#EEF0FF', fg: '#5B4CF0' },
  customer_crm: { label: 'כרטיס לקוח', Icon: Users, bg: '#E3F6EA', fg: '#2F9E6A' },
};

const OUTCOME_PILL: Record<AuditLogEntry['outcome'], { label: string; bg: string; fg: string; Icon: React.ComponentType<{ className?: string }> }> = {
  blocked: { label: 'נחסם', bg: '#FDECEC', fg: '#B3261E', Icon: Ban },
  verified: { label: 'אומת', bg: '#E0F2FE', fg: '#075985', Icon: ShieldCheck },
  approved: { label: 'מאושר', bg: '#E3F6EA', fg: '#2F7D52', Icon: CheckCircle2 },
};

const ROW_GRID = 'lg:grid lg:grid-cols-[118px_160px_170px_minmax(0,1fr)_120px] lg:items-center lg:gap-3';

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

/** גורם מערכת (שירות) ולא אדם: מזהה באנגלית עם מקף / נקודה */
const isServiceActor = (actor: string) => /^[a-z0-9._-]+$/i.test(actor.trim());

export const AuditLogView: React.FC<AuditLogViewProps> = ({ logs }) => {
  const [systemFilter, setSystemFilter] = useState<System | 'all'>('all');
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [query, setQuery] = useState('');

  const counts = {
    approved: logs.filter((l) => l.outcome === 'approved').length,
    verified: logs.filter((l) => l.outcome === 'verified').length,
    blocked: logs.filter((l) => l.outcome === 'blocked').length,
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...logs]
      .filter((l) => systemFilter === 'all' || l.system === systemFilter)
      .filter((l) => !onlyBlocked || l.outcome === 'blocked')
      .filter((l) => !q || [l.action, l.actor, l.resource, l.details].some((f) => f.toLowerCase().includes(q)))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [logs, systemFilter, onlyBlocked, query]);

  return (
    <PageShell>
      <PageHeader title="בקרת אבטחה והרשאות" subtitle="כל גישה להקלטה, טוקן חד-פעמי, הסרת פרטים מזהים וחסימה, במקום אחד">
        <label className="relative">
          <Search className="w-4 h-4 text-[#A3A7BD] absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש לפי פעולה, גורם או משאב..."
            className="w-[300px] max-w-full pr-10 pl-3 py-3 text-sm bg-white rounded-xl border border-transparent focus:outline-none focus:ring-2 focus:ring-[#5B4CF0]"
          />
        </label>
      </PageHeader>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="כל הרשומות"
          value={logs.length}
          sub="מכל 4 רכיבי המערכת"
          bg="#EEF0FF"
          fg="#5B4CF0"
          Icon={ClipboardList}
          onClick={() => {
            setSystemFilter('all');
            setOnlyBlocked(false);
          }}
        />
        <StatCard label="פעולות מאושרות" value={counts.approved} sub="גישה לפי הרשאה" bg="#E3F6EA" fg="#2F9E6A" Icon={CheckCircle2} />
        <StatCard label="אומתו קריפטוגרפית" value={counts.verified} sub="חתימות HMAC על דוחות" bg="#E0F2FE" fg="#0369A1" Icon={ShieldCheck} />
        <StatCard
          label="נחסמו"
          value={counts.blocked}
          sub="ניסיונות גישה ללא הרשאה"
          bg="#FDECEC"
          fg="#B3261E"
          Icon={Ban}
          active={onlyBlocked}
          onClick={() => setOnlyBlocked((v) => !v)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xl font-extrabold text-[#1E1B4B] ml-2">יומן אירועים</h3>
        <FilterChip active={systemFilter === 'all'} onClick={() => setSystemFilter('all')}>
          הכל ({logs.length})
        </FilterChip>
        {(Object.keys(SYSTEM_META) as System[]).map((sys) => {
          const { label, Icon } = SYSTEM_META[sys];
          return (
            <FilterChip key={sys} active={systemFilter === sys} onClick={() => setSystemFilter(sys)}>
              <span className="inline-flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5" /> {label}
              </span>
            </FilterChip>
          );
        })}
        <span className="flex-1" />
        <FilterChip tone="red" active={onlyBlocked} onClick={() => setOnlyBlocked((v) => !v)}>
          רק חסימות ({counts.blocked})
        </FilterChip>
      </div>

      <div className={`hidden ${ROW_GRID} px-[18px] text-xs font-bold text-[#9A97C2]`}>
        <span>זמן</span>
        <span>רכיב</span>
        <span>גורם מבצע</span>
        <span>פעולה ופירוט</span>
        <span className="text-center">תוצאה</span>
      </div>

      <div className="space-y-2.5">
        {visible.length === 0 && <div className="bg-white rounded-2xl py-10 text-center text-sm text-[#8A8FA3]">אין רשומות שמתאימות לסינון.</div>}
        {visible.map((entry) => {
          const sys = SYSTEM_META[entry.system];
          const out = OUTCOME_PILL[entry.outcome];
          const isBlocked = entry.outcome === 'blocked';
          return (
            <div
              key={entry.id}
              className={`bg-white rounded-2xl px-[18px] py-3 flex flex-wrap items-center gap-3 ${ROW_GRID} ${
                isBlocked ? 'border-r-4 border-[#F47C7C] shadow-[0_3px_12px_rgba(179,38,30,0.10)]' : 'shadow-[0_3px_12px_rgba(91,76,240,0.06)]'
              }`}
            >
              <span className="text-xs font-mono tabular-nums text-[#8A8FA3] whitespace-nowrap">{formatTime(entry.timestamp)}</span>
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center shrink-0" style={{ background: sys.bg }}>
                  <sys.Icon className="w-4 h-4" style={{ color: sys.fg }} />
                </span>
                <span className="text-[13px] font-bold text-[#1E1B4B] truncate">{sys.label}</span>
              </span>
              <span className="flex items-center gap-2 min-w-0">
                {isServiceActor(entry.actor) ? (
                  <span className="w-[30px] h-[30px] rounded-full bg-[#F1F2F6] text-[#6B7280] flex items-center justify-center text-xs shrink-0">⚙</span>
                ) : (
                  <Avatar name={entry.actor} id={entry.actor} size={30} />
                )}
                <span className="text-[13px] font-medium text-[#3D3A6B] truncate" title={entry.actor}>
                  {entry.actor}
                </span>
              </span>
              <span className="min-w-0 basis-full lg:basis-auto text-right">
                <span className="text-sm font-extrabold text-[#1E1B4B]">{entry.action}</span> <CodeTag>{entry.resource}</CodeTag>
                <span className="block text-xs font-medium text-[#8A8FA3] mt-0.5">{entry.details}</span>
              </span>
              <span className="lg:text-center">
                <StatusPill bg={out.bg} fg={out.fg}>
                  <out.Icon className="w-3.5 h-3.5" /> {out.label}
                </StatusPill>
              </span>
            </div>
          );
        })}
      </div>
    </PageShell>
  );
};

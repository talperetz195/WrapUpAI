/**
 * WrapUpAI · רכיבי עיצוב משותפים ללשוניות (באותה שפה כמו מסך המרכזייה):
 * רקע סגול-בהיר, כרטיסים לבנים מעוגלים, כרטיסי נתונים עם אייקון צבעוני, צ׳יפים לסינון ואווטרים.
 */
import React from 'react';

export const AVATAR_COLORS: Array<[string, string]> = [
  ['#FFD6E0', '#8C2F4A'],
  ['#DCE4FF', '#2B3F8F'],
  ['#D6F5E3', '#1F6B45'],
  ['#FFE1CC', '#9A4A12'],
  ['#FFF1C9', '#8A6100'],
  ['#E9E4FF', '#4A3BB8'],
];

export function avatarFor(key: string): [string, string] {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initialsOf(name: string): string {
  return name
    .replace(/[׳"']/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
}

export function Avatar({ name, id, size = 44 }: { name: string; id: string; size?: number }) {
  const [bg, fg] = avatarFor(id);
  return (
    <span
      className="rounded-full flex items-center justify-center font-extrabold shrink-0"
      style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.34 }}
    >
      {initialsOf(name)}
    </span>
  );
}

/** מעטפת הדף: רקע סגול-בהיר מעוגל כמו במרכזייה */
export function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="bg-[#F4F2FF] rounded-[24px] p-4 sm:p-6 space-y-6">{children}</div>;
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[260px] text-right">
        <h2 className="text-[26px] font-extrabold text-[#1E1B4B]">{title}</h2>
        <p className="text-[13px] font-medium text-[#8A8FA3]">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  bg,
  fg,
  Icon,
  spin,
  active,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  bg: string;
  fg: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  spin?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`bg-white rounded-[18px] px-[18px] py-4 flex items-center gap-3.5 text-right transition-shadow hover:shadow-md ${
        active ? 'ring-2 ring-[#8B7CF6]' : ''
      } ${onClick ? '' : 'cursor-default'}`}
    >
      <span className="w-12 h-12 rounded-[14px] flex items-center justify-center shrink-0" style={{ background: bg }}>
        <Icon className={`w-6 h-6 ${spin ? 'animate-spin' : ''}`} style={{ color: fg }} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs font-bold text-[#8A8FA3]">{label}</span>
        <span className="block text-[30px] leading-tight font-extrabold text-[#1E1B4B]">{value}</span>
        <span className="block text-xs font-medium text-[#A3A7BD] truncate">{sub}</span>
      </span>
    </button>
  );
}

export function FilterChip({ active, onClick, children, tone }: { active: boolean; onClick: () => void; children: React.ReactNode; tone?: 'red' }) {
  const base = 'px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition-colors whitespace-nowrap';
  if (tone === 'red') {
    return (
      <button onClick={onClick} className={`${base} ${active ? 'bg-[#B3261E] text-white' : 'bg-[#FDECEC] text-[#B3261E] hover:bg-[#FBDADA]'}`}>
        {children}
      </button>
    );
  }
  return (
    <button onClick={onClick} className={`${base} ${active ? 'bg-[#1E1B4B] text-white' : 'bg-white text-[#5F6672] hover:bg-[#EEF0FF]'}`}>
      {children}
    </button>
  );
}

export function StatusPill({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap" style={{ background: bg, color: fg }}>
      {children}
    </span>
  );
}

export function CodeTag({ children }: { children: React.ReactNode }) {
  return (
    <span dir="ltr" className="inline-block px-2 py-0.5 rounded-md bg-[#F4F2FF] text-[11px] font-semibold font-mono text-[#6B66A8] align-middle">
      {children}
    </span>
  );
}

export const whiteCard = 'bg-white rounded-[22px] p-5 sm:p-[22px] shadow-[0_6px_20px_rgba(91,76,240,0.08)]';
export const btnPrimary =
  'inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold bg-[#5B4CF0] hover:bg-[#4A3BDF] disabled:bg-[#A79CF8] text-white rounded-xl whitespace-nowrap transition-colors';
export const btnOutline =
  'inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold bg-white border-[1.5px] border-[#5B4CF0] text-[#5B4CF0] hover:bg-[#F5F4FF] disabled:opacity-60 rounded-xl whitespace-nowrap transition-colors';
export const btnSm = '!px-3.5 !py-2 !text-[13px] !rounded-[10px]';

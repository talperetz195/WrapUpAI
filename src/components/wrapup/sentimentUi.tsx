/**
 * WrapUpAI · רכיבי תצוגת רגש (תואמים לעיצוב ב-Figma "WrapUpAI – תחושות לקוח"):
 * Face (פרצוף רגש), Gauge (מדד עם מחוג), KpiCard (כרטיס מדד), ChurnBar (סרגל סיכון נטישה)
 */
import React from 'react';
import type { WrapUpEmotion } from '../../types';

export type Mood = 'Angry' | 'Sad' | 'Neutral' | 'Smile' | 'Happy';

export const MOOD_COLOR: Record<Mood, string> = {
  Angry: '#F47C7C',
  Sad: '#F9A94B',
  Neutral: '#FFD54F',
  Smile: '#A5DC86',
  Happy: '#6FCF97',
};

export const EMOTION_MOOD: Record<WrapUpEmotion, Mood> = {
  angry: 'Angry',
  frustrated: 'Angry',
  stressed: 'Sad',
  confused: 'Neutral',
  calm: 'Smile',
  understanding: 'Smile',
  satisfied: 'Happy',
};

export const EMOTION_LABEL: Record<WrapUpEmotion, string> = {
  angry: 'כועס',
  frustrated: 'מתוסכל',
  stressed: 'לחוץ',
  confused: 'מבולבל',
  calm: 'רגוע',
  understanding: 'מבין',
  satisfied: 'מרוצה',
};

export const STAGE_LABEL = { opening: 'פתיחה', middle: 'אמצע', closing: 'סיום' } as const;

function FaceFeatures({ mood, fg }: { mood: Mood; fg: string }) {
  return (
    <>
      <circle cx="23" cy="28" r="4" fill={fg} />
      <circle cx="41" cy="28" r="4" fill={fg} />
      {mood === 'Happy' && <path d="M19 37 Q32 53 45 37 Z" fill={fg} />}
      {mood === 'Smile' && <path d="M21 39 Q32 49 43 39" stroke={fg} strokeWidth="4" fill="none" strokeLinecap="round" />}
      {mood === 'Neutral' && <path d="M22 42 L42 42" stroke={fg} strokeWidth="4" strokeLinecap="round" />}
      {(mood === 'Sad' || mood === 'Angry') && (
        <path d="M21 46 Q32 37 43 46" stroke={fg} strokeWidth="4" fill="none" strokeLinecap="round" />
      )}
      {mood === 'Angry' && (
        <>
          <path d="M16 19 L27 24" stroke={fg} strokeWidth="3.5" strokeLinecap="round" />
          <path d="M48 19 L37 24" stroke={fg} strokeWidth="3.5" strokeLinecap="round" />
        </>
      )}
    </>
  );
}

/** פרצוף רגש: צבעוני (פעיל) או אפור (לא נבחר) */
export function Face({ mood, size = 56, active = true, title }: { mood: Mood; size?: number; active?: boolean; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title || mood} className="shrink-0">
      <circle cx="32" cy="32" r="32" fill={active ? MOOD_COLOR[mood] : '#D5D9DF'} />
      <FaceFeatures mood={mood} fg={active ? '#2E2A2A' : '#9AA1AB'} />
    </svg>
  );
}

/** מדד חצי-עיגול ב-5 צבעים עם פרצופים ומחוג (0-100) */
export function Gauge({ value, width = 360 }: { value: number; width?: number }) {
  const W = width;
  const H = Math.round(W * 0.56);
  const cx = W / 2;
  const cy = H - 12;
  const R = W / 2 - 8;
  const r = R * 0.46;
  const moods: Mood[] = ['Angry', 'Sad', 'Neutral', 'Smile', 'Happy'];
  const P = (rad: number, a: number) => [cx + rad * Math.cos(a), cy - rad * Math.sin(a)];
  const v = Math.max(0, Math.min(100, value));
  const a = Math.PI * (1 - v / 100);
  const L = r + (R - r) * 0.55;
  const w = W * 0.022;
  const [tx, ty] = P(L, a);
  const b1 = [cx + w * Math.cos(a + Math.PI / 2), cy - w * Math.sin(a + Math.PI / 2)];
  const b2 = [cx + w * Math.cos(a - Math.PI / 2), cy - w * Math.sin(a - Math.PI / 2)];
  const s = W * 0.085;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`מדד ${Math.round(v)} מתוך 100`} className="max-w-full h-auto">
      {moods.map((m, i) => {
        const a1 = Math.PI * (1 - i / 5);
        const a2 = Math.PI * (1 - (i + 1) / 5);
        const [x1, y1] = P(R, a1);
        const [x2, y2] = P(R, a2);
        const [x3, y3] = P(r, a2);
        const [x4, y4] = P(r, a1);
        const [fx, fy] = P((R + r) / 2, (a1 + a2) / 2);
        return (
          <g key={m}>
            <path
              d={`M${x1} ${y1} A${R} ${R} 0 0 1 ${x2} ${y2} L${x3} ${y3} A${r} ${r} 0 0 0 ${x4} ${y4} Z`}
              fill={MOOD_COLOR[m]}
              stroke="#FFFFFF"
              strokeWidth="4"
            />
            <g transform={`translate(${fx - s / 2} ${fy - s / 2}) scale(${s / 64})`}>
              <circle cx="32" cy="32" r="32" fill="#FFFFFF" />
              <FaceFeatures mood={m} fg="#2E2A2A" />
            </g>
          </g>
        );
      })}
      <path d={`M${b1[0]} ${b1[1]} L${tx} ${ty} L${b2[0]} ${b2[1]} Z`} fill="#26282E" />
      <circle cx={cx} cy={cy} r={W * 0.04} fill="#26282E" />
      <circle cx={cx} cy={cy} r={W * 0.016} fill="#FFFFFF" />
    </svg>
  );
}

/** כרטיס מדד: פרצוף + תווית + ערך + הסבר */
export function KpiCard({ label, value, sub, mood }: { label: string; value: string; sub: string; mood: Mood }) {
  return (
    <div className="bg-white border-[1.5px] border-[#D9DCE3] rounded-[14px] px-[18px] py-4 flex items-center gap-4">
      <Face mood={mood} size={56} />
      <div className="flex-1 min-w-0 text-right">
        <div className="text-xs font-bold tracking-wide text-[#7A808C]">{label}</div>
        <div className="text-[34px] leading-tight font-extrabold text-[#2E3440] truncate">{value}</div>
        <div className="text-[13px] font-medium text-[#7A808C] truncate">{sub}</div>
      </div>
    </div>
  );
}

export function churnColors(risk: number | null): { text: string; bar: string } {
  if (risk === null) return { text: '#9AA0AA', bar: '#D5D9DF' };
  if (risk >= 60) return { text: '#E5534B', bar: '#F47C7C' };
  if (risk >= 30) return { text: '#C77A12', bar: '#F9A94B' };
  return { text: '#2F9E6A', bar: '#6FCF97' };
}

/** סרגל סיכון נטישה (מתמלא מימין) */
export function ChurnBar({ risk }: { risk: number | null }) {
  const c = churnColors(risk);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-medium text-[#7A808C]">סיכון נטישה</span>
        <span className="font-extrabold" style={{ color: c.text }}>
          {risk === null ? '—' : `${risk}%`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-[#EDEFF4] overflow-hidden flex justify-start" dir="rtl">
        <div className="h-full rounded-full" style={{ width: `${risk ?? 0}%`, background: c.bar }} />
      </div>
    </div>
  );
}

export function card(extra = ''): string {
  return `bg-white border border-[#E3E6EE] rounded-[20px] shadow-[0_4px_16px_rgba(15,26,51,0.06)] ${extra}`;
}

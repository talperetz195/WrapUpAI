/**
 * WrapUpAI · דף תחושות הלקוח: לפי סיכום השיחה האחרונה של הלקוח (עם ניתוח רגשי).
 */
import React from 'react';
import { ArrowRight } from 'lucide-react';
import { fetchWrapupPdfBlob } from '../../api';
import type { CallAnalysisReport, CustomerRecord } from '../../types';
import { EMOTION_LABEL, EMOTION_MOOD, Face, Gauge, KpiCard, STAGE_LABEL, card, churnColors, type Mood } from './sentimentUi';

interface CustomerSentimentViewProps {
  token: string;
  customer: CustomerRecord;
  report?: CallAnalysisReport;
  onBack: () => void;
  onOpenCustomerCard: (customerId: string, reportId?: string) => void;
}

const SCALE: Array<[Mood, string]> = [
  ['Happy', 'מרוצה'],
  ['Smile', 'מבין'],
  ['Neutral', 'מבולבל'],
  ['Sad', 'לחוץ'],
  ['Angry', 'מתוסכל / כועס'],
];

export const CustomerSentimentView: React.FC<CustomerSentimentViewProps> = ({ token, customer, report, onBack, onOpenCustomerCard }) => {
  const s = report?.wrapup?.sentiment;

  const backButton = (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white border-[1.5px] border-[#5B4CF0] text-[#5B4CF0] text-sm font-semibold hover:bg-[#F5F4FF]"
    >
      <ArrowRight className="w-4 h-4" />
      לכל הלקוחות
    </button>
  );

  if (!report || !s) {
    return (
      <div className="max-w-[1120px] mx-auto space-y-6">
        {backButton}
        <section className={card('p-10 text-center space-y-3')}>
          <div className="flex justify-center">
            <Face mood="Neutral" size={72} active={false} />
          </div>
          <h2 className="text-xl font-extrabold text-[#0F2942]">אין עדיין ניתוח רגשי עבור {customer.fullName}</h2>
          <p className="text-sm text-[#7A808C]">שלחו שיחה של הלקוח לניתוח WrapUpAI במרכזייה, והתחושות יופיעו כאן אוטומטית.</p>
          <button
            onClick={() => onOpenCustomerCard(customer.id)}
            className="px-5 py-2.5 rounded-xl bg-[#5B4CF0] text-white text-sm font-semibold"
          >
            לכרטיס הלקוח
          </button>
        </section>
      </div>
    );
  }

  const endMood = EMOTION_MOOD[s.endEmotion];
  const churn = churnColors(s.churnRisk);
  const callDate = new Date(report.returnedAt).toLocaleDateString('he-IL');
  const openPdf = async () => {
    try {
      const blob = await fetchWrapupPdfBlob(token, report.id, 'business');
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'שגיאה בפתיחת ה-PDF');
    }
  };

  return (
    <div className="max-w-[1120px] mx-auto bg-[#F4F6FA] rounded-[28px] space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[280px] text-right space-y-1">
          <h2 className="text-[28px] font-extrabold text-[#0F2942]">תחושות הלקוח בשיחה</h2>
          <p className="text-sm font-medium text-[#6B7280]">
            {customer.fullName} · {customer.department} · {callDate} · {report.participantsDetected.length} משתתפים
          </p>
          <span dir="ltr" className="inline-block px-2 py-0.5 rounded-md bg-[#EAEDF3] text-xs font-semibold text-[#5F6672]">
            {report.uniqueCallName}
          </span>
        </div>
        <span className="px-3.5 py-1.5 rounded-full bg-[#EEF0FF] text-[#5B4CF0] text-xs font-bold tracking-wide">WRAPUP AI · ניתוח רגשי</span>
        {backButton}
      </div>

      {/* Gauge (right) + KPIs (left) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <section className={card('p-6 flex flex-col items-center gap-4')}>
          <div className="self-stretch text-right">
            <h3 className="text-lg font-bold text-[#0F2942]">מדד חוויית לקוח</h3>
            <p className="text-[13px] font-medium text-[#8A909C]">משוקלל מהרגש בפתיחה, באמצע ובסיום השיחה</p>
          </div>
          <Gauge value={s.score} width={380} />
          <div className="flex items-baseline gap-2.5">
            <span className="text-[64px] font-extrabold text-[#26282E] leading-none">{s.score}</span>
            <span className="text-base font-semibold text-[#9AA0AA]">מתוך 100</span>
            {s.deltaFromOpening !== 0 && (
              <span className={`text-base font-bold ${s.deltaFromOpening > 0 ? 'text-[#2F9E6A]' : 'text-[#E5534B]'}`}>
                {s.deltaFromOpening > 0 ? '↑' : '↓'} {Math.abs(s.deltaFromOpening)} מהפתיחה
              </span>
            )}
          </div>
          <div className="px-4 py-2 rounded-full bg-[#FFF6D6] text-[#8A6100] text-sm font-semibold text-center">{s.churnReason}</div>
        </section>
        <div className="flex flex-col gap-3">
          <KpiCard label="רגש בסיום השיחה" value={EMOTION_LABEL[s.endEmotion]} sub={s.title} mood={endMood} />
          <KpiCard
            label="סיכון נטישה"
            value={`${s.churnRisk}%`}
            sub={s.churnRisk >= 60 ? 'גבוה · נפתחה משימת שימור' : s.churnRisk >= 30 ? 'בינוני' : 'נמוך'}
            mood={s.churnRisk >= 60 ? 'Angry' : s.churnRisk >= 30 ? 'Sad' : 'Smile'}
          />
          <KpiCard
            label="Policy Guard"
            value={String(s.policyConflicts.length)}
            sub={s.policyConflicts.length ? 'הבטחות שסותרות את התקנון' : 'אין הבטחות שסותרות את התקנון'}
            mood={s.policyConflicts.length ? 'Angry' : 'Happy'}
          />
          <KpiCard label="משימות פתוחות" value={String(s.openTasks)} sub="מתוך סיכום השיחה" mood={s.openTasks ? 'Sad' : 'Happy'} />
        </div>
      </div>

      {/* Emotion journey */}
      <section className={card('p-6 space-y-5')}>
        <div className="text-right">
          <h3 className="text-lg font-bold text-[#0F2942]">מסע הרגש של הלקוח</h3>
          <p className="text-[13px] font-medium text-[#8A909C]">איך הלקוח הרגיש לאורך השיחה, עם ציטוט מתוך התמלול</p>
        </div>
        <div className="relative grid gap-6" style={{ gridTemplateColumns: `repeat(${Math.max(1, s.journey.length)}, minmax(0, 1fr))` }}>
          <div className="absolute top-10 right-[16%] left-[16%] h-1 rounded bg-[#E6E8EE]" aria-hidden="true" />
          {s.journey.map((j) => (
            <div key={j.stage} className="relative flex flex-col items-center text-center gap-2">
              <Face mood={EMOTION_MOOD[j.emotion]} size={j.stage === 'closing' ? 96 : 80} />
              <div className="text-xl font-extrabold text-[#26282E]">{EMOTION_LABEL[j.emotion]}</div>
              <div className="text-xs font-bold tracking-wide text-[#9AA0AA]">
                {STAGE_LABEL[j.stage]}
                {j.timestamp ? ` · ${j.timestamp}` : ''}
              </div>
              <div className="text-sm font-medium text-[#5F6672] max-w-[240px]">"{j.evidence}"</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-5 bg-[#F7F8FB] rounded-[14px] px-5 py-3">
          {SCALE.map(([m, l]) => {
            const on = m === endMood;
            return (
              <div key={m} className="flex items-center gap-1.5">
                <Face mood={m} size={28} active={on} />
                <span className={`text-[13px] ${on ? 'font-bold text-[#26282E]' : 'font-medium text-[#9AA0AA]'}`}>{l}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Policy Guard */}
      {s.policyConflicts.length > 0 && (
        <section className="bg-[#FDECEC] border-2 border-[#E5534B] rounded-[20px] p-5 space-y-3 text-right">
          <h3 className="text-base font-extrabold text-[#7A1610]">
            Policy Guard · {s.policyConflicts.length} הבטחות של הנציג סותרות את התקנון
          </h3>
          {s.policyConflicts.map((p, i) => (
            <div key={i} className="bg-white rounded-xl px-4 py-3 text-sm space-y-1">
              <div>
                <span className="font-bold">הנציג אמר: </span>"{p.repStatement}"
              </div>
              <div>
                <span className="font-bold">בתקנון: </span>"{p.policyText}"
              </div>
              <div className="text-[#7A808C]">{p.explanation}</div>
            </div>
          ))}
        </section>
      )}

      {/* Recommendation */}
      <section className="bg-[#EEF0FF] rounded-[20px] p-6 flex flex-wrap items-center gap-5">
        <div className="flex-1 min-w-[300px] text-right space-y-1">
          <h3 className="text-base font-extrabold text-[#3D2FD1]">המלצה לנציג</h3>
          <p className="text-sm font-medium text-[#3B4252]">{s.recommendation || s.churnReason}</p>
        </div>
        <button onClick={openPdf} className="px-6 py-3 rounded-xl bg-[#5B4CF0] hover:bg-[#4A3BDF] text-white font-semibold">
          פתח את דוח ה-PDF
        </button>
        <button
          onClick={() => onOpenCustomerCard(customer.id, report.id)}
          className="px-6 py-3 rounded-xl bg-white border-[1.5px] border-[#5B4CF0] text-[#5B4CF0] font-semibold hover:bg-[#F5F4FF]"
        >
          לכרטיס הלקוח המלא
        </button>
      </section>
    </div>
  );
};

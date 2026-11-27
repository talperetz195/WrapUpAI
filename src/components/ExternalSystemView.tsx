import React, { useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Ban, Check, CheckCircle2, EyeOff, FileText, Loader2, Send, ShieldX, Trash2 } from 'lucide-react';
import { testExternalBoundaryIsolation } from '../api';
import type { AuditLogEntry, CallAnalysisReport, CustomerRecord, ExternalJobStage, TransferJob } from '../types';
import {
  Avatar,
  CodeTag,
  FilterChip,
  PageHeader,
  PageShell,
  StatCard,
  StatusPill,
  btnOutline,
  btnPrimary,
  btnSm,
  whiteCard,
} from './wrapup/pageUi';

interface ExternalSystemViewProps {
  transferJobs: TransferJob[];
  reports: CallAnalysisReport[];
  customers?: CustomerRecord[];
  auditLogs?: AuditLogEntry[];
  onOpenCustomerReport: (customerId: string, reportId?: string) => void;
  onOpenPdf: (reportId: string) => void;
}

const STAGE_STEPS: Array<{ id: ExternalJobStage; label: [string, string] }> = [
  { id: 'token_verified', label: ['אימות טוקן', 'חד-פעמי'] },
  { id: 'transcribing_audio', label: ['תמלול שמע', 'רב-משתתפים'] },
  { id: 'analyzing_topics', label: ['ניתוח נושאים', 'ומשימות'] },
  { id: 'signing_and_returning', label: ['חתימה והחזרה', 'למערכת'] },
  { id: 'completed_and_purged', label: ['הושלם · השמע', 'נמחק'] },
];

type Filter = 'all' | 'processing' | 'done' | 'failed';

/** שמות השדות שנחסמו, בעברית */
const FIELD_LABEL: Record<string, string> = {
  nationalId: 'מספר זהות',
  customerName: 'שם הלקוח',
  fullName: 'שם מלא',
  phone: 'טלפון',
  city: 'יישוב',
  branch: 'סניף',
  caseNumber: 'מספר תיק',
  crmHistory: 'היסטוריית תיק',
  email: 'דוא״ל',
  emails: 'דוא״ל',
  address: 'כתובת',
  department: 'מחלקה',
};

function getStageIndex(stage: ExternalJobStage): number {
  const idx = STAGE_STEPS.findIndex((s) => s.id === stage);
  return idx === -1 ? 0 : idx;
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} · ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`;
}

function Stepper({ stage }: { stage: ExternalJobStage }) {
  const currentIdx = getStageIndex(stage);
  const finished = stage === 'completed_and_purged';
  return (
    <div className="flex items-start" aria-label="שלבי העיבוד">
      {STAGE_STEPS.map((step, idx) => {
        const done = idx < currentIdx || finished;
        const active = idx === currentIdx && !finished;
        return (
          <div key={step.id} className="flex-1 flex flex-col items-center gap-2 relative text-center">
            {idx > 0 && (
              <span
                className="absolute top-[17px] left-1/2 w-full h-[3px]"
                style={{ background: done || active ? '#8B7CF6' : '#E4E0FB' }}
                aria-hidden="true"
              />
            )}
            <span
              className={`relative z-[1] w-9 h-9 rounded-full flex items-center justify-center text-sm font-extrabold ${
                done ? 'bg-[#5B4CF0] text-white' : active ? 'bg-white border-[3px] border-[#5B4CF0] text-[#5B4CF0]' : 'bg-[#EDEBFA] text-[#9A97C2]'
              }`}
            >
              {done ? <Check className="w-4 h-4" /> : active ? <Loader2 className="w-4 h-4 animate-spin" /> : idx + 1}
            </span>
            <span className={`text-xs font-semibold leading-tight ${done || active ? 'text-[#1E1B4B]' : 'text-[#8A8FA3]'}`}>
              {step.label[0]}
              <br />
              {step.label[1]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export const ExternalSystemView: React.FC<ExternalSystemViewProps> = ({
  transferJobs,
  reports,
  customers = [],
  auditLogs = [],
  onOpenCustomerReport,
  onOpenPdf,
}) => {
  const [boundaryResult, setBoundaryResult] = useState<{ status: number; message: string } | null>(null);
  const [testingBoundary, setTestingBoundary] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const handleBoundaryTest = async () => {
    setTestingBoundary(true);
    try {
      const res = await testExternalBoundaryIsolation();
      setBoundaryResult(res);
    } finally {
      setTestingBoundary(false);
    }
  };

  const nameOf = (job: TransferJob) =>
    customers.find((c) => c.id === job.customerId)?.fullName ||
    reports.find((r) => r.jobId === job.jobId)?.customerName ||
    'לקוח';

  const isProcessing = (j: TransferJob) => j.stage !== 'completed_and_purged' && j.stage !== 'failed';
  const processing = transferJobs.filter(isProcessing);
  const done = transferJobs.filter((j) => j.stage === 'completed_and_purged');
  const failed = transferJobs.filter((j) => j.stage === 'failed');
  const purged = transferJobs.filter((j) => j.audioPurged);
  const blocked = auditLogs.filter((l) => l.outcome === 'blocked').sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const visible = useMemo(
    () =>
      transferJobs
        .filter((j) =>
          filter === 'processing' ? isProcessing(j) : filter === 'done' ? j.stage === 'completed_and_purged' : filter === 'failed' ? j.stage === 'failed' : true
        )
        .sort((a, b) => Number(isProcessing(b)) - Number(isProcessing(a)) || b.initiatedAt.localeCompare(a.initiatedAt)),
    [transferJobs, filter]
  );

  return (
    <PageShell>
      <PageHeader title="מערכת תמלול וניתוח חיצונית" subtitle="סביבה מבודדת: מקבלת רק קובץ שמע, בלי גישה לתיקי לקוחות">
        <button onClick={handleBoundaryTest} disabled={testingBoundary} className={btnOutline}>
          {testingBoundary ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldX className="w-4 h-4" />}
          בדוק חסימת גישה לתיקים
        </button>
      </PageHeader>

      {boundaryResult && (
        <div className="bg-white rounded-2xl px-[18px] py-3 flex flex-wrap items-center gap-3 text-sm">
          <StatusPill bg="#FDECEC" fg="#B3261E">
            <Ban className="w-3.5 h-3.5" /> HTTP {boundaryResult.status}
          </StatusPill>
          <span className="font-medium text-[#3D3A6B]">{boundaryResult.message}</span>
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="בעיבוד עכשיו"
          value={processing.length}
          sub={processing[0] ? nameOf(processing[0]) : 'אין כרגע'}
          bg="#EEF0FF"
          fg="#5B4CF0"
          Icon={Loader2}
          spin={processing.length > 0}
          active={filter === 'processing'}
          onClick={() => setFilter(filter === 'processing' ? 'all' : 'processing')}
        />
        <StatCard
          label="הוחזרו חתומים"
          value={done.length}
          sub="עם סיכום ו-PDF בתיק"
          bg="#E3F6EA"
          fg="#2F9E6A"
          Icon={CheckCircle2}
          active={filter === 'done'}
          onClick={() => setFilter(filter === 'done' ? 'all' : 'done')}
        />
        <StatCard label="קבצי שמע שנמחקו" value={purged.length} sub="נמחקים אחרי כל ניתוח" bg="#FFF1DE" fg="#D9822B" Icon={Trash2} />
        <StatCard
          label="ניסיונות גישה שנחסמו"
          value={blocked.length}
          sub={blocked[0] ? `אחרון ${formatTime(blocked[0].timestamp)}` : 'לא היו ניסיונות'}
          bg="#FDECEC"
          fg="#B3261E"
          Icon={Ban}
        />
      </div>

      <div>
        <span className="inline-block px-3.5 py-1.5 rounded-full text-[13px] font-semibold bg-[#FFF6D6] text-[#8A6100]">
          🔒 יוצא החוצה רק קובץ השמע ומזהה שיחה · שם, ת״ז ופרטי תיק נשארים בארגון
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xl font-extrabold text-[#1E1B4B] ml-2">משימות תמלול</h3>
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          הכל ({transferJobs.length})
        </FilterChip>
        <FilterChip active={filter === 'processing'} onClick={() => setFilter('processing')}>
          בעיבוד ({processing.length})
        </FilterChip>
        <FilterChip active={filter === 'done'} onClick={() => setFilter('done')}>
          הוחזרו ({done.length})
        </FilterChip>
        <FilterChip active={filter === 'failed'} onClick={() => setFilter('failed')}>
          נכשלו ({failed.length})
        </FilterChip>
      </div>

      {visible.length === 0 ? (
        <section className={`${whiteCard} text-center py-10 space-y-2`}>
          <Send className="w-8 h-8 text-[#A3A7BD] mx-auto" />
          <h3 className="text-base font-extrabold text-[#1E1B4B]">
            {transferJobs.length === 0 ? 'אין משימות תמלול כרגע' : 'אין משימות בסינון הזה'}
          </h3>
          {transferJobs.length === 0 && (
            <p className="text-sm text-[#8A8FA3] max-w-md mx-auto">שלחו הקלטה מהמרכזייה לניתוח, והיא תופיע כאן עם כל שלבי העיבוד.</p>
          )}
        </section>
      ) : (
        <div className="space-y-4">
          {visible.map((job) => {
            const report = reports.find((r) => r.jobId === job.jobId);
            const name = nameOf(job);
            const finished = job.stage === 'completed_and_purged';
            const isFailed = job.stage === 'failed';
            return (
              <article key={job.jobId} className={`${whiteCard} space-y-[18px]`}>
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar name={name} id={job.customerId} size={52} />
                  <div className="flex-1 min-w-[240px] text-right space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[19px] font-extrabold text-[#1E1B4B]">{name}</span>
                      {finished ? (
                        <StatusPill bg="#E3F6EA" fg="#2F7D52">
                          <span className="w-2 h-2 rounded-full bg-[#2F9E6A]" /> הוחזר חתום
                        </StatusPill>
                      ) : isFailed ? (
                        <StatusPill bg="#FDECEC" fg="#B3261E">
                          <AlertCircle className="w-3 h-3" /> העיבוד נכשל
                        </StatusPill>
                      ) : (
                        <StatusPill bg="#EEF0FF" fg="#5B4CF0">
                          <Loader2 className="w-3 h-3 animate-spin" /> בעיבוד מבודד
                        </StatusPill>
                      )}
                      {job.audioPurged && (
                        <StatusPill bg="#FFF1DE" fg="#B5651D">
                          <Trash2 className="w-3 h-3" /> השמע נמחק
                        </StatusPill>
                      )}
                    </div>
                    <div className="text-[13px] font-medium text-[#8A8FA3] flex flex-wrap items-center gap-1.5">
                      <CodeTag>{job.jobId}</CodeTag>
                      <CodeTag>{job.uniqueCallName}</CodeTag>
                      <span>· הועבר ע״י {job.initiatedBy}</span>
                      <span>· {formatTime(job.initiatedAt)}</span>
                    </div>
                  </div>
                  {report && (
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => onOpenPdf(report.id)} className={`${btnOutline} ${btnSm}`}>
                        <FileText className="w-4 h-4" /> פתח PDF
                      </button>
                      <button onClick={() => onOpenCustomerReport(report.customerId, report.id)} className={`${btnPrimary} ${btnSm}`}>
                        לדוח בכרטיס הלקוח <ArrowLeft className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {isFailed ? (
                  <div className="text-sm font-medium text-[#B3261E] bg-[#FDECEC] rounded-2xl px-[18px] py-3">
                    {job.error || 'אירעה שגיאה בעיבוד הקלטת השיחה במערכת החיצונית.'}
                  </div>
                ) : finished ? (
                  <div className="h-2 rounded-full bg-[#8B7CF6]" title="כל השלבים הושלמו" />
                ) : (
                  <Stepper stage={job.stage} />
                )}

                {!finished && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    <div className="bg-[#F7F5FF] rounded-2xl px-[18px] py-3.5 space-y-2">
                      <div className="text-[13px] font-extrabold text-[#1E1B4B] flex items-center gap-2">
                        <Send className="w-4 h-4 text-[#5B4CF0]" /> מה נשלח החוצה
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-white text-[#3D3A6B]">קובץ שמע אחד</span>
                        <span dir="ltr" className="px-2.5 py-1 rounded-full text-xs font-semibold font-mono bg-white text-[#3D3A6B]">
                          {job.uniqueCallName}
                        </span>
                        {job.maskedPayload.anonymizedParticipants.map((p) => (
                          <span key={p.anonymizedLabel} className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#DCE4FF] text-[#2B3F8F]">
                            {p.anonymizedLabel} · {p.role}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="bg-[#FFF8F8] rounded-2xl px-[18px] py-3.5 space-y-2">
                      <div className="text-[13px] font-extrabold text-[#1E1B4B] flex items-center gap-2">
                        <EyeOff className="w-4 h-4 text-[#B3261E]" /> מה נחסם לפני היציאה
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {job.maskedPayload.piiStrippedFields.map((f) => (
                          <span key={f} className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#FDECEC] text-[#B3261E]">
                            {FIELD_LABEL[f] || f}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </PageShell>
  );
};

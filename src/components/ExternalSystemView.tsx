import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  EyeOff,
  FileText,
  Lock,
  Loader2,
  ShieldCheck,
  ShieldX,
  Trash2,
} from 'lucide-react';
import { testExternalBoundaryIsolation } from '../api';
import type { CallAnalysisReport, ExternalJobStage, TransferJob } from '../types';

interface ExternalSystemViewProps {
  transferJobs: TransferJob[];
  reports: CallAnalysisReport[];
  onOpenCustomerReport: (customerId: string, reportId?: string) => void;
  onOpenPdf: (reportId: string) => void;
}

const STAGE_STEPS: Array<{ id: ExternalJobStage; label: string }> = [
  { id: 'token_verified', label: '1. אימות טוקן חד-פעמי' },
  { id: 'transcribing_audio', label: '2. תמלול שמע רב-משתתפים' },
  { id: 'analyzing_topics', label: '3. ניתוח נושאים ומשימות' },
  { id: 'signing_and_returning', label: '4. חתימה והחזרה למערכת הראשית' },
  { id: 'completed_and_purged', label: '5. הושלם · קובץ השמע נמחק' },
];

function getStageIndex(stage: ExternalJobStage): number {
  const idx = STAGE_STEPS.findIndex((s) => s.id === stage);
  return idx === -1 ? 0 : idx;
}

export const ExternalSystemView: React.FC<ExternalSystemViewProps> = ({
  transferJobs,
  reports,
  onOpenCustomerReport,
  onOpenPdf,
}) => {
  const [boundaryResult, setBoundaryResult] = useState<{ status: number; message: string } | null>(null);
  const [testingBoundary, setTestingBoundary] = useState(false);

  const handleBoundaryTest = async () => {
    setTestingBoundary(true);
    try {
      const res = await testExternalBoundaryIsolation();
      setBoundaryResult(res);
    } finally {
      setTestingBoundary(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Restricted Sandbox Header */}
      <section className="bg-slate-900 text-slate-100 border border-slate-800 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5 text-sm font-semibold text-blue-300">
              <Lock className="w-4 h-4" />
              <span>סביבה חיצונית מבודדת — הרשאות מוגבלות ומבוקרות</span>
            </div>
            <h2 className="text-xl font-bold text-white">מערכת תמלול וניתוח אוטומטי מרובת משתתפים</h2>
            <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
              מערכת זו מקבלת קובץ שמע יחיד בלבד באמצעות טוקן HMAC חד-פעמי, ללא שום הרשאת גישה לכרטיסי הלקוחות,
              מספרי הזהות או היסטוריית התיק. בסיום הניתוח, הדוח מוחזר חתום למערכת העסק וקובץ השמע נמחק מהסביבה החיצונית.
            </p>
          </div>

          <div className="shrink-0">
            <button
              onClick={handleBoundaryTest}
              disabled={testingBoundary}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-lg transition-colors whitespace-nowrap"
            >
              {testingBoundary ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldX className="w-4 h-4 text-amber-400" />
              )}
              <span>בדוק חסימת גישה לתיקי לקוחות</span>
            </button>
          </div>
        </div>

        {boundaryResult && (
          <div className="mt-4 pt-4 border-t border-slate-800 flex items-center gap-3 text-xs">
            <span className="font-mono font-semibold text-red-300">HTTP {boundaryResult.status}</span>
            <span className="text-slate-300">{boundaryResult.message}</span>
          </div>
        )}
      </section>

      {/* Jobs List inside External Boundary */}
      {transferJobs.length === 0 ? (
        <section className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
          <ShieldCheck className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="text-base font-semibold text-slate-900">אין משימות תמלול פעילות כרגע במערכת החיצונית</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            עברו למרכזיה ולחצו על כפתור ההעברה בלחיצה אחת כדי לשלוח קובץ שמע בצורה מאובטחת לניתוח.
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          {transferJobs.map((job) => {
            const report = reports.find((r) => r.jobId === job.jobId);
            const currentIdx = getStageIndex(job.stage);

            return (
              <section key={job.jobId} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono text-sm font-bold text-slate-900">{job.jobId}</span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="font-mono text-xs text-slate-600">{job.uniqueCallName}</span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      {job.stage === 'completed_and_purged' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>הדוח הוחזר חתום למערכת הפנימית</span>
                        </span>
                      ) : job.stage === 'failed' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>עיבוד נכשל</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>בעיבוד מבודד</span>
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                      <span>הועבר על ידי: {job.initiatedBy}</span>
                      <span aria-hidden="true">·</span>
                      <span>הרשאת טוקן: קריאת אודיו יחיד בלבד</span>
                      {job.audioPurged && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 text-slate-700 font-medium">
                            <Trash2 className="w-3.5 h-3.5 text-slate-500" />
                            <span>קובץ שמע נמחק מהשרת החיצוני</span>
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {report && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => onOpenPdf(report.id)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#0F2942] hover:bg-slate-800 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>פתח מסמך PDF</span>
                      </button>
                      <button
                        onClick={() => onOpenCustomerReport(report.customerId, report.id)}
                        className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        <span>פתח דוח בכרטיס הלקוח</span>
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Pipeline Stages */}
                {job.stage !== 'failed' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                    {STAGE_STEPS.map((step, idx) => {
                      const done = idx < currentIdx || job.stage === 'completed_and_purged';
                      const active = idx === currentIdx && job.stage !== 'completed_and_purged';
                      return (
                        <div
                          key={step.id}
                          className={`px-3 py-2.5 rounded-lg border text-xs font-medium flex items-center gap-2 ${
                            done
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                              : active
                              ? 'bg-amber-50 border-amber-200 text-amber-800'
                              : 'bg-slate-50 border-slate-200 text-slate-500'
                          }`}
                        >
                          {done ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : active ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600 shrink-0" />
                          ) : (
                            <span className="w-3.5 h-3.5 rounded-full border border-slate-300 shrink-0" />
                          )}
                          <span className="truncate">{step.label}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
                    {job.error || 'אירעה שגיאה בעיבוד הקלטת השיחה במערכת החיצונית.'}
                  </div>
                )}

                {/* Masked Payload Proof */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 text-xs">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-1.5">
                    <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-blue-700" />
                      <span>מידע מינימלי שהועבר למערכת החיצונית</span>
                    </div>
                    <p className="text-slate-600">
                      קובץ שמע בודד + מזהה שיחה (<span className="font-mono">{job.uniqueCallName}</span>)
                    </p>
                    <p className="text-slate-600">
                      משתתפים אנונימיים:{' '}
                      {job.maskedPayload.anonymizedParticipants
                        .map((p) => `${p.anonymizedLabel} (${p.role})`)
                        .join(' · ')}
                    </p>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-1.5">
                    <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <EyeOff className="w-4 h-4 text-slate-600" />
                      <span>שדות רגישים שנחסמו טרם היציאה מהארגון</span>
                    </div>
                    <p className="font-mono text-slate-600">
                      {job.maskedPayload.piiStrippedFields.join(' · ')}
                    </p>
                    <p className="text-slate-500">למערכת החיצונית אין גישה לקריאה או כתיבה לכרטיס הלקוח.</p>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

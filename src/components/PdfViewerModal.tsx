import React, { useEffect, useState } from 'react';
import { CalendarPlus, Download, FileText, Loader2, Printer, ShieldCheck, X } from 'lucide-react';
import { generateStructuredReportPdf, type GeneratedPdfResult } from '../utils/pdfReport';
import type { CallAnalysisReport, CustomerRecord } from '../types';

interface PdfViewerModalProps {
  report: CallAnalysisReport | null;
  customer?: CustomerRecord;
  onClose: () => void;
  onAddAllTasksToCalendar?: (reportId: string) => Promise<void>;
}

export const PdfViewerModal: React.FC<PdfViewerModalProps> = ({
  report,
  customer,
  onClose,
  onAddAllTasksToCalendar,
}) => {
  const [pdfResult, setPdfResult] = useState<GeneratedPdfResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);

  useEffect(() => {
    if (!report) {
      setPdfResult(null);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;

    setLoading(true);
    setError(null);

    generateStructuredReportPdf(report, customer)
      .then((res) => {
        if (cancelled) {
          URL.revokeObjectURL(res.blobUrl);
          return;
        }
        createdUrl = res.blobUrl;
        setPdfResult(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'שגיאה בהפקת מסמך ה-PDF.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [report, customer]);

  if (!report) return null;

  const hasUnscheduledTasks = report.actionItems.some((t) => !t.addedToCalendar);

  const handlePrint = () => {
    if (!pdfResult) return;
    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    document.body.appendChild(printFrame);

    const doc = printFrame.contentWindow?.document;
    if (doc) {
      const imgsHtml = pdfResult.pageImages
        .map(
          (src) =>
            `<div style="page-break-after: always; margin: 0; padding: 0;"><img src="${src}" style="width: 100%; display: block;" /></div>`
        )
        .join('');
      doc.open();
      doc.write(`<!doctype html><html><head><title>${pdfResult.fileName}</title><style>@page{size:A4;margin:0;}body{margin:0;}</style></head><body>${imgsHtml}</body></html>`);
      doc.close();
      setTimeout(() => {
        printFrame.contentWindow?.focus();
        printFrame.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(printFrame);
        }, 1000);
      }, 250);
    }
  };

  const handleScheduleAll = async () => {
    if (!onAddAllTasksToCalendar) return;
    setScheduling(true);
    try {
      await onAddAllTasksToCalendar(report.id);
    } finally {
      setScheduling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-5xl h-[90vh] shadow-2xl flex flex-col overflow-hidden">
        {/* PDF Toolbar */}
        <div className="bg-[#0F2942] text-white px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4 text-blue-200" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold truncate">
                מסמך סיכום PDF · <span className="font-mono">{report.uniqueCallName}</span>
              </div>
              <div className="text-xs text-slate-300 flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                <span>תבנית מובנית בנקודות · {report.customerName}</span>
                {pdfResult && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{pdfResult.pageImages.length} עמודים</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {onAddAllTasksToCalendar && hasUnscheduledTasks && (
              <button
                onClick={handleScheduleAll}
                disabled={scheduling}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg transition-colors whitespace-nowrap"
              >
                {scheduling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CalendarPlus className="w-3.5 h-3.5" />
                )}
                <span>הוסף משימות ליומן הלקוח</span>
              </button>
            )}

            {pdfResult && (
              <>
                <button
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>הדפס</span>
                </button>
                <a
                  href={pdfResult.blobUrl}
                  download={pdfResult.fileName}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>הורד קובץ PDF</span>
                </a>
              </>
            )}

            <button
              onClick={onClose}
              className="p-2 text-slate-300 hover:text-white rounded-lg transition-colors"
              aria-label="סגור תצוגת PDF"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Document Viewport */}
        <div className="flex-1 overflow-y-auto bg-slate-200 p-6">
          {loading && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-600">
              <Loader2 className="w-7 h-7 animate-spin text-blue-700" />
              <span className="text-sm font-medium">מכין מסמך PDF בתבנית קבועה...</span>
            </div>
          )}

          {error && (
            <div className="max-w-lg mx-auto bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm">
              {error}
            </div>
          )}

          {!loading && !error && pdfResult && (
            <div className="max-w-3xl mx-auto space-y-6">
              {pdfResult.pageImages.map((src, idx) => (
                <div
                  key={idx}
                  className="bg-white border border-slate-300 shadow-lg rounded-sm overflow-hidden"
                >
                  <img
                    src={src}
                    alt={`מסמך סיכום PDF - עמוד ${idx + 1}`}
                    className="w-full h-auto block"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

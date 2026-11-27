import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  FileAudio,
  FileText,
  Headphones,
  Loader2,
  Mic,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Send,
  ShieldAlert,
  Square,
  Upload,
  User,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { createRecording, fetchRecordingAudioBlob, updateRecordingDuration } from '../api';
import { INSTITUTIONAL_DEPARTMENTS } from '../constants';
import type { CallAnalysisReport, CallStatus, CustomerRecord, PbxRecording, SystemSnapshot } from '../types';
import { EMOTION_LABEL, EMOTION_MOOD, Face, churnColors } from './wrapup/sentimentUi';

interface PbxCenterProps {
  token: string;
  recordings: PbxRecording[];
  customers: CustomerRecord[];
  /** WrapUpAI: הדוחות, כדי להציג רגש וסיכון נטישה בכל שורה */
  reports: CallAnalysisReport[];
  selectedRecordingId: string | null;
  onSelectRecording: (recordingId: string) => void;
  onTransferToExternal: (recordingId: string, sendCustomerEmail?: boolean) => Promise<void>;
  onOpenCustomerReport: (customerId: string, reportId?: string) => void;
  onOpenPdf: (reportId: string) => void;
  onSnapshotUpdate: (snapshot: SystemSnapshot) => void;
  transferringId: string | null;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function probeMediaDurationSeconds(blob: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob);
    const mediaEl = document.createElement('video');
    mediaEl.preload = 'metadata';

    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      mediaEl.removeAttribute('src');
      mediaEl.load();
      URL.revokeObjectURL(objectUrl);
      resolve(value);
    };

    const timer = window.setTimeout(() => finish(null), 3500);
    mediaEl.onloadedmetadata = () => {
      const dur = mediaEl.duration;
      if (Number.isFinite(dur) && dur > 0) {
        finish(Math.max(1, Math.round(dur)));
      } else {
        finish(null);
      }
    };
    mediaEl.onerror = () => finish(null);
    mediaEl.src = objectUrl;
  });
}

function formatCallDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function renderStatusLabel(status: CallStatus) {
  switch (status) {
    case 'pending_transfer':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span>ממתין לשליחה</span>
        </span>
      );
    case 'transferring':
    case 'analyzing_external':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600 shrink-0" />
          <span>בעיבוד חיצוני מוגבל</span>
        </span>
      );
    case 'report_returned':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>דוח התקבל לכרטיס</span>
        </span>
      );
  }
}

export const PbxCenter: React.FC<PbxCenterProps> = ({
  token,
  recordings,
  customers,
  reports,
  selectedRecordingId,
  onSelectRecording,
  onTransferToExternal,
  onOpenCustomerReport,
  onOpenPdf,
  onSnapshotUpdate,
  transferringId,
}) => {
  // WrapUpAI: האם לשלוח סיכום במייל גם ללקוח (כבוי כברירת מחדל)
  const [sendCustomerEmail, setSendCustomerEmail] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'processing' | 'returned'>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<1 | 1.25 | 1.5>(1);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.9);
  const loadedRecIdRef = useRef<string | null>(null);
  const pendingAutoPlayIdRef = useRef<string | null>(null);

  // Add Call Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<'upload' | 'record' | 'tts'>('upload');
  const [selectedCustomerId, setSelectedCustomerId] = useState(customers[0]?.id || '');
  const [selectedDepartment, setSelectedDepartment] = useState(
    customers[0]?.department || INSTITUTIONAL_DEPARTMENTS[0]
  );
  const [uploadedFile, setUploadedFile] = useState<{
    name: string;
    base64: string;
    mimeType: string;
    durationSeconds?: number | null;
  } | null>(null);
  const [speaker1Text, setSpeaker1Text] = useState(
    'שלום, מדבר נציג המוקד. התקשרתי לעדכן לגבי המסמכים החסרים בתיק שלך.'
  );
  const [speaker2Text, setSpeaker2Text] = useState(
    'שלום ותודה על הפנייה. העברתי את האישור מהמעסיק היום בבוקר ואשמח לדעת מתי התיק יאושר.'
  );
  const [speaker3Text, setSpeaker3Text] = useState(
    'מצטרף לשיחה כגורם מלווה — האישור הרפואי והנספחים חתומים ומוכנים לקליטה במערכת.'
  );
  const [submittingCall, setSubmittingCall] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Microphone recording state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const micStartTimeRef = useRef<number>(0);
  const [isMicRecording, setIsMicRecording] = useState(false);

  const selectedRecording = useMemo(
    () => recordings.find((r) => r.id === selectedRecordingId) || recordings[0] || null,
    [recordings, selectedRecordingId]
  );

  useEffect(() => {
    if (!selectedCustomerId && customers[0]) {
      setSelectedCustomerId(customers[0].id);
      setSelectedDepartment(customers[0].department);
    }
  }, [customers, selectedCustomerId]);

  const filteredRecordings = useMemo(() => {
    return recordings.filter((rec) => {
      if (statusFilter === 'pending' && rec.status !== 'pending_transfer') return false;
      if (
        statusFilter === 'processing' &&
        rec.status !== 'analyzing_external' &&
        rec.status !== 'transferring'
      ) {
        return false;
      }
      if (statusFilter === 'returned' && rec.status !== 'report_returned') return false;
      if (departmentFilter !== 'all' && rec.department !== departmentFilter) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      return (
        rec.uniqueCallName.toLowerCase().includes(q) ||
        rec.customerName.toLowerCase().includes(q) ||
        rec.department.toLowerCase().includes(q)
      );
    });
  }, [recordings, searchQuery, statusFilter, departmentFilter]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = muted;
      audioRef.current.volume = volume;
    }
  }, [muted, volume]);

  const loadAndPlayRecording = async (recordingId: string) => {
    if (loadedRecIdRef.current === recordingId && audioUrl && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        await audioRef.current.play();
        setIsPlaying(true);
      }
      return;
    }

    setAudioLoading(true);
    setAudioError(null);
    try {
      const blob = await fetchRecordingAudioBlob(token, recordingId);
      const nextUrl = URL.createObjectURL(blob);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      loadedRecIdRef.current = recordingId;
      setAudioUrl(nextUrl);
      setTimeout(async () => {
        if (audioRef.current) {
          audioRef.current.playbackRate = playbackRate;
          audioRef.current.volume = volume;
          audioRef.current.muted = muted;
          await audioRef.current.play().catch(() => {});
          setIsPlaying(true);
        }
      }, 60);
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : 'שגיאה בטעינת קובץ השמע.');
    } finally {
      setAudioLoading(false);
    }
  };

  // Reset player if user switches to a different call, and autoplay if requested from row button
  useEffect(() => {
    if (!selectedRecording) return;
    if (loadedRecIdRef.current !== selectedRecording.id) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      setAudioUrl(null);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(selectedRecording.durationSeconds);
      setAudioError(null);
      loadedRecIdRef.current = null;
    }
    if (pendingAutoPlayIdRef.current === selectedRecording.id) {
      pendingAutoPlayIdRef.current = null;
      void loadAndPlayRecording(selectedRecording.id);
    }
  }, [selectedRecording?.id]);

  const handleLoadAndTogglePlay = async () => {
    if (!selectedRecording) return;
    await loadAndPlayRecording(selectedRecording.id);
  };

  const handleRowListenClick = (recordingId: string) => {
    if (selectedRecording?.id !== recordingId) {
      pendingAutoPlayIdRef.current = recordingId;
      onSelectRecording(recordingId);
    } else {
      void loadAndPlayRecording(recordingId);
    }
  };

  const handleSeek = (nextTime: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(nextTime, duration || 0));
    setCurrentTime(audioRef.current.currentTime);
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAddError(null);
    if (file.size > 20 * 1024 * 1024) {
      setAddError('גודל הקובץ חורג מהמגבלה המותרת (20MB).');
      return;
    }

    const lowerName = file.name.toLowerCase();
    let resolvedMime = (file.type || '').split(';')[0].trim().toLowerCase();
    if (!resolvedMime) {
      if (lowerName.endsWith('.mp4')) resolvedMime = 'video/mp4';
      else if (lowerName.endsWith('.m4a')) resolvedMime = 'audio/mp4';
      else if (lowerName.endsWith('.mp3')) resolvedMime = 'audio/mpeg';
      else if (lowerName.endsWith('.webm')) resolvedMime = 'audio/webm';
      else if (lowerName.endsWith('.ogg')) resolvedMime = 'audio/ogg';
      else resolvedMime = 'audio/wav';
    }

    const probedDuration = await probeMediaDurationSeconds(file);

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || '';
      setUploadedFile({
        name: file.name,
        base64,
        mimeType: resolvedMime,
        durationSeconds: probedDuration,
      });
    };
    reader.readAsDataURL(file);
  };

  const startMicRecording = async () => {
    setAddError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      micStartTimeRef.current = Date.now();
      recorder.ondataavailable = (evt) => {
        if (evt.data.size > 0) recordedChunksRef.current.push(evt.data);
      };
      recorder.onstop = async () => {
        const elapsedSec = Math.max(1, Math.round((Date.now() - micStartTimeRef.current) / 1000));
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop());
        const probedDuration = await probeMediaDurationSeconds(blob);
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1] || '';
          setUploadedFile({
            name: 'הקלטת-מיקרופון.webm',
            base64,
            mimeType: blob.type || 'audio/webm',
            durationSeconds: probedDuration ?? elapsedSec,
          });
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsMicRecording(true);
    } catch {
      setAddError('לא ניתן לגשת למיקרופון בדפדפן. ניתן להעלות קובץ שמע או להפיק שיחת AI.');
    }
  };

  const stopMicRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsMicRecording(false);
  };

  const handleCreateCallSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    setSubmittingCall(true);
    try {
      let snapshot: SystemSnapshot;
      if (addMode === 'upload' || addMode === 'record') {
        if (!uploadedFile) {
          throw new Error('יש לבחור קובץ שמע או להקליט שיחה לפני השמירה.');
        }
        snapshot = await createRecording(token, {
          customerId: selectedCustomerId,
          department: selectedDepartment,
          mode: 'upload',
          audioBase64: uploadedFile.base64,
          mimeType: uploadedFile.mimeType,
          durationSeconds: uploadedFile.durationSeconds ?? undefined,
        });
      } else {
        const customer = customers.find((c) => c.id === selectedCustomerId);
        snapshot = await createRecording(token, {
          customerId: selectedCustomerId,
          department: selectedDepartment,
          mode: 'tts',
          dialogueScript: [
            {
              speakerLabel: 'משתתף א׳',
              role: 'נציג שירות',
              voiceName: 'Kore',
              style: 'Professional Israeli service representative',
              text: speaker1Text,
            },
            {
              speakerLabel: 'משתתף ב׳',
              role: `מבוטח (${customer?.fullName || 'לקוח'})`,
              voiceName: 'Puck',
              style: 'Clear Israeli caller',
              text: speaker2Text,
            },
            ...(speaker3Text.trim()
              ? [
                  {
                    speakerLabel: 'משתתף ג׳',
                    role: 'גורם מלווה / מעסיק',
                    voiceName: 'Zephyr',
                    style: 'Professional participant',
                    text: speaker3Text,
                  },
                ]
              : []),
          ],
        });
      }
      onSnapshotUpdate(snapshot);
      if (snapshot.recordings[0]) {
        onSelectRecording(snapshot.recordings[0].id);
      }
      setShowAddModal(false);
      setUploadedFile(null);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'שגיאה ביצירת הקלטת השיחה.');
    } finally {
      setSubmittingCall(false);
    }
  };

  const waveformBars = [26, 44, 68, 52, 82, 38, 60, 90, 48, 72, 35, 64, 84, 42, 56, 76, 32, 66, 80, 46, 58, 70, 40, 62];
  const progressRatio = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  // ---- WrapUpAI · עיצוב אפשרות A (טבלת כרטיסים) ----
  const AVATAR_COLORS: Array<[string, string]> = [
    ['#FFD6E0', '#8C2F4A'],
    ['#DCE4FF', '#2B3F8F'],
    ['#D6F5E3', '#1F6B45'],
    ['#FFE1CC', '#9A4A12'],
    ['#FFF1C9', '#8A6100'],
    ['#E9E4FF', '#4A3BB8'],
  ];
  const avatarFor = (key: string): [string, string] => {
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  };
  const initialsOf = (name: string) =>
    name
      .replace(/[׳"']/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('');
  const STATUS_PILL: Record<CallStatus, [string, string, string, string]> = {
    pending_transfer: ['ממתין לשליחה', '#F1F2F6', '#6B7280', '#9AA0AA'],
    transferring: ['בניתוח עכשיו', '#EEF0FF', '#5B4CF0', '#5B4CF0'],
    analyzing_external: ['בניתוח עכשיו', '#EEF0FF', '#5B4CF0', '#5B4CF0'],
    report_returned: ['דוח התקבל', '#E3F6EA', '#2F7D52', '#2F9E6A'],
  };
  const sentimentOf = (rec: PbxRecording) => reports.find((r) => r.id === rec.reportId)?.wrapup?.sentiment;
  const todayKey = new Date().toDateString();
  const stats = {
    today: recordings.filter((r) => new Date(r.callDate).toDateString() === todayKey).length,
    returned: recordings.filter((r) => r.status === 'report_returned').length,
    analyzing: recordings.filter((r) => r.status === 'analyzing_external' || r.status === 'transferring'),
    pending: recordings.filter((r) => r.status === 'pending_transfer'),
  };
  const avgDuration = recordings.length
    ? Math.round(recordings.reduce((n, r) => n + (r.durationSeconds || 0), 0) / recordings.length)
    : 0;
  const ROW_GRID = 'lg:grid lg:grid-cols-[minmax(180px,1fr)_150px_118px_72px_44px_96px_124px_128px] lg:items-center lg:gap-3';

  const Avatar = ({ name, id, size = 44 }: { name: string; id: string; size?: number }) => {
    const [bg, fg] = avatarFor(id);
    return (
      <span
        className="rounded-full flex items-center justify-center font-extrabold shrink-0"
        style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.34 }}
      >
        {initialsOf(name)}
      </span>
    );
  };
  const Pill = ({ status }: { status: CallStatus }) => {
    const [label, bg, fg, dot] = STATUS_PILL[status];
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap" style={{ background: bg, color: fg }}>
        {status === 'analyzing_external' || status === 'transferring' ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <span className="w-2 h-2 rounded-full" style={{ background: dot }} />
        )}
        {label}
      </span>
    );
  };

  return (
    <div className="bg-[#F4F2FF] rounded-[24px] p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[260px] text-right">
          <h2 className="text-[26px] font-extrabold text-[#1E1B4B]">מרכזיית הקלטות שיחה</h2>
          <p className="text-[13px] font-medium text-[#8A8FA3]">כל השיחות שהוקלטו, מה כבר נותח ומה מחכה לשליחה</p>
        </div>
        <label className="relative">
          <Search className="w-4 h-4 text-[#A3A7BD] absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="חיפוש לפי שם שיחה, לקוח או מחלקה..."
            className="w-[300px] max-w-full pr-10 pl-3 py-3 text-sm bg-white rounded-xl border border-transparent focus:outline-none focus:ring-2 focus:ring-[#5B4CF0]"
          />
        </label>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold bg-[#5B4CF0] hover:bg-[#4A3BDF] text-white rounded-xl transition-colors whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          קליטת הקלטה חדשה
        </button>
      </div>

      {/* Stat cards (click = filter) */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {(
          [
            { label: 'הקלטות היום', value: stats.today, sub: `משך ממוצע ${formatDuration(avgDuration)}`, bg: '#FFF1DE', fg: '#D9822B', Icon: Mic, filter: 'all' },
            { label: 'דוחות שהתקבלו', value: stats.returned, sub: 'עם סיכום ו-PDF בתיק', bg: '#E3F6EA', fg: '#2F9E6A', Icon: CheckCircle2, filter: 'returned' },
            { label: 'בניתוח עכשיו', value: stats.analyzing.length, sub: stats.analyzing[0]?.customerName || 'אין כרגע', bg: '#EEF0FF', fg: '#5B4CF0', Icon: Loader2, filter: 'processing' },
            { label: 'ממתינות לשליחה', value: stats.pending.length, sub: stats.pending[0]?.customerName || 'הכל נשלח', bg: '#F1F2F6', fg: '#6B7280', Icon: Clock, filter: 'pending' },
          ] as const
        ).map(({ label, value, sub, bg, fg, Icon, filter }) => (
          <button
            key={label}
            onClick={() => setStatusFilter(filter)}
            className={`bg-white rounded-[18px] px-[18px] py-4 flex items-center gap-3.5 text-right transition-shadow hover:shadow-md ${
              statusFilter === filter && filter !== 'all' ? 'ring-2 ring-[#8B7CF6]' : ''
            }`}
          >
            <span className="w-12 h-12 rounded-[14px] flex items-center justify-center shrink-0" style={{ background: bg }}>
              <Icon className="w-6 h-6" style={{ color: fg }} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-bold text-[#8A8FA3]">{label}</span>
              <span className="block text-[30px] leading-tight font-extrabold text-[#1E1B4B]">{value}</span>
              <span className="block text-xs font-medium text-[#A3A7BD] truncate">{sub}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Now playing */}
      {selectedRecording && (
        <section className="bg-white rounded-[22px] p-5 sm:p-[22px] space-y-4 shadow-[0_6px_20px_rgba(91,76,240,0.08)]">
          <div className="flex flex-wrap items-center gap-3">
            <Avatar name={selectedRecording.customerName} id={selectedRecording.customerId} size={56} />
            <div className="flex-1 min-w-[240px] text-right space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => onOpenCustomerReport(selectedRecording.customerId, selectedRecording.reportId)}
                  className="text-xl font-extrabold text-[#1E1B4B] hover:text-[#5B4CF0]"
                >
                  {selectedRecording.customerName}
                </button>
                <Pill status={selectedRecording.status} />
              </div>
              <div className="text-[13px] font-medium text-[#8A8FA3]">
                {selectedRecording.department} · {formatCallDate(selectedRecording.callDate)} ·{' '}
                <span dir="ltr" className="font-mono">
                  {selectedRecording.uniqueCallName}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <button
                onClick={() => onTransferToExternal(selectedRecording.id, sendCustomerEmail)}
                disabled={transferringId === selectedRecording.id || selectedRecording.status === 'analyzing_external'}
                className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold bg-[#5B4CF0] hover:bg-[#4A3BDF] disabled:bg-[#A79CF8] text-white rounded-xl"
              >
                {transferringId === selectedRecording.id || selectedRecording.status === 'analyzing_external' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> מתמלל ומנתח...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    {selectedRecording.status === 'report_returned' ? 'תמלל ונתח מחדש עם WrapUpAI' : 'תמלל ונתח עם WrapUpAI'}
                  </>
                )}
              </button>
              {selectedRecording.status === 'report_returned' && selectedRecording.reportId && (
                <>
                  <button
                    onClick={() => onOpenPdf(selectedRecording.reportId!)}
                    className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold bg-white border-[1.5px] border-[#5B4CF0] text-[#5B4CF0] hover:bg-[#F5F4FF] rounded-xl"
                  >
                    <FileText className="w-4 h-4" /> פתח PDF
                  </button>
                  <button
                    onClick={() => onOpenCustomerReport(selectedRecording.customerId, selectedRecording.reportId)}
                    className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold bg-white border-[1.5px] border-[#5B4CF0] text-[#5B4CF0] hover:bg-[#F5F4FF] rounded-xl"
                  >
                    <User className="w-4 h-4" /> כרטיס לקוח
                  </button>
                </>
              )}
              <label
                className="inline-flex items-center gap-2.5 px-3 py-2 text-sm font-semibold text-[#1E1B4B] bg-[#F4F5F9] rounded-xl cursor-pointer select-none"
                title="אם מסומן, WrapUpAI ישלח ללקוח מייל עם סיכום השיחה"
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={sendCustomerEmail}
                  onClick={() => setSendCustomerEmail((v) => !v)}
                  className={`relative w-10 h-6 rounded-full transition-colors ${sendCustomerEmail ? 'bg-[#2F9E6A]' : 'bg-[#C9CCD6]'}`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${sendCustomerEmail ? 'right-[18px]' : 'right-0.5'}`}
                  />
                </button>
                📧 שלח סיכום גם ללקוח
              </label>
            </div>
          </div>

          {audioUrl && (
            <audio
              ref={audioRef}
              src={audioUrl}
              onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
              onLoadedMetadata={() => {
                const mediaDur = audioRef.current?.duration;
                if (mediaDur && Number.isFinite(mediaDur) && mediaDur > 0) {
                  setDuration(mediaDur);
                  const rounded = Math.max(1, Math.round(mediaDur));
                  if (Math.abs(rounded - selectedRecording.durationSeconds) >= 1) {
                    void updateRecordingDuration(token, selectedRecording.id, rounded)
                      .then(onSnapshotUpdate)
                      .catch(() => {});
                  }
                } else {
                  setDuration(selectedRecording.durationSeconds);
                }
              }}
              onEnded={() => setIsPlaying(false)}
            />
          )}

          {/* Player */}
          <div className="flex flex-wrap items-center gap-3.5 bg-[#F7F5FF] rounded-2xl px-[18px] py-3.5">
            <button
              onClick={handleLoadAndTogglePlay}
              disabled={audioLoading}
              className="w-12 h-12 rounded-full bg-[#5B4CF0] hover:bg-[#4A3BDF] disabled:opacity-60 text-white flex items-center justify-center shrink-0"
              title={isPlaying ? 'השהה האזנה' : 'הפעל הקלטת שיחה'}
            >
              {audioLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
            <button onClick={() => handleSeek(currentTime - 10)} disabled={!audioUrl} className="p-2 text-[#6B66A8] disabled:opacity-40 rounded-lg hover:bg-white" title="אחורה 10 שניות">
              <RotateCw className="w-4 h-4" />
            </button>
            <button onClick={() => handleSeek(currentTime + 10)} disabled={!audioUrl} className="p-2 text-[#6B66A8] disabled:opacity-40 rounded-lg hover:bg-white" title="קדימה 10 שניות">
              <RotateCcw className="w-4 h-4" />
            </button>
            <div className="flex-1 min-w-[200px] flex items-center gap-1 h-12" aria-label="ציר זמן הקלטה">
              {waveformBars.map((heightPct, idx) => {
                const barRatio = (idx + 1) / waveformBars.length;
                const active = barRatio <= progressRatio;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSeek(barRatio * duration)}
                    disabled={!audioUrl}
                    className={`flex-1 rounded-full transition-colors ${active ? 'bg-[#8B7CF6]' : 'bg-[#D9D4FB] hover:bg-[#C4BCF8]'}`}
                    style={{ height: `${heightPct}%` }}
                  />
                );
              })}
            </div>
            <span className="text-[13px] font-bold tabular-nums text-[#6B66A8]" dir="ltr">
              {formatDuration(currentTime)} / {formatDuration(duration || selectedRecording.durationSeconds)}
            </span>
            <div className="flex items-center gap-1.5">
              {([1, 1.25, 1.5] as const).map((rate) => (
                <button
                  key={rate}
                  onClick={() => setPlaybackRate(rate)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold tabular-nums ${
                    playbackRate === rate ? 'bg-[#5B4CF0] text-white' : 'bg-white text-[#6B66A8] hover:bg-[#EEF0FF]'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setMuted((m) => !m)} className="p-1.5 text-[#6B66A8] rounded" title={muted ? 'בטל השתקה' : 'השתק'}>
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  setMuted(false);
                  setVolume(Number(e.target.value));
                }}
                className="w-16 accent-[#5B4CF0] h-1 cursor-pointer"
                aria-label="עוצמת שמע"
              />
            </div>
          </div>

          {audioError && (
            <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{audioError}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-bold text-[#8A8FA3]">משתתפים:</span>
            {selectedRecording.participants.map((p) => {
              const [bg] = avatarFor(p.anonymizedLabel + p.displayName);
              return (
                <span key={p.anonymizedLabel} className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold text-[#3D3A6B]" style={{ background: bg }}>
                  {p.displayName}
                </span>
              );
            })}
            <span className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold bg-[#FFF6D6] text-[#8A6100]">
              🔒 רק השמע נשלח החוצה, בלי ת״ז ופרטי תיק
            </span>
          </div>
        </section>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xl font-extrabold text-[#1E1B4B] ml-2">הקלטות</h3>
        {(
          [
            { id: 'all', label: `הכל (${recordings.length})` },
            { id: 'pending', label: `ממתינות (${stats.pending.length})` },
            { id: 'processing', label: `בעיבוד (${stats.analyzing.length})` },
            { id: 'returned', label: `דוח הוחזר (${stats.returned})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setStatusFilter(tab.id)}
            className={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition-colors ${
              statusFilter === tab.id ? 'bg-[#1E1B4B] text-white' : 'bg-white text-[#5F6672] hover:bg-[#EEF0FF]'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <span className="flex-1" />
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          aria-label="סינון לפי מחלקה"
          className="px-4 py-2 text-[13px] font-semibold text-[#3D3A6B] bg-white rounded-full focus:outline-none focus:ring-2 focus:ring-[#5B4CF0]"
        >
          <option value="all">כל המחלקות</option>
          {INSTITUTIONAL_DEPARTMENTS.map((dept) => (
            <option key={dept} value={dept}>
              {dept}
            </option>
          ))}
        </select>
      </div>

      {/* Column headers */}
      <div className={`hidden ${ROW_GRID} px-[18px] text-xs font-bold text-[#9A97C2]`}>
        <span>לקוח</span>
        <span className="text-center">שיחה</span>
        <span className="text-center">משך</span>
        <span className="text-center">משתתפים</span>
        <span className="text-center">רגש</span>
        <span className="text-center">סיכון נטישה</span>
        <span className="text-center">סטטוס</span>
        <span className="text-center">פעולות</span>
      </div>

      {/* Rows */}
      <div className="space-y-2.5">
        {filteredRecordings.length === 0 && (
          <div className="bg-white rounded-2xl py-10 text-center text-sm text-[#8A8FA3]">לא נמצאו הקלטות תואמות לחיפוש הנוכחי.</div>
        )}
        {filteredRecordings.map((rec) => {
          const isSelected = selectedRecording?.id === rec.id;
          const isBusy = transferringId === rec.id || rec.status === 'analyzing_external';
          const s = sentimentOf(rec);
          const churn = churnColors(s ? s.churnRisk : null);
          const rowWave = [8, 14, 10, 18, 12, 20, 9, 16, 11, 6];
          return (
            <div
              key={rec.id}
              onClick={() => onSelectRecording(rec.id)}
              className={`cursor-pointer bg-white rounded-2xl px-[18px] py-3 flex flex-wrap items-center gap-3 ${ROW_GRID} transition-shadow hover:shadow-[0_6px_16px_rgba(91,76,240,0.10)] ${
                isSelected ? 'ring-2 ring-[#8B7CF6] shadow-[0_6px_16px_rgba(91,76,240,0.10)]' : 'shadow-[0_3px_12px_rgba(91,76,240,0.06)]'
              }`}
            >
              {/* customer */}
              <div className="flex items-center gap-3 min-w-0 flex-1 lg:flex-none">
                <Avatar name={rec.customerName} id={rec.customerId} />
                <div className="min-w-0 text-right">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenCustomerReport(rec.customerId, rec.reportId);
                    }}
                    className="block text-[15px] font-extrabold text-[#1E1B4B] hover:text-[#5B4CF0] truncate max-w-full"
                  >
                    {rec.customerName}
                  </button>
                  <div className="text-xs font-medium text-[#8A8FA3] truncate" title={rec.department}>
                    {rec.department}
                  </div>
                </div>
              </div>
              {/* call */}
              <div className="flex flex-col items-start lg:items-center gap-1">
                <span dir="ltr" className="px-2 py-0.5 rounded-md bg-[#F4F2FF] text-[11px] font-semibold font-mono text-[#6B66A8] truncate max-w-[146px]" title={rec.uniqueCallName}>
                  {rec.uniqueCallName}
                </span>
                <span className="text-xs font-medium text-[#8A8FA3] tabular-nums">{formatCallDate(rec.callDate)}</span>
              </div>
              {/* duration + mini wave */}
              <div className="flex items-center justify-center gap-2">
                <span className="flex items-center gap-[3px]" aria-hidden="true">
                  {rowWave.map((h, i) => (
                    <span key={i} className="w-1 rounded-full" style={{ height: h, background: i < 6 ? '#8B7CF6' : '#D9D4FB' }} />
                  ))}
                </span>
                <span className="text-[13px] font-bold tabular-nums text-[#3D3A6B]">{formatDuration(rec.durationSeconds)}</span>
              </div>
              {/* participants */}
              <div className="flex items-center justify-center">
                {rec.participants.slice(0, 2).map((p, i) => {
                  const [bg, fg] = avatarFor(p.anonymizedLabel + p.displayName);
                  return (
                    <span
                      key={p.anonymizedLabel}
                      title={p.displayName}
                      className="w-[30px] h-[30px] rounded-full border-2 border-white flex items-center justify-center text-[11px] font-bold"
                      style={{ background: bg, color: fg, marginInlineStart: i ? -8 : 0 }}
                    >
                      {initialsOf(p.displayName)[0]}
                    </span>
                  );
                })}
                {rec.participants.length > 2 && (
                  <span className="w-[30px] h-[30px] rounded-full border-2 border-white bg-[#EEF0FF] text-[#3D3A6B] flex items-center justify-center text-[11px] font-bold" style={{ marginInlineStart: -8 }}>
                    +{rec.participants.length - 2}
                  </span>
                )}
              </div>
              {/* emotion */}
              <div className="flex justify-center" title={s ? EMOTION_LABEL[s.endEmotion] : 'עוד לא נותח'}>
                <Face mood={s ? EMOTION_MOOD[s.endEmotion] : 'Neutral'} size={34} active={Boolean(s)} />
              </div>
              {/* churn */}
              <div className="w-[96px] space-y-1">
                <div className="text-xs font-extrabold text-right" style={{ color: churn.text }}>
                  {s ? `${s.churnRisk}%` : '—'}
                </div>
                <div className="h-1.5 rounded-full bg-[#EDEBFA] overflow-hidden flex justify-start">
                  <div className="h-full rounded-full" style={{ width: `${s?.churnRisk ?? 0}%`, background: churn.bar }} />
                </div>
              </div>
              {/* status */}
              <div className="flex justify-center">
                <Pill status={rec.status} />
              </div>
              {/* actions */}
              <div className="flex items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => handleRowListenClick(rec.id)}
                  className="w-9 h-9 rounded-[10px] bg-[#5B4CF0] hover:bg-[#4A3BDF] text-white flex items-center justify-center"
                  title="האזנה"
                >
                  <Play className="w-4 h-4" />
                </button>
                <button
                  onClick={() => rec.reportId && onOpenPdf(rec.reportId)}
                  disabled={!(rec.status === 'report_returned' && rec.reportId)}
                  className="w-9 h-9 rounded-[10px] bg-[#EEF0FF] text-[#5B4CF0] hover:bg-[#E2E0FF] disabled:opacity-35 flex items-center justify-center"
                  title="פתח PDF"
                >
                  <FileText className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    onSelectRecording(rec.id);
                    void onTransferToExternal(rec.id);
                  }}
                  disabled={isBusy}
                  className="w-9 h-9 rounded-[10px] bg-[#F4F5F9] text-[#6B66A8] hover:bg-[#EEF0FF] disabled:opacity-50 flex items-center justify-center"
                  title={rec.status === 'report_returned' ? 'תמלל וסכם מחדש' : 'שלח לתמלול וסיכום'}
                >
                  {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Upload / Record New Call Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">קליטת הקלטת שיחה חדשה למרכזיה</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCallSubmit} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    שיוך לכרטיס לקוח / מבוטח
                  </label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSelectedCustomerId(nextId);
                      const cust = customers.find((c) => c.id === nextId);
                      if (cust) {
                        setSelectedDepartment(cust.department);
                      }
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName} ({c.caseNumber})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    מחלקה מטפלת בשיחה
                  </label>
                  <select
                    value={selectedDepartment}
                    onChange={(e) => setSelectedDepartment(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {INSTITUTIONAL_DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: 'upload', label: 'העלאת קובץ (MP4 / שמע)', icon: Upload },
                    { id: 'record', label: 'הקלטה ממיקרופון', icon: Mic },
                    { id: 'tts', label: 'הפקת שיחת AI רב-משתתפים', icon: Users },
                  ] as const
                ).map((modeOption) => {
                  const Icon = modeOption.icon;
                  return (
                    <button
                      type="button"
                      key={modeOption.id}
                      onClick={() => setAddMode(modeOption.id)}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        addMode === modeOption.id
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{modeOption.label}</span>
                    </button>
                  );
                })}
              </div>

              {addMode === 'upload' && (
                <div className="border border-dashed border-slate-300 rounded-lg p-5 text-center space-y-2 bg-slate-50">
                  <Upload className="w-6 h-6 text-slate-400 mx-auto" />
                  <p className="text-xs text-slate-600">
                    בחרו קובץ שמע או וידאו בפורמט MP4, WAV, MP3, WebM, M4A או OGG (עד 20MB)
                  </p>
                  <label className="inline-block px-3.5 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50">
                    <span>בחר קובץ מהמחשב</span>
                    <input
                      type="file"
                      accept="audio/*,video/mp4,.mp4,.m4a"
                      onChange={handleFilePick}
                      className="hidden"
                    />
                  </label>
                  {uploadedFile && (
                    <p className="text-xs font-medium text-emerald-700 pt-1">
                      נבחר: {uploadedFile.name}
                      {uploadedFile.durationSeconds ? ` (${formatDuration(uploadedFile.durationSeconds)})` : ''}
                    </p>
                  )}
                </div>
              )}

              {addMode === 'record' && (
                <div className="border border-slate-200 rounded-lg p-5 text-center space-y-3 bg-slate-50">
                  {isMicRecording ? (
                    <button
                      type="button"
                      onClick={stopMicRecording}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg"
                    >
                      <Square className="w-3.5 h-3.5" />
                      <span>עצור הקלטה ושמור טיוטה</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={startMicRecording}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#0F2942] hover:bg-slate-800 text-white rounded-lg"
                    >
                      <Mic className="w-3.5 h-3.5" />
                      <span>התחל הקלטת מיקרופון</span>
                    </button>
                  )}
                  {uploadedFile && (
                    <p className="text-xs font-medium text-emerald-700">
                      הוקלט קובץ: {uploadedFile.name}
                      {uploadedFile.durationSeconds ? ` (${formatDuration(uploadedFile.durationSeconds)})` : ''}
                    </p>
                  )}
                </div>
              )}

              {addMode === 'tts' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      משתתף א׳ (נציג שירות)
                    </label>
                    <textarea
                      rows={2}
                      value={speaker1Text}
                      onChange={(e) => setSpeaker1Text(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      משתתף ב׳ (לקוח / מבוטח)
                    </label>
                    <textarea
                      rows={2}
                      value={speaker2Text}
                      onChange={(e) => setSpeaker2Text(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      משתתף ג׳ (מעסיק / מלווה — אופציונלי)
                    </label>
                    <textarea
                      rows={2}
                      value={speaker3Text}
                      onChange={(e) => setSpeaker3Text(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
              )}

              {addError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {addError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  disabled={submittingCall}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white rounded-lg"
                >
                  {submittingCall && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{submittingCall ? 'שומר ומפיק שמע...' : 'קלוט שיחה למרכזיה'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

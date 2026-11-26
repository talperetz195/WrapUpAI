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
import type { CallStatus, CustomerRecord, PbxRecording, SystemSnapshot } from '../types';

interface PbxCenterProps {
  token: string;
  recordings: PbxRecording[];
  customers: CustomerRecord[];
  selectedRecordingId: string | null;
  onSelectRecording: (recordingId: string) => void;
  onTransferToExternal: (recordingId: string) => Promise<void>;
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
  selectedRecordingId,
  onSelectRecording,
  onTransferToExternal,
  onOpenCustomerReport,
  onOpenPdf,
  onSnapshotUpdate,
  transferringId,
}) => {
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

  return (
    <div className="space-y-6">
      {/* Integrated Playback & One-Click Controlled Transfer Panel */}
      {selectedRecording && (
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <Headphones className="w-4 h-4 text-blue-700 shrink-0" />
                <h2 className="text-base font-bold text-slate-900 font-mono truncate">
                  {selectedRecording.uniqueCallName}
                </h2>
                <span className="text-slate-300" aria-hidden="true">·</span>
                {renderStatusLabel(selectedRecording.status)}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600 flex-wrap">
                <button
                  onClick={() => onOpenCustomerReport(selectedRecording.customerId, selectedRecording.reportId)}
                  className="font-semibold text-blue-700 hover:underline inline-flex items-center gap-1"
                >
                  <User className="w-3.5 h-3.5" />
                  <span>{selectedRecording.customerName}</span>
                </button>
                <span aria-hidden="true">·</span>
                <span>{selectedRecording.department}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{formatCallDate(selectedRecording.callDate)}</span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-slate-400" />
                  <span>{selectedRecording.participants.length} משתתפים</span>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0 flex-wrap">
              {selectedRecording.status === 'report_returned' && selectedRecording.reportId ? (
                <>
                  <button
                    onClick={() => onOpenPdf(selectedRecording.reportId!)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#0F2942] hover:bg-slate-800 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <FileText className="w-4 h-4" />
                    <span>פתח מסמך PDF</span>
                  </button>
                  <button
                    onClick={() => onOpenCustomerReport(selectedRecording.customerId, selectedRecording.reportId)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>כרטיס לקוח</span>
                  </button>
                </>
              ) : null}

              <button
                onClick={() => onTransferToExternal(selectedRecording.id)}
                disabled={
                  transferringId === selectedRecording.id ||
                  selectedRecording.status === 'analyzing_external'
                }
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 disabled:text-slate-600 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {transferringId === selectedRecording.id || selectedRecording.status === 'analyzing_external' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>מעביר למערכת החיצונית...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>
                      {selectedRecording.status === 'report_returned'
                        ? 'תמלל ונתח מחדש חיצונית'
                        : 'העבר למערכת תמלול וניתוח בלחיצה אחת'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Audio Player Bar */}
          <div className="pt-4 space-y-3">
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

            <div className="flex flex-col md:flex-row md:items-center gap-4 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleLoadAndTogglePlay}
                  disabled={audioLoading}
                  className="w-10 h-10 rounded-lg bg-[#0F2942] hover:bg-slate-800 disabled:opacity-60 text-white flex items-center justify-center transition-colors"
                  title={isPlaying ? 'השהה האזנה' : 'הפעל הקלטת שיחה'}
                >
                  {audioLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                </button>

                <button
                  onClick={() => handleSeek(currentTime - 10)}
                  disabled={!audioUrl}
                  className="p-2 text-slate-600 hover:text-slate-900 disabled:opacity-40 rounded-md hover:bg-slate-200/60 transition-colors"
                  title="אחורה 10 שניות"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleSeek(currentTime + 10)}
                  disabled={!audioUrl}
                  className="p-2 text-slate-600 hover:text-slate-900 disabled:opacity-40 rounded-md hover:bg-slate-200/60 transition-colors"
                  title="קדימה 10 שניות"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>

              {/* Waveform + Scrubber */}
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-end gap-1 h-7" aria-hidden="true">
                  {waveformBars.map((heightPct, idx) => {
                    const barRatio = (idx + 1) / waveformBars.length;
                    const active = barRatio <= progressRatio;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSeek(barRatio * duration)}
                        disabled={!audioUrl}
                        className={`flex-1 rounded-sm transition-colors ${
                          active ? 'bg-blue-700' : 'bg-slate-300 hover:bg-slate-400'
                        }`}
                        style={{ height: `${heightPct}%` }}
                      />
                    );
                  })}
                </div>
                <input
                  type="range"
                  min={0}
                  max={duration || 1}
                  step={0.1}
                  value={currentTime}
                  disabled={!audioUrl}
                  onChange={(e) => handleSeek(Number(e.target.value))}
                  className="w-full accent-blue-700 h-1.5 cursor-pointer"
                  aria-label="ציר זמן הקלטה"
                />
              </div>

              <div className="flex items-center gap-3 shrink-0 justify-between md:justify-end">
                <span className="text-xs font-mono tabular-nums text-slate-700" dir="ltr">
                  {formatDuration(currentTime)} / {formatDuration(duration)}
                </span>

                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-md p-0.5">
                  {([1, 1.25, 1.5] as const).map((rate) => (
                    <button
                      key={rate}
                      onClick={() => setPlaybackRate(rate)}
                      className={`px-2 py-1 text-xs font-mono tabular-nums rounded transition-colors ${
                        playbackRate === rate
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setMuted((m) => !m)}
                    className="p-1.5 text-slate-600 hover:text-slate-900 rounded"
                    title={muted ? 'בטל השתקה' : 'השתק'}
                  >
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
                    className="w-16 accent-slate-700 h-1 cursor-pointer"
                    aria-label="עוצמת שמע"
                  />
                </div>
              </div>
            </div>

            {audioError && (
              <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{audioError}</span>
              </div>
            )}

            {/* Participants & Security Boundary Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500 pt-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-slate-700">משתתפים מזוהים במרכזיה:</span>
                {selectedRecording.participants.map((p, idx) => (
                  <React.Fragment key={p.anonymizedLabel}>
                    {idx > 0 && <span aria-hidden="true">·</span>}
                    <span>{p.displayName}</span>
                  </React.Fragment>
                ))}
              </div>
              <div className="text-slate-500">
                מדיניות אבטחה: בהעברה החיצונית נשלח קובץ השמע בלבד ללא ת.ז. או פרטי תיק.
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Recordings Toolbar + Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 flex-wrap">
            <div className="relative flex-1 min-w-[210px] max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="חיפוש לפי שם שיחה, לקוח או מחלקה..."
                className="w-full pr-9 pl-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              aria-label="סינון לפי מחלקה"
              className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 shrink-0"
            >
              <option value="all">כל המחלקות</option>
              {INSTITUTIONAL_DEPARTMENTS.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
              {(
                [
                  { id: 'all', label: 'הכל' },
                  { id: 'pending', label: 'ממתינות' },
                  { id: 'processing', label: 'בעיבוד' },
                  { id: 'returned', label: 'דוח הוחזר' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    statusFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#0F2942] hover:bg-slate-800 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>קליטת הקלטה חדשה למרכזיה</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-3">שם שיחה ייחודי</th>
                <th className="py-3 px-3">תאריך ושעה</th>
                <th className="py-3 px-3">שם הלקוח</th>
                <th className="py-3 px-3">מחלקה</th>
                <th className="py-3 px-3">משתתפים</th>
                <th className="py-3 px-3">משך</th>
                <th className="py-3 px-3">סטטוס</th>
                <th className="py-3 px-3 text-left">שליחה לתמלול וסיכום</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredRecordings.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    לא נמצאו הקלטות תואמות לחיפוש הנוכחי.
                  </td>
                </tr>
              ) : (
                filteredRecordings.map((rec) => {
                  const isSelected = selectedRecording?.id === rec.id;
                  const isBusy = transferringId === rec.id || rec.status === 'analyzing_external';
                  return (
                    <tr
                      key={rec.id}
                      onClick={() => onSelectRecording(rec.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-3 px-3 font-mono text-xs font-medium text-slate-900 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <FileAudio className="w-4 h-4 text-slate-400 shrink-0" />
                          <span>{rec.uniqueCallName}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {formatCallDate(rec.callDate)}
                      </td>
                      <td className="py-3 px-3 font-medium text-slate-900 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenCustomerReport(rec.customerId, rec.reportId);
                          }}
                          className="hover:text-blue-700 hover:underline"
                        >
                          {rec.customerName}
                        </button>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600 max-w-[160px] truncate" title={rec.department}>
                        {rec.department}
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {rec.participants.length} דוברים
                      </td>
                      <td className="py-3 px-3 text-xs font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {formatDuration(rec.durationSeconds)}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">{renderStatusLabel(rec.status)}</td>
                      <td className="py-3 px-3 text-left whitespace-nowrap">
                        <div className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleRowListenClick(rec.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap"
                          >
                            <Play className="w-3 h-3 text-slate-500" />
                            <span>האזנה</span>
                          </button>

                          {rec.status === 'report_returned' && rec.reportId ? (
                            <>
                              <button
                                onClick={() => onOpenPdf(rec.reportId!)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#0F2942] hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap"
                              >
                                <FileText className="w-3.5 h-3.5" />
                                <span>פתח PDF</span>
                              </button>
                              <button
                                onClick={() => onOpenCustomerReport(rec.customerId, rec.reportId)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md transition-colors whitespace-nowrap"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>כרטיס לקוח</span>
                              </button>
                            </>
                          ) : null}

                          <button
                            onClick={() => {
                              onSelectRecording(rec.id);
                              void onTransferToExternal(rec.id);
                            }}
                            disabled={isBusy}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 disabled:text-slate-600 rounded-md transition-colors whitespace-nowrap"
                          >
                            {isBusy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {isBusy
                                ? 'מתמלל ומסכם...'
                                : rec.status === 'report_returned'
                                ? 'תמלל וסכם מחדש'
                                : 'שלח לתמלול וסיכום'}
                            </span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

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

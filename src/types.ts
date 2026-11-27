export type CallStatus =
  | 'pending_transfer'
  | 'transferring'
  | 'analyzing_external'
  | 'report_returned';

export type TaskPriority = 'דחופה' | 'גבוהה' | 'רגילה';
export type TaskCategory =
  | 'מסמכים'
  | 'ועדה רפואית'
  | 'תשלום וגבייה'
  | 'תיאום פגישה'
  | 'מעקב פנימי'
  | 'אישור מעסיק'
  | 'שיקום והכשרה'
  | 'ערעור ובדיקה מחדש';

export interface CustomerRecord {
  id: string;
  fullName: string;
  nationalId: string;
  idMasked?: boolean;
  phone: string;
  city: string;
  branch: string;
  caseNumber: string;
  department: string;
  assignedHandler: string;
  caseStatus: string;
  /** כתובות מייל לשליחת סיכום השיחה (WrapUpAI). בני זוג = כמה כתובות */
  emails?: string[];
}

export interface PbxRecording {
  id: string;
  uniqueCallName: string;
  callDate: string;
  customerId: string;
  customerName: string;
  department: string;
  participants: Array<{
    anonymizedLabel: string;
    role: string;
    displayName: string;
  }>;
  durationSeconds: number;
  audioSourceType: 'tts_dialogue' | 'uploaded';
  mimeType: string;
  status: CallStatus;
  latestJobId?: string;
  reportId?: string;
}

export interface TopicParticipantStatement {
  speakerLabel: string;
  role: string;
  statementSummary: string;
  keyPoints: string[];
}

export interface ReportTopic {
  topicTitle: string;
  topicSummary: string;
  participantStatements: TopicParticipantStatement[];
}

export interface StructuredActionItem {
  taskId: string;
  title: string;
  description: string;
  owner: string;
  priority: TaskPriority;
  category: TaskCategory;
  suggestedDate: string;
  suggestedTime: string;
  addedToCalendar: boolean;
  calendarEventId?: string;
}

export interface TranscriptLine {
  timestamp: string;
  speakerLabel: string;
  role: string;
  text: string;
}

export interface WrapUpDelivery {
  delivery: string;
  sentTo: string[];
  pdfFileName?: string | null;
  customerPdfFileName?: string | null;
}

export interface CallAnalysisReport {
  id: string;
  /** נתוני מסירה מ-WrapUpAI: מייל ללקוחות + PDF שנשמר בשרת הארגון */
  wrapup?: WrapUpDelivery;
  jobId: string;
  recordingId: string;
  uniqueCallName: string;
  customerId: string;
  customerName: string;
  generatedAt: string;
  returnedAt: string;
  signatureVerified: boolean;
  executiveSummary: string;
  participantsDetected: Array<{
    speakerLabel: string;
    role: string;
  }>;
  topics: ReportTopic[];
  actionItems: StructuredActionItem[];
  transcript: TranscriptLine[];
}

export type ExternalJobStage =
  | 'token_verified'
  | 'transcribing_audio'
  | 'analyzing_topics'
  | 'signing_and_returning'
  | 'completed_and_purged'
  | 'failed';

export interface TransferJob {
  jobId: string;
  recordingId: string;
  uniqueCallName: string;
  customerId: string;
  initiatedBy: string;
  initiatedAt: string;
  completedAt?: string;
  stage: ExternalJobStage;
  audioPurged: boolean;
  error?: string;
  maskedPayload: {
    jobId: string;
    uniqueCallName: string;
    callDate: string;
    anonymizedParticipants: Array<{
      anonymizedLabel: string;
      role: string;
    }>;
    piiStrippedFields: string[];
    tokenScope: 'audio_transcribe_only';
    tokenExpiresAt: string;
  };
  reportId?: string;
}

export interface CalendarEvent {
  id: string;
  customerId: string;
  customerName: string;
  reportId?: string;
  sourceTaskId?: string;
  title: string;
  description: string;
  date: string;
  time: string;
  category: TaskCategory;
  priority: TaskPriority;
  owner: string;
  completed: boolean;
  createdAt: string;
}

export interface SystemNotification {
  id: string;
  type: 'report_returned' | 'security_notice' | 'calendar_scheduled';
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  customerId?: string;
  customerName?: string;
  recordingId?: string;
  reportId?: string;
  pendingTaskCount?: number;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  system: 'internal_pbx' | 'security_gateway' | 'external_analytics' | 'customer_crm';
  action: string;
  resource: string;
  outcome: 'approved' | 'blocked' | 'verified';
  details: string;
}

export interface SystemSnapshot {
  customers: CustomerRecord[];
  recordings: PbxRecording[];
  reports: CallAnalysisReport[];
  calendarEvents: CalendarEvent[];
  notifications: SystemNotification[];
  transferJobs: TransferJob[];
  auditLogs: AuditLogEntry[];
}

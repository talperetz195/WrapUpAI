import type { SystemSnapshot, TransferJob } from './types';

export interface AuthStatusResponse {
  envConfigured: boolean;
  claimed: boolean;
}

export interface AuthSessionResponse {
  token: string;
  operator: {
    name: string;
    role: string;
  };
}

async function handleJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new Error(data.error || `שגיאת שרת (${res.status})`);
  }
  return data;
}

export async function getAuthStatus(): Promise<AuthStatusResponse> {
  const res = await fetch('/api/auth/status');
  return handleJson<AuthStatusResponse>(res);
}

export async function setupInitialOperator(operatorName: string, passcode: string): Promise<AuthSessionResponse> {
  const res = await fetch('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorName, passcode }),
  });
  return handleJson<AuthSessionResponse>(res);
}

export async function loginOperator(passcode: string): Promise<AuthSessionResponse> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });
  return handleJson<AuthSessionResponse>(res);
}

/** WrapUpAI: ה-PDF שהוחזר מהמערכת החיצונית ונשמר בשרת הארגון */
export async function fetchWrapupPdfBlob(
  token: string,
  reportId: string,
  kind: 'business' | 'customer' = 'business'
): Promise<Blob> {
  const res = await fetch(`/api/internal/reports/${encodeURIComponent(reportId)}/wrapup-pdf?kind=${kind}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'שגיאה בטעינת ה-PDF של WrapUpAI.');
  }
  return res.blob();
}

export async function fetchBootstrap(token: string): Promise<SystemSnapshot> {
  const res = await fetch('/api/internal/bootstrap', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleJson<SystemSnapshot>(res);
}

export async function fetchRecordingAudioBlob(token: string, recordingId: string): Promise<Blob> {
  const res = await fetch(`/api/internal/recordings/${encodeURIComponent(recordingId)}/audio`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'שגיאה בטעינת קובץ השמע מהמרכזיה.');
  }
  return res.blob();
}

export async function createCustomer(
  token: string,
  payload: {
    fullName: string;
    nationalId: string;
    phone: string;
    city: string;
    branch: string;
    department: string;
    assignedHandler: string;
    caseStatus: string;
  }
): Promise<{ customerId: string; snapshot: SystemSnapshot }> {
  const res = await fetch('/api/internal/customers', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return handleJson<{ customerId: string; snapshot: SystemSnapshot }>(res);
}

export async function revealCustomerId(token: string, customerId: string): Promise<{ nationalId: string }> {
  const res = await fetch(`/api/internal/customers/${encodeURIComponent(customerId)}/reveal-id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleJson<{ nationalId: string }>(res);
}

export async function transferRecordingToExternal(
  token: string,
  recordingId: string
): Promise<{ job: TransferJob; snapshot: SystemSnapshot }> {
  const res = await fetch(`/api/internal/recordings/${encodeURIComponent(recordingId)}/transfer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleJson<{ job: TransferJob; snapshot: SystemSnapshot }>(res);
}

export async function addTaskToCalendar(
  token: string,
  reportId: string,
  taskId: string,
  customDate?: string,
  customTime?: string
): Promise<SystemSnapshot> {
  const res = await fetch(
    `/api/internal/reports/${encodeURIComponent(reportId)}/tasks/${encodeURIComponent(taskId)}/calendar`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ customDate, customTime }),
    }
  );
  return handleJson<SystemSnapshot>(res);
}

export async function addAllReportTasksToCalendar(
  token: string,
  reportId: string
): Promise<{ addedCount: number } & SystemSnapshot> {
  const res = await fetch(`/api/internal/reports/${encodeURIComponent(reportId)}/add-all-calendar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleJson<{ addedCount: number } & SystemSnapshot>(res);
}

export async function updateCalendarEvent(
  token: string,
  eventId: string,
  updates: { completed?: boolean; date?: string; time?: string }
): Promise<SystemSnapshot> {
  const res = await fetch(`/api/internal/calendar/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });
  return handleJson<SystemSnapshot>(res);
}

export async function markNotificationsRead(token: string, notificationId?: string): Promise<SystemSnapshot> {
  const res = await fetch('/api/internal/notifications/mark-read', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ notificationId }),
  });
  return handleJson<SystemSnapshot>(res);
}

export async function createRecording(
  token: string,
  payload: Record<string, unknown>
): Promise<SystemSnapshot> {
  const res = await fetch('/api/internal/recordings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return handleJson<SystemSnapshot>(res);
}

export async function updateRecordingDuration(
  token: string,
  recordingId: string,
  durationSeconds: number
): Promise<SystemSnapshot> {
  const res = await fetch(`/api/internal/recordings/${encodeURIComponent(recordingId)}/duration`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ durationSeconds }),
  });
  return handleJson<SystemSnapshot>(res);
}

export async function testExternalBoundaryIsolation(): Promise<{ status: number; message: string }> {
  const res = await fetch('/api/external/customers');
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return {
    status: res.status,
    message: data.error || 'Access Denied',
  };
}

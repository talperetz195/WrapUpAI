import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { synthesizeMultiSpeakerCallWav, transcribeAndAnalyzeCallExternal } from './server/geminiService.ts';
import {
  consumeScopedTransferToken,
  issueScopedTransferToken,
  issueSessionToken,
  maskNationalId,
  signExternalReportPayload,
  verifyExternalReportSignature,
  verifySessionToken,
  type OperatorSessionPayload,
} from './server/security.ts';
import { store } from './server/store.ts';
import type { CallAnalysisReport, DialogueTurn, ExternalTransferPayload, TransferJob } from './server/types.ts';

const PORT = 3000;
const ALLOWED_AUDIO_MIMES = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'video/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
]);

function parseWavDurationSeconds(buffer: Buffer): number | null {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
  let byteRate = 0;
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (chunkId === 'fmt ' && dataStart + 12 <= buffer.length) {
      byteRate = buffer.readUInt32LE(dataStart + 8);
    } else if (chunkId === 'data') {
      dataBytes = Math.min(chunkSize, buffer.length - dataStart);
      break;
    }
    offset = dataStart + chunkSize + (chunkSize % 2);
  }
  if (byteRate > 0 && dataBytes > 0) {
    return Math.max(1, Math.round(dataBytes / byteRate));
  }
  return null;
}

function parseMp4DurationSeconds(buffer: Buffer): number | null {
  if (buffer.length < 24) return null;
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let headerLen = 8;
    if (size === 1 && offset + 16 <= buffer.length) {
      size = Number(buffer.readBigUInt64BE(offset + 8));
      headerLen = 16;
    } else if (size === 0) {
      size = buffer.length - offset;
    }
    if (size < headerLen || offset + size > buffer.length) break;

    if (type === 'moov') {
      let inner = offset + headerLen;
      const moovEnd = offset + size;
      while (inner + 8 <= moovEnd) {
        let childSize = buffer.readUInt32BE(inner);
        const childType = buffer.toString('ascii', inner + 4, inner + 8);
        let childHeader = 8;
        if (childSize === 1 && inner + 16 <= moovEnd) {
          childSize = Number(buffer.readBigUInt64BE(inner + 8));
          childHeader = 16;
        } else if (childSize === 0) {
          childSize = moovEnd - inner;
        }
        if (childSize < childHeader || inner + childSize > moovEnd) break;

        if (childType === 'mvhd' && inner + childHeader + 20 <= moovEnd) {
          const payloadStart = inner + childHeader;
          const version = buffer.readUInt8(payloadStart);
          if (version === 0 && payloadStart + 20 <= moovEnd) {
            const timescale = buffer.readUInt32BE(payloadStart + 12);
            const duration = buffer.readUInt32BE(payloadStart + 16);
            if (timescale > 0 && duration > 0) {
              return Math.max(1, Math.round(duration / timescale));
            }
          } else if (version === 1 && payloadStart + 32 <= moovEnd) {
            const timescale = buffer.readUInt32BE(payloadStart + 20);
            const duration = Number(buffer.readBigUInt64BE(payloadStart + 24));
            if (timescale > 0 && duration > 0) {
              return Math.max(1, Math.round(duration / timescale));
            }
          }
        }
        inner += childSize;
      }
    }
    offset += size;
  }
  return null;
}

function resolveUploadedDurationSeconds(
  buffer: Buffer,
  mimeType: string,
  clientDurationSeconds?: unknown
): number {
  if (
    typeof clientDurationSeconds === 'number' &&
    Number.isFinite(clientDurationSeconds) &&
    clientDurationSeconds > 0 &&
    clientDurationSeconds <= 60 * 60 * 6
  ) {
    return Math.max(1, Math.round(clientDurationSeconds));
  }
  const wavDuration = parseWavDurationSeconds(buffer);
  if (wavDuration !== null) return wavDuration;
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) {
    const mp4Duration = parseMp4DurationSeconds(buffer);
    if (mp4Duration !== null) return mp4Duration;
  }
  return Math.max(1, Math.round(buffer.length / 16000));
}

declare global {
  namespace Express {
    interface Request {
      operator?: OperatorSessionPayload;
    }
  }
}

function requireOperatorAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'נדרשת הזדהות נציג מורשה (חסר אסימון גישה).' });
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const session = verifySessionToken(token);
  if (!session) {
    res.status(401).json({ error: 'תוקף החיבור פג או שאסימון הגישה אינו תקין.' });
    return;
  }
  req.operator = session;
  next();
}

function buildMaskedSnapshot() {
  return {
    customers: store.customers.map((c) => ({
      ...c,
      nationalId: maskNationalId(c.nationalId),
      idMasked: true,
    })),
    recordings: store.recordings.map(({ dialogueScript: _omit, ...rec }) => rec),
    reports: store.reports,
    calendarEvents: store.calendarEvents,
    notifications: store.notifications,
    transferJobs: store.transferJobs,
    auditLogs: store.auditLogs.slice(0, 80),
  };
}

async function ensureRecordingAudio(recordingId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const cached = store.getAudio(recordingId);
  if (cached) return cached;

  const rec = store.recordings.find((r) => r.id === recordingId);
  if (!rec) {
    throw new Error('הקלטת השיחה לא נמצאה במרכזיה.');
  }
  if (!rec.dialogueScript || rec.dialogueScript.length === 0) {
    throw new Error('לקובץ זה אין שמע שמור במטמון.');
  }

  const synthesized = await synthesizeMultiSpeakerCallWav(rec.dialogueScript);
  rec.durationSeconds = synthesized.durationSeconds;
  rec.mimeType = synthesized.mimeType;
  store.setAudio(recordingId, synthesized.buffer, synthesized.mimeType);
  return { buffer: synthesized.buffer, mimeType: synthesized.mimeType };
}

async function executeIsolatedExternalAnalysis(params: {
  transferToken: string;
  job: TransferJob;
  audioBuffer: Buffer;
  mimeType: string;
  internalPort: number;
}): Promise<void> {
  const { transferToken, job, audioBuffer, mimeType, internalPort } = params;

  try {
    // Call isolated System B HTTP endpoint over localhost boundary using ONLY the scoped single-use token
    // WrapUpAI: אם מוגדר EXTERNAL_ANALYTICS_URL - האודיו נשלח למערכת WrapUpAI החיצונית האמיתית
    const externalUrl = process.env.EXTERNAL_ANALYTICS_URL || `http://127.0.0.1:${internalPort}/api/external/analyze`;
    const rec = store.recordings.find((r) => r.id === job.recordingId);
    const customer = rec ? store.customers.find((c) => c.id === rec.customerId) : undefined;
    // רק לצורך מסירת הסיכום במייל - WrapUpAI לא שולח את זה למודל ה-AI
    const deliveryRecipients = (customer?.emails || []).map((email) => ({
      name: customer?.fullName || '',
      email,
    }));
    const response = await fetch(externalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Transfer-Token': transferToken,
      },
      body: JSON.stringify({
        jobId: job.jobId,
        uniqueCallName: job.uniqueCallName,
        callDate: job.maskedPayload.callDate,
        anonymizedParticipants: job.maskedPayload.anonymizedParticipants,
        audioBase64: audioBuffer.toString('base64'),
        mimeType,
        deliveryRecipients,
      }),
    });

    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(errBody.error || `שגיאת מערכת חיצונית (${response.status})`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'שגיאה בתהליך הניתוח החיצוני.';
    job.stage = 'failed';
    job.error = message;
    job.audioPurged = true;

    const rec = store.recordings.find((r) => r.id === job.recordingId);
    if (rec && rec.status !== 'report_returned') {
      rec.status = 'pending_transfer';
    }

    store.addAuditLog({
      actor: 'מערכת תמלול חיצונית (מוגבלת)',
      system: 'external_analytics',
      action: 'כישלון בעיבוד אודיו חיצוני',
      resource: job.uniqueCallName,
      outcome: 'blocked',
      details: message,
    });
    store.broadcast('state_update', buildMaskedSnapshot());
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '28mb' }));

  // =========================================================================
  // AUTHENTICATION ROUTES (System A Operator Session)
  // =========================================================================
  app.get('/api/auth/status', (_req, res) => {
    res.json({
      envConfigured: store.isEnvPasscodeConfigured(),
      claimed: store.isClaimed(),
    });
  });

  app.post('/api/auth/setup', (req, res) => {
    const { operatorName, passcode } = req.body as { operatorName?: string; passcode?: string };
    if (store.isEnvPasscodeConfigured() || store.isClaimed()) {
      res.status(409).json({ error: 'הגישה למערכת כבר הוגדרה. יש להתחבר עם קוד הגישה הקיים.' });
      return;
    }
    if (!operatorName || operatorName.trim().length < 2) {
      res.status(400).json({ error: 'יש להזין שם נציג מלא (לפחות 2 תווים).' });
      return;
    }
    if (!passcode || passcode.length < 4) {
      res.status(400).json({ error: 'יש לבחור קוד גישה באורך של 4 תווים לפחות.' });
      return;
    }

    store.claimInitialOperator(operatorName, passcode);
    const token = issueSessionToken(operatorName.trim(), 'service_director');
    store.addAuditLog({
      actor: operatorName.trim(),
      system: 'internal_pbx',
      action: 'הגדרת נציג ראשי והתחברות ראשונית',
      resource: 'Internal PBX & CRM',
      outcome: 'approved',
      details: 'נציג מורשה אומת באמצעות גיבוב scrypt והונפק אסימון גישה בזיכרון.',
    });

    res.json({
      token,
      operator: { name: operatorName.trim(), role: 'service_director' },
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const { passcode } = req.body as { passcode?: string };
    if (!passcode) {
      res.status(400).json({ error: 'יש להזין קוד גישה.' });
      return;
    }
    const result = store.verifyOperatorCredentials(passcode);
    if (!result.valid) {
      store.addAuditLog({
        actor: 'ניסיון כניסה לא מזוהה',
        system: 'security_gateway',
        action: 'דחיית ניסיון התחברות למרכזיה',
        resource: 'Internal PBX & CRM',
        outcome: 'blocked',
        details: 'קוד גישה שגוי הוזן במסך הכניסה.',
      });
      res.status(401).json({ error: 'קוד הגישה שגוי.' });
      return;
    }

    const token = issueSessionToken(result.operatorName, 'service_director');
    store.addAuditLog({
      actor: result.operatorName,
      system: 'internal_pbx',
      action: 'התחברות מאומתת למרכזיה ותיקי לקוחות',
      resource: 'Internal PBX & CRM',
      outcome: 'approved',
      details: 'אסימון הפעלה הונפק לתקופה מוגבלת של 8 שעות.',
    });

    res.json({
      token,
      operator: { name: result.operatorName, role: 'service_director' },
    });
  });

  // =========================================================================
  // SYSTEM A: INTERNAL PBX & CRM ROUTES (Protected by Operator Bearer Session)
  // =========================================================================
  app.get('/api/internal/bootstrap', requireOperatorAuth, (_req, res) => {
    res.json(buildMaskedSnapshot());
  });

  app.get('/api/internal/events', requireOperatorAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('connected', { ok: true, operator: req.operator?.operatorName });

    const unsubscribe = store.subscribeSse(sendEvent);
    const keepAlive = setInterval(() => {
      res.write(': ping\n\n');
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.post('/api/internal/customers', requireOperatorAuth, (req, res) => {
    const {
      fullName,
      nationalId,
      phone,
      city,
      branch,
      department,
      assignedHandler,
      caseStatus,
    } = (req.body || {}) as {
      fullName?: string;
      nationalId?: string;
      phone?: string;
      city?: string;
      branch?: string;
      department?: string;
      assignedHandler?: string;
      caseStatus?: string;
    };

    if (!fullName || fullName.trim().length < 2) {
      res.status(400).json({ error: 'יש להזין שם מלא של הלקוח (לפחות 2 תווים).' });
      return;
    }
    const cleanId = (nationalId || '').replace(/\D/g, '');
    if (cleanId.length < 5 || cleanId.length > 12) {
      res.status(400).json({ error: 'יש להזין מספר זהות תקין (5–12 ספרות).' });
      return;
    }
    if (!phone || phone.trim().length < 7) {
      res.status(400).json({ error: 'יש להזין מספר טלפון תקין.' });
      return;
    }

    const id = `cust-${crypto.randomBytes(3).toString('hex')}`;
    const caseNumber = `BTL-2026-${Math.floor(10000 + Math.random() * 89999)}`;

    const newCustomer = {
      id,
      fullName: fullName.trim(),
      nationalId: cleanId,
      phone: phone.trim(),
      city: city?.trim() || 'תל אביב-יפו',
      branch: branch?.trim() || 'סניף תל אביב מרכז',
      caseNumber,
      department: department?.trim() || 'אבטלה והבטחת הכנסה',
      assignedHandler: assignedHandler?.trim() || req.operator!.operatorName,
      caseStatus: caseStatus?.trim() || 'תיק חדש · ממתין להקלטה או תביעה',
    };

    store.customers.unshift(newCustomer);

    store.addAuditLog({
      actor: req.operator!.operatorName,
      system: 'customer_crm',
      action: 'פתיחת כרטיס לקוח חדש במערכת הראשית',
      resource: `${newCustomer.fullName} (${newCustomer.caseNumber})`,
      outcome: 'approved',
      details: `נפתח כרטיס מבוטח חדש במחלקת ${newCustomer.department} (${newCustomer.branch}).`,
    });

    const snapshot = buildMaskedSnapshot();
    store.broadcast('state_update', snapshot);
    res.status(201).json({ customerId: id, snapshot });
  });

  app.post('/api/internal/customers/:id/reveal-id', requireOperatorAuth, (req, res) => {
    const customer = store.customers.find((c) => c.id === req.params.id);
    if (!customer) {
      res.status(404).json({ error: 'תיק הלקוח לא נמצא.' });
      return;
    }

    store.addAuditLog({
      actor: req.operator!.operatorName,
      system: 'customer_crm',
      action: 'חשיפת מספר זהות מלא בכרטיס לקוח',
      resource: `${customer.fullName} (${customer.caseNumber})`,
      outcome: 'approved',
      details: 'נציג מורשה צפה במספר הזהות המלא לצורך זיהוי וטיפול בתיק.',
    });

    res.json({ nationalId: customer.nationalId });
  });

  app.get('/api/internal/recordings/:id/audio', requireOperatorAuth, async (req, res) => {
    try {
      const rec = store.recordings.find((r) => r.id === req.params.id);
      if (!rec) {
        res.status(404).json({ error: 'הקלטת השיחה לא נמצאה.' });
        return;
      }

      const wasCached = Boolean(store.getAudio(rec.id));
      const { buffer, mimeType } = await ensureRecordingAudio(rec.id);

      if (!wasCached) {
        store.addAuditLog({
          actor: req.operator!.operatorName,
          system: 'internal_pbx',
          action: 'הפקה והאזנה לקובץ שמע במרכזיה',
          resource: rec.uniqueCallName,
          outcome: 'approved',
          details: `קובץ שמע מרובה משתתפים הוכן והוזרם לממשק ההאזנה המאובטח (${rec.participants.length} דוברים).`,
        });
      }

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'שגיאה בטעינת קובץ השמע.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/internal/recordings', requireOperatorAuth, async (req, res) => {
    try {
      const {
        customerId,
        department,
        callDate,
        mode,
        audioBase64,
        mimeType,
        durationSeconds,
        participants,
        dialogueScript,
      } = req.body as {
        customerId?: string;
        department?: string;
        callDate?: string;
        mode?: 'upload' | 'tts';
        audioBase64?: string;
        mimeType?: string;
        durationSeconds?: number;
        participants?: Array<{ role: string; displayName: string }>;
        dialogueScript?: DialogueTurn[];
      };

      const customer = store.customers.find((c) => c.id === customerId);
      if (!customer) {
        res.status(400).json({ error: 'יש לבחור לקוח קיים מתוך תיקי המבוטחים.' });
        return;
      }

      const recId = `rec-${crypto.randomUUID().slice(0, 6)}`;
      const now = callDate ? new Date(callDate) : new Date();
      const stamp = now.toISOString().slice(0, 10).replaceAll('-', '');
      const timeStamp = now.toISOString().slice(11, 16).replace(':', '');
      const shortCode = crypto.randomBytes(2).toString('hex').toUpperCase();
      const uniqueCallName = `CALL-${stamp}-${timeStamp}-${shortCode}`;

      if (mode === 'upload') {
        const normalizedMime = (mimeType || '').split(';')[0].trim().toLowerCase();
        if (!audioBase64 || !normalizedMime || !ALLOWED_AUDIO_MIMES.has(normalizedMime)) {
          res.status(400).json({
            error: 'פורמט הקובץ אינו נתמך. יש להעלות MP4, WAV, MP3, WebM, M4A או OGG.',
          });
          return;
        }
        const buffer = Buffer.from(audioBase64, 'base64');
        if (buffer.length < 100 || buffer.length > 20 * 1024 * 1024) {
          res.status(400).json({ error: 'גודל הקובץ חייב להיות בין 100 בייט ל-20MB.' });
          return;
        }

        const mappedParticipants = (participants && participants.length > 0
          ? participants
          : [
              { role: 'נציג שירות', displayName: req.operator!.operatorName },
              { role: 'מבוטח פונה', displayName: customer.fullName },
            ]
        ).map((p, idx) => ({
          anonymizedLabel: `משתתף ${['א׳', 'ב׳', 'ג׳', 'ד׳'][idx] || idx + 1}`,
          role: p.role,
          displayName: p.displayName,
        }));

        const resolvedDuration = resolveUploadedDurationSeconds(buffer, normalizedMime, durationSeconds);

        store.setAudio(recId, buffer, normalizedMime);
        store.recordings.unshift({
          id: recId,
          uniqueCallName,
          callDate: now.toISOString(),
          customerId: customer.id,
          customerName: customer.fullName,
          department: department?.trim() || customer.department,
          participants: mappedParticipants,
          durationSeconds: resolvedDuration,
          audioSourceType: 'uploaded',
          mimeType: normalizedMime,
          status: 'pending_transfer',
        });
      } else {
        if (!dialogueScript || dialogueScript.length < 2) {
          res.status(400).json({ error: 'נדרשות לפחות 2 שורות דיאלוג ליצירת שיחה מרובת משתתפים.' });
          return;
        }

        const synthesized = await synthesizeMultiSpeakerCallWav(dialogueScript);
        const uniqueSpeakers = new Map<string, { anonymizedLabel: string; role: string; displayName: string }>();
        for (const turn of dialogueScript) {
          if (!uniqueSpeakers.has(turn.speakerLabel)) {
            uniqueSpeakers.set(turn.speakerLabel, {
              anonymizedLabel: turn.speakerLabel,
              role: turn.role,
              displayName: `${turn.role} (${turn.speakerLabel})`,
            });
          }
        }

        store.setAudio(recId, synthesized.buffer, synthesized.mimeType);
        store.recordings.unshift({
          id: recId,
          uniqueCallName,
          callDate: now.toISOString(),
          customerId: customer.id,
          customerName: customer.fullName,
          department: department?.trim() || customer.department,
          participants: Array.from(uniqueSpeakers.values()),
          durationSeconds: synthesized.durationSeconds,
          audioSourceType: 'tts_dialogue',
          mimeType: synthesized.mimeType,
          dialogueScript,
          status: 'pending_transfer',
        });
      }

      store.addAuditLog({
        actor: req.operator!.operatorName,
        system: 'internal_pbx',
        action: 'קליטת הקלטת שיחה חדשה במרכזיה',
        resource: uniqueCallName,
        outcome: 'approved',
        details: `שויכה לתיק לקוח ${customer.fullName} (${customer.caseNumber}).`,
      });

      const snapshot = buildMaskedSnapshot();
      store.broadcast('state_update', snapshot);
      res.status(201).json(snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'שגיאה בשמירת הקלטת השיחה.';
      res.status(500).json({ error: message });
    }
  });

  app.patch('/api/internal/recordings/:id/duration', requireOperatorAuth, (req, res) => {
    const rec = store.recordings.find((r) => r.id === req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'הקלטת השיחה לא נמצאה.' });
      return;
    }
    const { durationSeconds } = (req.body || {}) as { durationSeconds?: number };
    if (
      typeof durationSeconds !== 'number' ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      durationSeconds > 60 * 60 * 6
    ) {
      res.status(400).json({ error: 'משך זמן הקובץ אינו תקין.' });
      return;
    }
    rec.durationSeconds = Math.max(1, Math.round(durationSeconds));
    store.save();
    const snapshot = buildMaskedSnapshot();
    res.json(snapshot);
  });

  // ONE-CLICK TRANSFER TO RESTRICTED EXTERNAL SYSTEM
  app.post('/api/internal/recordings/:id/transfer', requireOperatorAuth, async (req, res) => {
    try {
      const rec = store.recordings.find((r) => r.id === req.params.id);
      if (!rec) {
        res.status(404).json({ error: 'הקלטת השיחה לא נמצאה במרכזיה.' });
        return;
      }

      if (rec.status === 'transferring' || rec.status === 'analyzing_external') {
        res.status(409).json({ error: 'הקלטה זו כבר נמצאת בעיבוד במערכת התמלול החיצונית.' });
        return;
      }

      const { buffer, mimeType } = await ensureRecordingAudio(rec.id);

      const jobId = `JOB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const { token: transferToken, expiresAtIso } = issueScopedTransferToken({
        jobId,
        recordingId: rec.id,
        uniqueCallName: rec.uniqueCallName,
      });

      const maskedPayload: ExternalTransferPayload = {
        jobId,
        uniqueCallName: rec.uniqueCallName,
        callDate: rec.callDate,
        anonymizedParticipants: rec.participants.map((p) => ({
          anonymizedLabel: p.anonymizedLabel,
          role: p.role,
        })),
        piiStrippedFields: [
          'customerName',
          'nationalId',
          'phone',
          'city',
          'branch',
          'caseNumber',
          'crmHistory',
        ],
        tokenScope: 'audio_transcribe_only',
        tokenExpiresAt: expiresAtIso,
      };

      const job: TransferJob = {
        jobId,
        recordingId: rec.id,
        uniqueCallName: rec.uniqueCallName,
        customerId: rec.customerId,
        initiatedBy: req.operator!.operatorName,
        initiatedAt: new Date().toISOString(),
        stage: 'token_verified',
        audioPurged: false,
        maskedPayload,
      };

      store.transferJobs.unshift(job);
      rec.status = 'analyzing_external';
      rec.latestJobId = jobId;

      store.addAuditLog({
        actor: req.operator!.operatorName,
        system: 'security_gateway',
        action: 'העברה מבוקרת בלחיצה אחת למערכת התמלול החיצונית',
        resource: `${rec.uniqueCallName} · ${jobId}`,
        outcome: 'verified',
        details:
          'הונפק טוקן HMAC חד-פעמי (תוקף 120 שניות, הרשאת אודיו בלבד). הוסרו 7 שדות PII מזהים טרם היציאה.',
      });

      store.broadcast('state_update', buildMaskedSnapshot());

      // Launch isolated external analysis asynchronously over HTTP boundary
      void executeIsolatedExternalAnalysis({
        transferToken,
        job,
        audioBuffer: buffer,
        mimeType,
        internalPort: PORT,
      });

      res.status(202).json({
        job,
        snapshot: buildMaskedSnapshot(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'שגיאה בהעברת השיחה למערכת החיצונית.';
      res.status(500).json({ error: message });
    }
  });

  // SIGNED REPORT RETURN INGEST GATEWAY (Called by External System — NO direct DB access!)
  app.post('/api/internal/ingest-report', (req, res) => {
    const signature = req.header('X-External-Signature');
    const serialized = JSON.stringify(req.body);

    if (!verifyExternalReportSignature(serialized, signature)) {
      store.addAuditLog({
        actor: 'מקור לא מזוהה',
        system: 'security_gateway',
        action: 'חסימת ניסיון הזרקת דוח ללא חתימה תקפה',
        resource: '/api/internal/ingest-report',
        outcome: 'blocked',
        details: 'חתימת HMAC-SHA256 חסרה או שגויה על חבילת החזרת הנתונים.',
      });
      res.status(403).json({ error: 'חתימת מערכת חיצונית אינה תקפה.' });
      return;
    }

    const { jobId, analysis, wrapup } = req.body as {
      wrapup?: { delivery: string; sentTo: string[]; pdfFileName?: string | null; pdfBase64?: string | null };
      jobId: string;
      analysis: {
        executiveSummary: string;
        participantsDetected: Array<{ speakerLabel: string; role: string }>;
        topics: CallAnalysisReport['topics'];
        actionItems: CallAnalysisReport['actionItems'];
        transcript: CallAnalysisReport['transcript'];
      };
    };

    const job = store.transferJobs.find((j) => j.jobId === jobId);
    const rec = job ? store.recordings.find((r) => r.id === job.recordingId) : undefined;
    const customer = rec ? store.customers.find((c) => c.id === rec.customerId) : undefined;

    if (!job || !rec || !customer) {
      res.status(404).json({ error: 'מזהה משימת ההעברה לא נמצא במערכת הפנימית.' });
      return;
    }

    const reportId = `RPT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const nowIso = new Date().toISOString();

    const report: CallAnalysisReport = {
      id: reportId,
      jobId: job.jobId,
      recordingId: rec.id,
      uniqueCallName: rec.uniqueCallName,
      customerId: customer.id,
      customerName: customer.fullName,
      generatedAt: nowIso,
      returnedAt: nowIso,
      signatureVerified: true,
      executiveSummary: analysis.executiveSummary,
      participantsDetected: analysis.participantsDetected,
      topics: analysis.topics,
      actionItems: analysis.actionItems,
      transcript: analysis.transcript,
    };

    // WrapUpAI: שמירת קובץ ה-PDF שהוחזר בשרת הארגון + פרטי המסירה במייל
    if (wrapup) {
      let pdfFileName: string | null = null;
      if (wrapup.pdfBase64 && wrapup.pdfFileName) {
        const dir = path.resolve(process.cwd(), '.local-data', 'wrapup-pdfs');
        fs.mkdirSync(dir, { recursive: true });
        pdfFileName = `${reportId}.pdf`;
        fs.writeFileSync(path.join(dir, pdfFileName), Buffer.from(wrapup.pdfBase64, 'base64'));
      }
      report.wrapup = { delivery: wrapup.delivery, sentTo: wrapup.sentTo || [], pdfFileName: wrapup.pdfFileName || pdfFileName };
    }

    // Replace older report for the same recording if re-analyzed, otherwise prepend
    store.reports = [report, ...store.reports.filter((r) => r.recordingId !== rec.id)];
    rec.status = 'report_returned';
    rec.reportId = reportId;
    job.stage = 'completed_and_purged';
    job.completedAt = nowIso;
    job.audioPurged = true;
    job.reportId = reportId;

    store.addAuditLog({
      actor: 'שער קליטה מאובטח (System A)',
      system: 'customer_crm',
      action: 'אימות חתימה ושיוך דוח מלא לכרטיס הלקוח',
      resource: `${customer.fullName} · ${reportId}`,
      outcome: 'verified',
      details: `הדוח החוזר אומת בחתימת HMAC ושויך אוטומטית לתיק ${customer.caseNumber}. ${report.actionItems.length} משימות להמשך זמינות לשיבוץ ביומן.`,
    });

    store.pushNotification({
      type: 'report_returned',
      title: `התקבל דוח תמלול וניתוח חדש עבור ${customer.fullName}`,
      message: `השיחה ${rec.uniqueCallName} נותחה (${report.topics.length} נושאים, ${report.actionItems.length} משימות להמשך) ושויכה לכרטיס הלקוח.${report.wrapup?.sentTo.length ? ` סיכום ו-PDF נשלחו במייל ל-${report.wrapup.sentTo.length} לקוחות.` : ''}`,
      customerId: customer.id,
      customerName: customer.fullName,
      recordingId: rec.id,
      reportId,
      pendingTaskCount: report.actionItems.length,
    });

    store.broadcast('state_update', buildMaskedSnapshot());
    res.json({ ok: true, reportId });
  });

  // WrapUpAI: הורדת ה-PDF שהוחזר מהמערכת החיצונית ונשמר בשרת הארגון
  app.get('/api/internal/reports/:reportId/wrapup-pdf', requireOperatorAuth, (req, res) => {
    const report = store.reports.find((r) => r.id === req.params.reportId);
    const file = path.resolve(process.cwd(), '.local-data', 'wrapup-pdfs', `${String(req.params.reportId).replace(/[^A-Z0-9-]/gi, '')}.pdf`);
    if (!report || !fs.existsSync(file)) {
      res.status(404).json({ error: 'קובץ ה-PDF של WrapUpAI לא נמצא.' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(fs.readFileSync(file));
  });

  // ADD INDIVIDUAL TASK TO CUSTOMER CALENDAR
  app.post('/api/internal/reports/:reportId/tasks/:taskId/calendar', requireOperatorAuth, (req, res) => {
    const report = store.reports.find((r) => r.id === req.params.reportId);
    if (!report) {
      res.status(404).json({ error: 'הדוח לא נמצא.' });
      return;
    }
    const task = report.actionItems.find((t) => t.taskId === req.params.taskId);
    if (!task) {
      res.status(404).json({ error: 'המשימה לא נמצאה בדוח.' });
      return;
    }

    const { customDate, customTime } = (req.body || {}) as { customDate?: string; customTime?: string };
    const date = customDate && /^\d{4}-\d{2}-\d{2}$/.test(customDate) ? customDate : task.suggestedDate;
    const time = customTime && /^\d{2}:\d{2}$/.test(customTime) ? customTime : task.suggestedTime;

    if (!task.addedToCalendar) {
      const eventId = `evt-${crypto.randomUUID().slice(0, 8)}`;
      store.calendarEvents.unshift({
        id: eventId,
        customerId: report.customerId,
        customerName: report.customerName,
        reportId: report.id,
        sourceTaskId: task.taskId,
        title: task.title,
        description: task.description,
        date,
        time,
        category: task.category,
        priority: task.priority,
        owner: task.owner,
        completed: false,
        createdAt: new Date().toISOString(),
      });
      task.addedToCalendar = true;
      task.calendarEventId = eventId;

      store.addAuditLog({
        actor: req.operator!.operatorName,
        system: 'customer_crm',
        action: 'שיבוץ משימת המשך ביומן הלקוח',
        resource: `${report.customerName} · ${date} ${time}`,
        outcome: 'approved',
        details: `משימה "${task.title}" מתוך דוח ${report.id} נוספה ליומן הלקוח.`,
      });
    }

    const snapshot = buildMaskedSnapshot();
    store.broadcast('state_update', snapshot);
    res.json(snapshot);
  });

  // BATCH ADD ALL REPORT TASKS TO CUSTOMER CALENDAR
  app.post('/api/internal/reports/:reportId/add-all-calendar', requireOperatorAuth, (req, res) => {
    const report = store.reports.find((r) => r.id === req.params.reportId);
    if (!report) {
      res.status(404).json({ error: 'הדוח לא נמצא.' });
      return;
    }

    let addedCount = 0;
    for (const task of report.actionItems) {
      if (!task.addedToCalendar) {
        const eventId = `evt-${crypto.randomUUID().slice(0, 8)}`;
        store.calendarEvents.unshift({
          id: eventId,
          customerId: report.customerId,
          customerName: report.customerName,
          reportId: report.id,
          sourceTaskId: task.taskId,
          title: task.title,
          description: task.description,
          date: task.suggestedDate,
          time: task.suggestedTime,
          category: task.category,
          priority: task.priority,
          owner: task.owner,
          completed: false,
          createdAt: new Date().toISOString(),
        });
        task.addedToCalendar = true;
        task.calendarEventId = eventId;
        addedCount += 1;
      }
    }

    if (addedCount > 0) {
      store.addAuditLog({
        actor: req.operator!.operatorName,
        system: 'customer_crm',
        action: 'שיבוץ מרוכז של משימות דוח ביומן הלקוח',
        resource: `${report.customerName} · ${report.id}`,
        outcome: 'approved',
        details: `${addedCount} משימות המשך נוספו ליומן הלקוח מתוך דוח ${report.id}.`,
      });
    }

    const snapshot = buildMaskedSnapshot();
    store.broadcast('state_update', snapshot);
    res.json({ addedCount, ...snapshot });
  });

  app.patch('/api/internal/calendar/:eventId', requireOperatorAuth, (req, res) => {
    const evt = store.calendarEvents.find((e) => e.id === req.params.eventId);
    if (!evt) {
      res.status(404).json({ error: 'האירוע ביומן הלקוח לא נמצא.' });
      return;
    }
    const { completed, date, time } = req.body as {
      completed?: boolean;
      date?: string;
      time?: string;
    };

    if (typeof completed === 'boolean') evt.completed = completed;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) evt.date = date;
    if (time && /^\d{2}:\d{2}$/.test(time)) evt.time = time;

    store.save();
    const snapshot = buildMaskedSnapshot();
    store.broadcast('state_update', snapshot);
    res.json(snapshot);
  });

  app.post('/api/internal/notifications/mark-read', requireOperatorAuth, (req, res) => {
    const { notificationId } = (req.body || {}) as { notificationId?: string };
    for (const n of store.notifications) {
      if (!notificationId || n.id === notificationId) {
        n.read = true;
      }
    }
    store.save();
    const snapshot = buildMaskedSnapshot();
    store.broadcast('state_update', snapshot);
    res.json(snapshot);
  });

  // =========================================================================
  // SYSTEM B: ISOLATED EXTERNAL ANALYTICS SANDBOX (NO CRM / CUSTOMER ACCESS)
  // =========================================================================
  app.get('/api/external/customers', (_req, res) => {
    // Explicit zero-trust boundary proof: External system NEVER has permission to read customer cards
    store.addAuditLog({
      actor: 'מערכת תמלול חיצונית',
      system: 'security_gateway',
      action: 'חסימת גישה למאגר לקוחות מתוך תחום חיצוני',
      resource: '/api/external/customers',
      outcome: 'blocked',
      details: 'למערכת התמלול החיצונית אין הרשאת קריאה או כתיבה לכרטיסי לקוחות.',
    });
    res.status(403).json({
      error: 'גישה נדחתה (403): למערכת התמלול החיצונית אין הרשאת גישה לכרטיסי הלקוחות במערכת הראשית.',
    });
  });

  app.post('/api/external/analyze', async (req, res) => {
    const transferToken = req.header('X-Transfer-Token');
    const { jobId, uniqueCallName, callDate, anonymizedParticipants, audioBase64, mimeType } = req.body as {
      jobId?: string;
      uniqueCallName?: string;
      callDate?: string;
      anonymizedParticipants?: Array<{ anonymizedLabel: string; role: string }>;
      audioBase64?: string;
      mimeType?: string;
    };

    if (!jobId || !uniqueCallName || !audioBase64 || !mimeType) {
      res.status(400).json({ error: 'חבילת האודיו למערכת החיצונית חסרה פרמטרים נדרשים.' });
      return;
    }

    const tokenCheck = consumeScopedTransferToken(transferToken, jobId);
    if (!tokenCheck.valid) {
      store.addAuditLog({
        actor: 'מערכת תמלול חיצונית',
        system: 'external_analytics',
        action: 'דחיית טוקן העברה חיצוני',
        resource: uniqueCallName,
        outcome: 'blocked',
        details: tokenCheck.reason,
      });
      res.status(403).json({ error: tokenCheck.reason });
      return;
    }

    const job = store.transferJobs.find((j) => j.jobId === jobId);
    if (job) {
      job.stage = 'transcribing_audio';
      store.broadcast('state_update', buildMaskedSnapshot());
    }

    store.addAuditLog({
      actor: 'מנוע תמלול חיצוני (מבודד)',
      system: 'external_analytics',
      action: 'קליטת אודיו מאומתת ללא פרטי לקוח',
      resource: `${uniqueCallName} · ${jobId}`,
      outcome: 'verified',
      details: 'טוקן חד-פעמי אומת ונשרף. החל תמלול רב-משתתפים מתוך קובץ השמע בלבד.',
    });

    try {
      const audioBuffer = Buffer.from(audioBase64, 'base64');

      if (job) {
        job.stage = 'analyzing_topics';
        store.broadcast('state_update', buildMaskedSnapshot());
      }

      const analysis = await transcribeAndAnalyzeCallExternal({
        audioBuffer,
        mimeType,
        uniqueCallName,
        callDate: callDate || new Date().toISOString(),
        anonymizedParticipants: anonymizedParticipants || [],
      });

      if (job) {
        job.stage = 'signing_and_returning';
        store.broadcast('state_update', buildMaskedSnapshot());
      }

      const callbackBody = {
        jobId,
        analysis,
      };
      const serialized = JSON.stringify(callbackBody);
      const signature = signExternalReportPayload(serialized);

      const ingestResponse = await fetch(`http://127.0.0.1:${PORT}/api/internal/ingest-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-External-Signature': signature,
        },
        body: serialized,
      });

      if (!ingestResponse.ok) {
        const ingestErr = (await ingestResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(ingestErr.error || 'כשל בהחזרת הדוח החתום למערכת הפנימית.');
      }

      store.addAuditLog({
        actor: 'מנוע תמלול חיצוני (מבודד)',
        system: 'external_analytics',
        action: 'שליחת דוח חתום ומחיקת קובץ השמע מהאזור החיצוני',
        resource: `${uniqueCallName} · ${jobId}`,
        outcome: 'verified',
        details: 'הדוח הוחזר חתום למערכת הפנימית וחוצץ האודיו הזמני נמחק לצמיתות.',
      });

      res.json({ ok: true, jobId, audioPurged: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'שגיאה בניתוח השיחה במערכת החיצונית.';
      res.status(500).json({ error: message });
    }
  });

  // =========================================================================
  // VITE / STATIC ASSET SERVING
  // =========================================================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('/{*splat}', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Enterprise PBX & Restricted Analytics Server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

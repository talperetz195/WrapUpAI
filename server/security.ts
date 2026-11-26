import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function loadOrCreateRuntimeSecrets(): { sessionSecret: string; bridgeHmacSecret: string } {
  const dataDir = path.resolve(process.cwd(), '.local-data');
  const secretsPath = path.join(dataDir, 'runtime-secrets.json');
  try {
    if (fs.existsSync(secretsPath)) {
      const parsed = JSON.parse(fs.readFileSync(secretsPath, 'utf8')) as {
        sessionSecret?: string;
        bridgeHmacSecret?: string;
      };
      if (parsed.sessionSecret && parsed.bridgeHmacSecret) {
        return {
          sessionSecret: parsed.sessionSecret,
          bridgeHmacSecret: parsed.bridgeHmacSecret,
        };
      }
    }
  } catch {
    // Regenerate below if unreadable
  }

  const created = {
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    bridgeHmacSecret: crypto.randomBytes(32).toString('hex'),
  };
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(secretsPath, JSON.stringify(created), { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Non-fatal if filesystem is read-only
  }
  return created;
}

const runtimeSecrets = loadOrCreateRuntimeSecrets();
const SESSION_SECRET = process.env.SESSION_SECRET || runtimeSecrets.sessionSecret;
const BRIDGE_HMAC_SECRET = process.env.INTERNAL_BRIDGE_SECRET || runtimeSecrets.bridgeHmacSecret;

const consumedTransferJtis = new Set<string>();

export interface OperatorSessionPayload {
  operatorName: string;
  role: 'service_director' | 'senior_representative';
  issuedAt: number;
  expiresAt: number;
}

export interface ScopedTransferTokenPayload {
  jti: string;
  jobId: string;
  recordingId: string;
  uniqueCallName: string;
  scope: 'audio_transcribe_only';
  iat: number;
  exp: number;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function base64UrlDecode(input: string): string {
  const padded = input.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((input.length + 3) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function hmacSign(secret: string, data: string): string {
  return base64UrlEncode(crypto.createHmac('sha256', secret).update(data).digest());
}

function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function hashPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPasscode(passcode: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const derivedHex = crypto.scryptSync(passcode, salt, 64).toString('hex');
  return constantTimeCompare(derivedHex, expectedHex);
}

export function issueSessionToken(operatorName: string, role: OperatorSessionPayload['role']): string {
  const now = Date.now();
  const payload: OperatorSessionPayload = {
    operatorName,
    role,
    issuedAt: now,
    expiresAt: now + 8 * 60 * 60 * 1000, // 8 hours
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = hmacSign(SESSION_SECRET, encoded);
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string | undefined): OperatorSessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = hmacSign(SESSION_SECRET, encoded);
  if (!constantTimeCompare(sig, expectedSig)) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(encoded)) as OperatorSessionPayload;
    if (!parsed.operatorName || parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function issueScopedTransferToken(params: {
  jobId: string;
  recordingId: string;
  uniqueCallName: string;
}): { token: string; expiresAtIso: string } {
  const now = Date.now();
  const exp = now + 120 * 1000; // 120-second single-use transfer window
  const payload: ScopedTransferTokenPayload = {
    jti: crypto.randomUUID(),
    jobId: params.jobId,
    recordingId: params.recordingId,
    uniqueCallName: params.uniqueCallName,
    scope: 'audio_transcribe_only',
    iat: now,
    exp,
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = hmacSign(BRIDGE_HMAC_SECRET, encoded);
  return {
    token: `${encoded}.${sig}`,
    expiresAtIso: new Date(exp).toISOString(),
  };
}

export function consumeScopedTransferToken(
  token: string | undefined,
  expectedJobId: string
): { valid: true; payload: ScopedTransferTokenPayload } | { valid: false; reason: string } {
  if (!token) return { valid: false, reason: 'Missing scoped transfer token' };
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'Malformed transfer token' };
  const [encoded, sig] = parts;
  const expectedSig = hmacSign(BRIDGE_HMAC_SECRET, encoded);
  if (!constantTimeCompare(sig, expectedSig)) {
    return { valid: false, reason: 'Invalid HMAC signature on transfer token' };
  }
  try {
    const payload = JSON.parse(base64UrlDecode(encoded)) as ScopedTransferTokenPayload;
    if (payload.scope !== 'audio_transcribe_only') {
      return { valid: false, reason: 'Token scope mismatch' };
    }
    if (payload.jobId !== expectedJobId) {
      return { valid: false, reason: 'Token jobId binding mismatch' };
    }
    if (payload.exp < Date.now()) {
      return { valid: false, reason: 'Transfer token expired' };
    }
    if (consumedTransferJtis.has(payload.jti)) {
      return { valid: false, reason: 'Replay rejected: transfer token already consumed' };
    }
    consumedTransferJtis.add(payload.jti);
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'Unreadable transfer token payload' };
  }
}

export function signExternalReportPayload(serializedBody: string): string {
  return hmacSign(BRIDGE_HMAC_SECRET, serializedBody);
}

export function verifyExternalReportSignature(serializedBody: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = hmacSign(BRIDGE_HMAC_SECRET, serializedBody);
  return constantTimeCompare(signature, expected);
}

export function maskNationalId(nationalId: string): string {
  if (nationalId.length < 4) return '*********';
  return `${'*'.repeat(nationalId.length - 3)}${nationalId.slice(-3)}`;
}

/**
 * WrapUpAI: יצירת שמע לשיחות דיאלוג עם Azure Speech (קולות עבריים) כשאין מפתח Gemini.
 * הגדרה ב-.env:  AZURE_SPEECH_KEY=...  AZURE_SPEECH_REGION=francecentral
 */
import type { DialogueTurn } from './types.ts';

const FEMALE_VOICES = new Set(['Kore', 'Zephyr']);

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function isAzureTtsConfigured(): boolean {
  return Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
}

export async function synthesizeDialogueWithAzure(turns: DialogueTurn[]): Promise<{
  buffer: Buffer;
  mimeType: string;
  durationSeconds: number;
}> {
  // קול לפי מגדר הדובר; דוברים נוספים מאותו מגדר מקבלים גובה קול שונה כדי שיהיה אפשר להבחין ביניהם
  const pitchBySpeaker = new Map<string, string>();
  const countByVoice: Record<string, number> = {};
  const voiceFor = (turn: DialogueTurn) => (FEMALE_VOICES.has(turn.voiceName) ? 'he-IL-HilaNeural' : 'he-IL-AvriNeural');
  for (const turn of turns) {
    if (!pitchBySpeaker.has(turn.speakerLabel)) {
      const v = voiceFor(turn);
      const n = (countByVoice[v] = (countByVoice[v] || 0) + 1);
      pitchBySpeaker.set(turn.speakerLabel, ['+0%', '-12%', '+12%', '-20%'][(n - 1) % 4]);
    }
  }

  const body = turns
    .map(
      (turn) =>
        `<voice name="${voiceFor(turn)}"><prosody pitch="${pitchBySpeaker.get(turn.speakerLabel)}">` +
        `${escapeXml(turn.text)}</prosody><break time="400ms"/></voice>`
    )
    .join('');
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="he-IL">${body}</speak>`;

  const res = await fetch(
    `https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY as string,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
        'User-Agent': 'pbx-demo',
      },
      body: ssml,
    }
  );
  if (!res.ok) {
    throw new Error(`Azure TTS נכשל (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const durationSeconds = Math.max(1, Math.round((buffer.length - 44) / (24000 * 2)));
  return { buffer, mimeType: 'audio/wav', durationSeconds };
}

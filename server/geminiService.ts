import { GoogleGenAI, Type } from '@google/genai';
import type {
  DialogueTurn,
  ReportTopic,
  StructuredActionItem,
  TaskCategory,
  TaskPriority,
  TranscriptLine,
} from './types.ts';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractWavPcmData(wavBuffer: Buffer): {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  pcm: Buffer;
} {
  if (wavBuffer.length < 44 || wavBuffer.toString('ascii', 0, 4) !== 'RIFF') {
    return {
      sampleRate: 24000,
      numChannels: 1,
      bitsPerSample: 16,
      pcm: wavBuffer,
    };
  }

  let sampleRate = 24000;
  let numChannels = 1;
  let bitsPerSample = 16;
  let offset = 12;

  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;

    if (chunkId === 'fmt ' && dataStart + 16 <= wavBuffer.length) {
      numChannels = wavBuffer.readUInt16LE(dataStart + 2);
      sampleRate = wavBuffer.readUInt32LE(dataStart + 4);
      bitsPerSample = wavBuffer.readUInt16LE(dataStart + 14);
    } else if (chunkId === 'data') {
      const end = Math.min(dataStart + chunkSize, wavBuffer.length);
      return {
        sampleRate,
        numChannels,
        bitsPerSample,
        pcm: wavBuffer.subarray(dataStart, end),
      };
    }

    offset = dataStart + chunkSize + (chunkSize % 2);
  }

  return {
    sampleRate,
    numChannels,
    bitsPerSample,
    pcm: wavBuffer.subarray(44),
  };
}

function buildWavFromPcmChunks(
  chunks: Buffer[],
  sampleRate = 24000,
  numChannels = 1,
  bitsPerSample = 16
): Buffer {
  const pcmData = Buffer.concat(chunks);
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}

function createSilencePcm(durationMs: number, sampleRate = 24000, bytesPerSample = 2): Buffer {
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);
  return Buffer.alloc(sampleCount * bytesPerSample);
}

export async function synthesizeMultiSpeakerCallWav(turns: DialogueTurn[]): Promise<{
  buffer: Buffer;
  mimeType: string;
  durationSeconds: number;
}> {
  const ai = getAiClient();

  const turnWavs = await Promise.all(
    turns.map(async (turn) => {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: turn.text,
                speechMetadata: {
                  style: turn.style,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: turn.voiceName,
              },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        throw new Error(`TTS generation returned empty audio for speaker ${turn.speakerLabel}`);
      }
      return Buffer.from(base64Audio, 'base64');
    })
  );

  let sampleRate = 24000;
  let numChannels = 1;
  let bitsPerSample = 16;
  const pcmSegments: Buffer[] = [];

  for (let i = 0; i < turnWavs.length; i += 1) {
    const parsed = extractWavPcmData(turnWavs[i]);
    if (i === 0) {
      sampleRate = parsed.sampleRate;
      numChannels = parsed.numChannels;
      bitsPerSample = parsed.bitsPerSample;
    }
    pcmSegments.push(parsed.pcm);
    if (i < turnWavs.length - 1) {
      pcmSegments.push(createSilencePcm(380, sampleRate, bitsPerSample / 8));
    }
  }

  const combinedBuffer = buildWavFromPcmChunks(pcmSegments, sampleRate, numChannels, bitsPerSample);
  const totalPcmBytes = combinedBuffer.length - 44;
  const bytesPerSec = sampleRate * numChannels * (bitsPerSample / 8);
  const durationSeconds = Math.max(1, Math.round(totalPcmBytes / bytesPerSec));

  return {
    buffer: combinedBuffer,
    mimeType: 'audio/wav',
    durationSeconds,
  };
}

export interface ExternalAnalysisOutput {
  executiveSummary: string;
  participantsDetected: Array<{ speakerLabel: string; role: string }>;
  topics: ReportTopic[];
  actionItems: StructuredActionItem[];
  transcript: TranscriptLine[];
}

export async function transcribeAndAnalyzeCallExternal(params: {
  audioBuffer: Buffer;
  mimeType: string;
  uniqueCallName: string;
  callDate: string;
  anonymizedParticipants: Array<{ anonymizedLabel: string; role: string }>;
}): Promise<ExternalAnalysisOutput> {
  const ai = getAiClient();

  const participantListText = params.anonymizedParticipants
    .map((p) => `${p.anonymizedLabel} (${p.role})`)
    .join(', ');

  // Step 1: Real audio transcription with gemini-3.5-transcribe
  const transcribeResponse = await ai.models.generateContent({
    model: 'gemini-3.5-transcribe',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: params.audioBuffer.toString('base64'),
          },
        },
        {
          text:
            `תמלל את קובץ השמע הבא בעברית בצורה מדויקת ומפורטת. ` +
            `זהה את הדוברים השונים לאורך השיחה (${participantListText || 'מספר משתתפים'}) וציין עבור כל שורה את חותמת הזמן המשוערת והדובר.`,
        },
      ],
    },
  });

  const rawTranscript = (transcribeResponse.text ?? '').trim();
  if (!rawTranscript) {
    throw new Error('התמלול מהמערכת החיצונית החזיר תוכן ריק.');
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  // Step 2: Structured business report divided by topics, speaker positions, and actionable calendar tasks
  const analysisResponse = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents:
      `להלן תמלול של שיחת שירות מרובת משתתפים מתוך מרכזיית מוסד ביטוח וגמלאות.\n` +
      `מזהה שיחה: ${params.uniqueCallName}\n` +
      `תאריך שיחה: ${params.callDate}\n` +
      `משתתפים אנונימיים מזוהים: ${participantListText}\n` +
      `תאריך ייחוס לתכנון משימות להמשך: ${todayIso}\n\n` +
      `תמלול השיחה:\n${rawTranscript}\n\n` +
      `נתח את השיחה והפק דוח עסקי מובנה בעברית בלבד, מחולק לנושאים ברורים, תוך פירוט עמדת כל צד בכל נושא, והפק רשימת משימות להמשך בתבנית מסודרת המתאימה לשיבוץ ביומן הלקוח.`,
    config: {
      systemInstruction:
        'אתה אנליסט תמלול וביקורת איכות במערכת חיצונית מאובטחת (ללא גישה למסד הנתונים של הלקוח). ' +
        'עליך לחלץ דוח עסקי תמציתי ומקצועי בעברית המחולק לנושאים, לציין מה כל משתתף אמר בכל נושא, ' +
        'וליצור משימות המשך פרקטיות עם תאריך מוצע בפורמט YYYY-MM-DD ושעה בפורמט HH:mm.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          executiveSummary: {
            type: Type.STRING,
            description: 'סיכום מנהלים תמציתי של השיחה ותוצאותיה בעברית.',
          },
          participantsDetected: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                speakerLabel: { type: Type.STRING },
                role: { type: Type.STRING },
              },
              required: ['speakerLabel', 'role'],
            },
          },
          topics: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                topicTitle: { type: Type.STRING },
                topicSummary: { type: Type.STRING },
                participantStatements: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      speakerLabel: { type: Type.STRING },
                      role: { type: Type.STRING },
                      statementSummary: { type: Type.STRING },
                      keyPoints: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                    },
                    required: ['speakerLabel', 'role', 'statementSummary', 'keyPoints'],
                  },
                },
              },
              required: ['topicTitle', 'topicSummary', 'participantStatements'],
            },
          },
          actionItems: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                owner: { type: Type.STRING },
                priority: { type: Type.STRING, description: 'אחד מהערכים: דחופה, גבוהה, רגילה' },
                category: {
                  type: Type.STRING,
                  description:
                    'אחד מהערכים: מסמכים, ועדה רפואית, תשלום וגבייה, תיאום פגישה, מעקב פנימי, אישור מעסיק, שיקום והכשרה, ערעור ובדיקה מחדש',
                },
                suggestedDate: { type: Type.STRING, description: 'תאריך מוצע בפורמט YYYY-MM-DD' },
                suggestedTime: { type: Type.STRING, description: 'שעה מוצעת בפורמט HH:mm' },
              },
              required: ['title', 'description', 'owner', 'priority', 'category', 'suggestedDate', 'suggestedTime'],
            },
          },
          transcript: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                timestamp: { type: Type.STRING },
                speakerLabel: { type: Type.STRING },
                role: { type: Type.STRING },
                text: { type: Type.STRING },
              },
              required: ['timestamp', 'speakerLabel', 'role', 'text'],
            },
          },
        },
        required: ['executiveSummary', 'participantsDetected', 'topics', 'actionItems', 'transcript'],
      },
    },
  });

  const jsonText = (analysisResponse.text ?? '{}').trim();
  const parsed = JSON.parse(jsonText) as {
    executiveSummary: string;
    participantsDetected: Array<{ speakerLabel: string; role: string }>;
    topics: ReportTopic[];
    actionItems: Array<{
      title: string;
      description: string;
      owner: string;
      priority: string;
      category: string;
      suggestedDate: string;
      suggestedTime: string;
    }>;
    transcript: TranscriptLine[];
  };

  const validPriorities: TaskPriority[] = ['דחופה', 'גבוהה', 'רגילה'];
  const validCategories: TaskCategory[] = [
    'מסמכים',
    'ועדה רפואית',
    'תשלום וגבייה',
    'תיאום פגישה',
    'מעקב פנימי',
    'אישור מעסיק',
    'שיקום והכשרה',
    'ערעור ובדיקה מחדש',
  ];

  const normalizedTasks: StructuredActionItem[] = (parsed.actionItems || []).map((item, idx) => {
    const priority = validPriorities.includes(item.priority as TaskPriority)
      ? (item.priority as TaskPriority)
      : 'רגילה';
    const category = validCategories.includes(item.category as TaskCategory)
      ? (item.category as TaskCategory)
      : 'מעקב פנימי';

    return {
      taskId: `TASK-${Date.now().toString().slice(-5)}-${idx + 1}`,
      title: item.title,
      description: item.description,
      owner: item.owner,
      priority,
      category,
      suggestedDate: /^\d{4}-\d{2}-\d{2}$/.test(item.suggestedDate) ? item.suggestedDate : todayIso,
      suggestedTime: /^\d{2}:\d{2}$/.test(item.suggestedTime) ? item.suggestedTime : '10:00',
      addedToCalendar: false,
    };
  });

  return {
    executiveSummary: parsed.executiveSummary,
    participantsDetected: parsed.participantsDetected || [],
    topics: parsed.topics || [],
    actionItems: normalizedTasks,
    transcript: parsed.transcript || [],
  };
}

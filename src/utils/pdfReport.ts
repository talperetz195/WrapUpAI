import type { CallAnalysisReport, CustomerRecord } from '../types';

const PAGE_W = 1654; // A4 @ 200 DPI
const PAGE_H = 2339;
const MARGIN_X = 104;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const HEADER_H = 190;
const FOOTER_H = 100;
const MAX_Y = PAGE_H - FOOTER_H - 30;

export interface GeneratedPdfResult {
  blob: Blob;
  blobUrl: string;
  pageImages: string[]; // Data URLs for zero-block inline preview
  fileName: string;
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const words = cleaned.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      if (ctx.measureText(word).width <= maxWidth) {
        current = word;
      } else {
        // Hard-break unusually long tokens (e.g. long IDs)
        let chunk = '';
        for (const ch of word) {
          if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function formatHeDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function splitSummaryToBullets(summary: string): string[] {
  const sentences = summary
    .split(/(?<=[.!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.length > 0 ? sentences : [summary];
}

function base64ToUint8Array(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function buildPdfFromJpegPages(jpegDataUrls: string[]): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let byteOffset = 0;
  const offsets: number[] = [0]; // 1-indexed object offsets; index 0 reserved

  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    byteOffset += bytes.length;
  };
  const pushStr = (str: string) => {
    pushBytes(encoder.encode(str));
  };

  pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  const pageCount = jpegDataUrls.length;
  // Object 1: Catalog
  // Object 2: Pages
  // For each page i: Page = 3 + i*3, Content = 4 + i*3, Image = 5 + i*3
  const pageObjIds: number[] = [];
  for (let i = 0; i < pageCount; i += 1) {
    pageObjIds.push(3 + i * 3);
  }

  // Obj 1: Catalog
  offsets[1] = byteOffset;
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Obj 2: Pages
  offsets[2] = byteOffset;
  pushStr(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`
  );

  for (let i = 0; i < pageCount; i += 1) {
    const pageObj = 3 + i * 3;
    const contentObj = 4 + i * 3;
    const imageObj = 5 + i * 3;

    const base64 = jpegDataUrls[i].split(',')[1] || '';
    const jpegBytes = base64ToUint8Array(base64);
    const contentStream = `q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n`;

    // Page object
    offsets[pageObj] = byteOffset;
    pushStr(
      `${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>\nendobj\n`
    );

    // Content stream object
    offsets[contentObj] = byteOffset;
    pushStr(
      `${contentObj} 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`
    );

    // Image XObject
    offsets[imageObj] = byteOffset;
    pushStr(
      `${imageObj} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${PAGE_W} /Height ${PAGE_H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
    );
    pushBytes(jpegBytes);
    pushStr('\nendstream\nendobj\n');
  }

  const totalObjects = 2 + pageCount * 3;
  const xrefOffset = byteOffset;
  pushStr(`xref\n0 ${totalObjects + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (let id = 1; id <= totalObjects; id += 1) {
    const off = String(offsets[id]).padStart(10, '0');
    pushStr(`${off} 00000 n \n`);
  }
  pushStr(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  const merged = new Uint8Array(byteOffset);
  let pos = 0;
  for (const chunk of chunks) {
    merged.set(chunk, pos);
    pos += chunk.length;
  }

  return new Blob([merged], { type: 'application/pdf' });
}

export async function generateStructuredReportPdf(
  report: CallAnalysisReport,
  customer?: CustomerRecord
): Promise<GeneratedPdfResult> {
  if (typeof document !== 'undefined' && 'fonts' in document) {
    await document.fonts.ready;
  }

  const pages: HTMLCanvasElement[] = [];
  let canvas!: HTMLCanvasElement;
  let ctx!: CanvasRenderingContext2D;
  let y = 0;

  const startNewPage = (isFirst: boolean) => {
    canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context unavailable for PDF generation.');
    }
    ctx = context;
    ctx.direction = 'rtl';
    ctx.textBaseline = 'top';

    // White A4 background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    // Top Institutional Header Band
    ctx.fillStyle = '#0F2942';
    ctx.fillRect(0, 0, PAGE_W, isFirst ? HEADER_H : 124);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 34px "Heebo", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('מוסד תגמולים וביטוח ארצי — דוח סיכום שיחה רשמי', PAGE_W - MARGIN_X, 40);

    ctx.fillStyle = '#CBD5E1';
    ctx.font = '400 22px "Heebo", sans-serif';
    ctx.fillText(
      `מזהה שיחה: ${report.uniqueCallName}  ·  מזהה דוח: ${report.id}`,
      PAGE_W - MARGIN_X,
      isFirst ? 92 : 84
    );

    if (isFirst) {
      ctx.fillStyle = '#93C5FD';
      ctx.font = '500 20px "Heebo", sans-serif';
      ctx.fillText(
        `אומת בחתימת HMAC-SHA256 · שויך ישירות לכרטיס הלקוח במערכת הפנימית`,
        PAGE_W - MARGIN_X,
        134
      );
      y = HEADER_H + 44;
    } else {
      y = 166;
    }

    pages.push(canvas);
  };

  const ensureSpace = (neededHeight: number) => {
    if (y + neededHeight > MAX_Y) {
      startNewPage(false);
    }
  };

  const drawSectionHeading = (title: string) => {
    ensureSpace(84);
    ctx.fillStyle = '#0F2942';
    ctx.font = '700 28px "Heebo", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(title, PAGE_W - MARGIN_X, y);
    y += 44;
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(MARGIN_X, y);
    ctx.lineTo(PAGE_W - MARGIN_X, y);
    ctx.stroke();
    y += 22;
  };

  const drawBulletLine = (text: string, indent = 0, font = '400 23px "Heebo", sans-serif', color = '#1E293B') => {
    ctx.font = font;
    const bulletX = PAGE_W - MARGIN_X - indent;
    const textStartX = bulletX - 28;
    const availW = CONTENT_W - indent - 28;
    const lines = wrapTextLines(ctx, text, availW);
    const lineHeight = 34;

    ensureSpace(lines.length * lineHeight + 12);

    ctx.fillStyle = '#1D4ED8';
    ctx.textAlign = 'right';
    ctx.fillText('•', bulletX, y);

    ctx.fillStyle = color;
    for (const line of lines) {
      ctx.fillText(line, textStartX, y);
      y += lineHeight;
    }
    y += 8;
  };

  // Start Page 1
  startNewPage(true);

  // Fixed Metadata Grid Box
  const boxH = 196;
  ctx.fillStyle = '#F8FAFC';
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.fillRect(MARGIN_X, y, CONTENT_W, boxH);
  ctx.strokeRect(MARGIN_X, y, CONTENT_W, boxH);

  const col1X = PAGE_W - MARGIN_X - 28;
  const col2X = PAGE_W / 2 - 20;

  const drawMetaField = (label: string, value: string, x: number, rowY: number) => {
    ctx.fillStyle = '#64748B';
    ctx.font = '600 19px "Heebo", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(label, x, rowY);

    ctx.fillStyle = '#0F172A';
    ctx.font = '600 22px "Heebo", sans-serif';
    ctx.fillText(value, x, rowY + 26);
  };

  drawMetaField('שם הלקוח / מבוטח', report.customerName, col1X, y + 22);
  drawMetaField('מספר תיק ומחלקה', `${customer?.caseNumber || '—'} · ${customer?.department || '—'}`, col2X, y + 22);
  drawMetaField('תאריך הפקת הדוח', formatHeDate(report.returnedAt), col1X, y + 102);
  drawMetaField(
    'משתתפים שזוהו בשיחה',
    report.participantsDetected.map((p) => `${p.speakerLabel} (${p.role})`).join(' · '),
    col2X,
    y + 102
  );

  y += boxH + 42;

  // Section 1: Executive Summary in Bullet Points
  drawSectionHeading('1. סיכום מנהלים ועיקרי השיחה (בנקודות)');
  const summaryBullets = splitSummaryToBullets(report.executiveSummary);
  for (const bullet of summaryBullets) {
    drawBulletLine(bullet, 6);
  }
  y += 20;

  // Section 2: Topics & What Each Side Said in Bullet Points
  drawSectionHeading('2. פילוח לפי נושאים — עמדת כל צד בשיחה');
  report.topics.forEach((topic, tIdx) => {
    ensureSpace(120);
    ctx.fillStyle = '#0F172A';
    ctx.font = '700 24px "Heebo", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${tIdx + 1}. ${topic.topicTitle}`, PAGE_W - MARGIN_X, y);
    y += 36;

    drawBulletLine(`תקציר הנושא: ${topic.topicSummary}`, 14, '500 22px "Heebo", sans-serif', '#334155');

    for (const stmt of topic.participantStatements) {
      ensureSpace(75);
      ctx.fillStyle = '#1D4ED8';
      ctx.font = '700 22px "Heebo", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${stmt.speakerLabel} (${stmt.role}):`, PAGE_W - MARGIN_X - 24, y);
      y += 32;

      drawBulletLine(stmt.statementSummary, 40, '400 21px "Heebo", sans-serif', '#1E293B');
      for (const kp of stmt.keyPoints) {
        drawBulletLine(kp, 56, '400 20px "Heebo", sans-serif', '#475569');
      }
    }
    y += 14;
  });

  // Section 3: Action Items in Fixed Structured Points
  drawSectionHeading('3. משימות להמשך בתבנית מסודרת');
  report.actionItems.forEach((task, idx) => {
    ensureSpace(145);
    ctx.fillStyle = '#0F172A';
    ctx.font = '700 23px "Heebo", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(
      `משימה ${idx + 1}: ${task.title}`,
      PAGE_W - MARGIN_X,
      y
    );
    y += 34;

    drawBulletLine(`פירוט: ${task.description}`, 18, '400 21px "Heebo", sans-serif', '#1E293B');
    drawBulletLine(
      `אחראי: ${task.owner}  ·  קטגוריה: ${task.category}  ·  עדיפות: ${task.priority}`,
      18,
      '500 21px "Heebo", sans-serif',
      '#334155'
    );
    drawBulletLine(
      `מועד יעד מוצע: ${task.suggestedDate} בשעה ${task.suggestedTime}  ·  סטטוס יומן: ${
        task.addedToCalendar ? 'שובץ ביומן הלקוח' : 'ממתין לשיבוץ ביומן'
      }`,
      18,
      '500 21px "Heebo", sans-serif',
      task.addedToCalendar ? '#15803D' : '#1D4ED8'
    );
    y += 12;
  });

  // Stamp page footers across all generated pages
  const totalPages = pages.length;
  const pageImages: string[] = [];

  for (let i = 0; i < totalPages; i += 1) {
    const pCanvas = pages[i];
    const pCtx = pCanvas.getContext('2d')!;
    const footerY = PAGE_H - FOOTER_H;

    pCtx.strokeStyle = '#E2E8F0';
    pCtx.lineWidth = 2;
    pCtx.beginPath();
    pCtx.moveTo(MARGIN_X, footerY);
    pCtx.lineTo(PAGE_W - MARGIN_X, footerY);
    pCtx.stroke();

    pCtx.direction = 'rtl';
    pCtx.textBaseline = 'top';
    pCtx.fillStyle = '#64748B';
    pCtx.font = '400 18px "Heebo", sans-serif';
    pCtx.textAlign = 'right';
    pCtx.fillText(
      'מסמך זה הופק במערכת הניהול הפנימית המאובטחת · למערכת התמלול החיצונית לא ניתנה גישה לתיק הלקוח',
      PAGE_W - MARGIN_X,
      footerY + 24
    );

    pCtx.textAlign = 'left';
    pCtx.fillText(`עמוד ${i + 1} מתוך ${totalPages}`, MARGIN_X, footerY + 24);

    pageImages.push(pCanvas.toDataURL('image/jpeg', 0.92));
  }

  const blob = buildPdfFromJpegPages(pageImages);
  const blobUrl = URL.createObjectURL(blob);
  const fileName = `${report.uniqueCallName}-summary.pdf`;

  return {
    blob,
    blobUrl,
    pageImages,
    fileName,
  };
}

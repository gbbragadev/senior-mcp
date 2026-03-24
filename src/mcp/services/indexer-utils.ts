import crypto from 'crypto';

export interface TextChunk {
  text: string;
  startLine?: number;
  endLine?: number;
  headingPath?: string;
  routineName?: string;
}

export function sha1(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex');
}

export function collapseWhitespace(value: string): string {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function splitWithOverlap(text: string, chunkSize: number, overlap: number): string[] {
  const normalized = collapseWhitespace(text);
  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + chunkSize);
    if (end < normalized.length) {
      let breakPos = normalized.lastIndexOf('\n', end);
      if (breakPos <= start + Math.floor(chunkSize * 0.5)) {
        breakPos = normalized.lastIndexOf(' ', end);
      }
      if (breakPos > start + Math.floor(chunkSize * 0.4)) {
        end = breakPos;
      }
    }
    const piece = normalized.slice(start, end).trim();
    if (piece.length > 0) chunks.push(piece);
    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

export function tryDecodeUtf8(content: Buffer): string | null {
  try {
    const text = content.toString('utf8');
    if (text.includes('\u0000')) return null;
    return text;
  } catch {
    return null;
  }
}

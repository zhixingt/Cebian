import type { ImageContent } from '@earendil-works/pi-ai';
import { escapeXml } from './utils';
import { RECORDING_SCHEMA_COMMENT } from './recorder/schema-doc';
import { loadPdfJs } from './pdf-loader';

// Lazy-load heavy parsers only when needed
let mammoth: typeof import('mammoth') | undefined;
let XLSX: typeof import('xlsx') | undefined;

// ─── Attachment types ───

export interface ImageAttachment {
  type: 'image';
  source: 'screenshot' | 'upload' | 'paste';
  data: string;          // base64 without data: prefix
  mimeType: string;
  name?: string;
}

export interface TextFileAttachment {
  type: 'file';
  content: string;
  name: string;
  mimeType: string;
  size: number;          // original bytes
}

export interface ElementAttachment {
  type: 'element';
  selector: string;
  tagName: string;
  path: string;          // full path from html root
  attributes: Record<string, string>;
  textContent?: string;  // first 200 chars of innerText
  rect?: { x: number; y: number; width: number; height: number };
  tabId?: number;
  tabUrl?: string;
  windowId?: number;
  frameId?: number;      // 0 or undefined = top frame
  frameUrl?: string;
}

/**
 * A captured user-interaction recording, stored as a JSON string. The agent
 * receives the raw JSON wrapped in a `<recording>` block; the UI shows a
 * download chip. `truncatedAttachment` is set when `events` had to be cut
 * from the end to fit `MAX_RECORDING_SIZE`.
 */
export interface RecordingAttachment {
  type: 'recording';
  /** Display + download filename, e.g. `recording-20260422-1503.json`. */
  name: string;
  /** UTF-8 byte length of `json`. */
  sizeBytes: number;
  eventCount: number;
  durationMs: number;
  /** Serialized RecordedSession. May reflect a truncated session. */
  json: string;
  /** True when events were dropped from the end to fit the size limit. */
  truncatedAttachment?: boolean;
}

export type Attachment = ImageAttachment | TextFileAttachment | ElementAttachment | RecordingAttachment;

/** MIME type for serialized recording JSON. Used for both the agent-prompt
 *  envelope and browser downloads of recording attachments. */
export const RECORDING_MIME = 'application/x-cebian-recording+json';

// ─── Size / type limits ───

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;      // 5 MB
export const MAX_TEXT_FILE_SIZE = 100 * 1024;         // 100 KB
/** Cap recording JSON to keep prompt budget reasonable (~80k tokens worst case). */
export const MAX_RECORDING_SIZE = 256 * 1024;         // 256 KB
export const MAX_ATTACHMENT_COUNT = 10;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.tsv', '.log',
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.py', '.java', '.c', '.cpp', '.h', '.hpp',
  '.go', '.rs', '.rb', '.php', '.sh', '.bash',
  '.sql', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.json', '.xml', '.html', '.htm', '.css', '.scss', '.less',
  '.env', '.gitignore', '.editorconfig',
  // Office & PDF documents (read as text; binary formats may produce garbled output,
  // but the user explicitly requested support and the LLM can still attempt extraction)
  '.doc', '.docx', '.xls', '.xlsx', '.pdf',
]);

const IMAGE_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
]);

export function getFileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

export function isTextFile(name: string): boolean {
  return TEXT_EXTENSIONS.has(getFileExtension(name));
}

export function isImageFile(file: File): boolean {
  return IMAGE_MIME_TYPES.has(file.type);
}

// ─── Build LLM-ready content from attachments ───

/**
 * Build XML text from element and file attachments, wrapped in <attachments>.
 * Returns empty string if there are no element/file attachments.
 */
export function buildTextPrefix(attachments: Attachment[]): string {
  const blocks: string[] = [];

  for (const a of attachments) {
    if (a.type === 'element') {
      const attrs = Object.entries(a.attributes)
        .map(([k, v]) => `${k}="${escapeXml(v, { forAttribute: true })}"`)
        .join(' ');

      const lines = [
        `<selected-element selector="${escapeXml(a.selector, { forAttribute: true })}"${a.frameId ? ` frame-id="${a.frameId}" frame-url="${escapeXml(a.frameUrl ?? '', { forAttribute: true })}"` : ''}>`,
        `  path: ${a.path}`,
        `  tag: ${a.tagName}`,
        `  attributes: ${attrs || '(none)'}`,
      ];
      if (a.textContent) lines.push(`  text: ${a.textContent}`);
      if (a.rect) lines.push(`  rect: ${a.rect.x},${a.rect.y} ${a.rect.width}×${a.rect.height}`);
      lines.push('</selected-element>');
      blocks.push(lines.join('\n'));
    }

    if (a.type === 'file') {
      blocks.push(
        `<attached-file name="${escapeXml(a.name, { forAttribute: true })}" type="${escapeXml(a.mimeType, { forAttribute: true })}">\n${a.content}\n</attached-file>`,
      );
    }

    if (a.type === 'recording') {
      const truncAttr = a.truncatedAttachment ? ' truncated="true"' : '';
      // Element-text-escape the JSON body so arbitrary recorded text
      // (containing `<`, `>`, or `&`) can't break the surrounding XML or
      // the non-greedy <attachments>...</attachments> regex used for
      // parsing. Body is plain readable JSON for the agent (no base64).
      blocks.push(
        `<recording name="${escapeXml(a.name, { forAttribute: true })}" mime="${RECORDING_MIME}" event-count="${a.eventCount}" duration-ms="${a.durationMs}"${truncAttr}>\n${escapeXml(a.json)}\n</recording>`,
      );
    }
  }

  if (blocks.length === 0) return '';

  // When the message carries at least one <recording>, prepend a schema
  // comment so the agent can interpret the JSON body without guessing
  // field meanings. Only inject when relevant to avoid spending tokens
  // on messages that don't need it.
  const hasRecording = attachments.some((a) => a.type === 'recording');
  const body = hasRecording
    ? `${RECORDING_SCHEMA_COMMENT}\n${blocks.join('\n\n')}`
    : blocks.join('\n\n');
  return `<attachments>\n${body}\n</attachments>`;
}

/**
 * Extract ImageContent array from attachments for multi-modal prompt.
 */
export function extractImages(attachments: Attachment[]): ImageContent[] {
  return attachments
    .filter((a): a is ImageAttachment => a.type === 'image')
    .map(a => ({ type: 'image' as const, data: a.data, mimeType: a.mimeType }));
}

/**
 * Format file size for display (e.g. "2.3 KB", "1.1 MB").
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Frontend text extraction for Office & PDF ───

const EXTRACTABLE_EXTENSIONS = new Set(['.pdf', '.docx', '.xls', '.xlsx']);

export function isExtractableFile(name: string): boolean {
  return EXTRACTABLE_EXTENSIONS.has(getFileExtension(name));
}

/**
 * 所有支持上传的文件扩展名集合（用于 `<input accept>` 属性）。
 * 动态聚合 TEXT_EXTENSIONS 和 EXTRACTABLE_EXTENSIONS，与代码逻辑保持同步，
 * 避免硬编码 accept 属性导致遗漏。
 */
// .doc is not supported in browser; code already prompts user to convert to .docx
export const UPLOADABLE_EXTENSIONS = new Set(
  Array.from(new Set([...TEXT_EXTENSIONS, ...EXTRACTABLE_EXTENSIONS]))
    .filter((ext) => ext !== '.doc'),
);

/**
 * 用于 `<input accept>` 属性的扩展名白名单。
 * Windows 文件对话框对不认识/过长的扩展名列表会整体失效，
 * 因此只保留最常见、Windows 能可靠识别的扩展名。
 * 其他支持格式仍可通过"所有文件"选择，代码层面的过滤逻辑不变。
 */
export const ACCEPT_EXTENSIONS = new Set([
  '.txt', '.md', '.csv',
  '.js', '.ts', '.py', '.java', '.go', '.php', '.sh', '.sql', '.yaml', '.yml',
  '.json', '.xml', '.html', '.htm', '.css',
  '.pdf', '.docx', '.xls', '.xlsx',
]);

/**
 * Extract plain text from PDF, DOCX, or XLSX files in the browser.
 * Returns null for unsupported formats or on failure.
 * The result is truncated to ~50k chars to prevent token overflow.
 */
export async function extractTextFromFile(file: File): Promise<string | null> {
  const ext = getFileExtension(file.name);
  console.log('[extract] start', file.name, 'ext:', ext, 'size:', file.size);

  try {
    if (ext === '.pdf') {
      console.log('[extract] loading pdfjs for', file.name);
      const pdfjs = await loadPdfJs();
      console.log('[extract] pdfjs loaded, reading arrayBuffer');
      const arrayBuffer = await file.arrayBuffer();
      console.log('[extract] arrayBuffer ready, parsing PDF');
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      console.log('[extract] PDF parsed, pages:', pdf.numPages);
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item: any) => item.str).join(' ') + '\n';
      }
      console.log('[extract] PDF text extracted, length:', text.length);
      return text.slice(0, 50_000);
    }

    if (ext === '.docx') {
      console.log('[extract] loading mammoth for', file.name);
      mammoth ??= await import('mammoth');
      console.log('[extract] mammoth loaded, reading arrayBuffer');
      const arrayBuffer = await file.arrayBuffer();
      console.log('[extract] arrayBuffer ready, extracting text');
      const result = await mammoth.extractRawText({ arrayBuffer });
      console.log('[extract] DOCX text extracted, length:', result.value.length);
      return result.value.slice(0, 50_000);
    }

    if (ext === '.xlsx' || ext === '.xls') {
      console.log('[extract] loading xlsx for', file.name);
      const xlsxLib = XLSX ?? (await import('xlsx'));
      XLSX = xlsxLib;
      console.log('[extract] xlsx loaded, reading arrayBuffer');
      const arrayBuffer = await file.arrayBuffer();
      console.log('[extract] arrayBuffer ready, parsing workbook');
      const workbook = xlsxLib.read(arrayBuffer, { type: 'array' });
      console.log('[extract] workbook parsed, sheets:', workbook.SheetNames.join(', '));
      return workbook.SheetNames
        .map((name) => {
          const sheet = workbook.Sheets[name];
          return `[Sheet: ${name}]\n${xlsxLib.utils.sheet_to_csv(sheet)}`;
        })
        .join('\n\n')
        .slice(0, 50_000);
    }
  } catch (err) {
    console.error('[extract] failed for', file.name, err);
  }

  console.log('[extract] returning null for', file.name);
  return null;
}



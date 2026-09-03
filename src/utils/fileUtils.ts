import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Đọc file JSON an toàn, trả về null nếu file không tồn tại.
 */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Ghi file JSON với pretty-print.
 */
export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Đọc file text an toàn.
 */
export async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// ============================================================
// Encoding detection (UTF-8 / Windows-1252 / ISO-8859-1)
// ============================================================

export type TextEncoding = 'utf-8' | 'windows-1252' | 'iso-8859-1' | 'ascii';

const CP1252_EXTRA: Record<number, string> = {
  0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E', 0x85: '\u2026',
  0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6', 0x89: '\u2030', 0x8A: '\u0160',
  0x8B: '\u2039', 0x8C: '\u0152', 0x8E: '\u017D', 0x91: '\u2018', 0x92: '\u2019',
  0x93: '\u201C', 0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
  0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A', 0x9C: '\u0153',
  0x9E: '\u017E', 0x9F: '\u0178',
};

/** Các byte 0x80-0x9F không tồn tại trong Windows-1252 (dùng để phân biệt với ISO-8859-1). */
const CP1252_UNDEFINED = [0x81, 0x8D, 0x8F, 0x90, 0x9D];

/**
 * Phát hiện encoding của một Buffer:
 * - ASCII nếu tất cả byte < 0x80
 * - UTF-8 nếu decode nghiêm ngặt (fatal) thành công (BOM được bỏ qua)
 * - ISO-8859-1 nếu chỉ có byte 0xA0-0xFF hoặc chứa byte không hợp lệ trong Windows-1252
 * - Windows-1252 (cp1252) cho các trường hợp còn lại
 */
export function detectTextEncoding(buffer: Buffer): TextEncoding {
  if (buffer.length === 0) return 'ascii';

  // Bỏ qua BOM UTF-8 nếu có → xác định là UTF-8
  const hasUtf8Bom = buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;
  const data = hasUtf8Bom ? buffer.subarray(3) : buffer;

  if (hasUtf8Bom) return 'utf-8';
  if (data.every(b => b < 0x80)) return 'ascii';

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data);
    return 'utf-8';
  } catch {
    let hasCp1252Range = false;
    let hasUndefinedCp1252 = false;
    for (const b of data) {
      if (b >= 0x80 && b <= 0x9F) {
        hasCp1252Range = true;
        if (CP1252_UNDEFINED.includes(b)) hasUndefinedCp1252 = true;
      }
    }
    if (!hasCp1252Range) return 'iso-8859-1';
    return hasUndefinedCp1252 ? 'iso-8859-1' : 'windows-1252';
  }
}

/**
 * Giải mã Buffer theo encoding đã phát hiện về chuỗi Unicode.
 */
export function decodeBuffer(buffer: Buffer, encoding: TextEncoding): string {
  if (encoding === 'utf-8' || encoding === 'ascii') {
    return buffer.toString('utf-8').replace(/^\uFEFF/, '');
  }
  if (encoding === 'iso-8859-1') {
    return buffer.toString('latin1');
  }
  // windows-1252
  let out = '';
  for (const b of buffer) {
    const mapped = b >= 0x80 && b <= 0x9F ? CP1252_EXTRA[b] : undefined;
    out += mapped ?? String.fromCharCode(b);
  }
  return out;
}

/**
 * Đọc file dưới dạng Buffer (trả về null nếu không đọc được).
 */
export async function readFileBuffer(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

/**
 * Kiểm tra một segment đường dẫn có an toàn hay không:
 * chặn path traversal (.., /, \), null byte và segment rỗng/dấu chấm.
 * Dùng để validate arc / chapter từ input của người dùng.
 */
export function isSafePathSegment(segment: string): boolean {
  if (!segment || segment.length === 0) return false;
  if (segment === '.' || segment === '..') return false;
  if (segment.includes('/') || segment.includes('\\') || segment.includes('\0')) return false;
  if (segment.includes('..')) return false;
  return true;
}

/**
 * Kiểm tra file/thư mục có tồn tại không.
 */
export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Đệ quy liệt kê tất cả file trong thư mục.
 *
 * NOTE (by-design, không phải thiếu sót): implementation_plan.md từng đề xuất
 * thêm dep `glob` + `diff`, nhưng hiện thực đã thay bằng:
 * - `walkDir`/`findMarkdownFiles` thay `glob` — đủ cho nhu cầu quét .md/.txt,
 *   không thêm dependency, tránh breaking-change upstream;
 * - `copyDir` + full-copy snapshot (xem createSnapshot trong rescue/snapshot.ts)
 *   thay `diff` — tiểu thuyết vài MB, full-copy đơn giản và robust hơn diff.
 * Chỉ cân nhắc thêm dep khi repo manuscript vượt ~100MB hoặc cần lưu
 * diff từng phần thay vì full-copy.
 */
export async function walkDir(dir: string, extensions?: string[]): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden directories and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (extensions) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            results.push(fullPath);
          }
        } else {
          results.push(fullPath);
        }
      }
    }
  }

  await walk(dir);
  return results;
}

/**
 * Đọc tất cả file Markdown trong thư mục (đệ quy).
 */
export async function findMarkdownFiles(dir: string): Promise<string[]> {
  return walkDir(dir, ['.md', '.txt']);
}

/**
 * Tạo ID ngắn dựa trên timestamp.
 */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

/**
 * Lấy kích thước file (bytes).
 */
export async function getFileSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

/**
 * Copy đệ quy một thư mục.
 */
export async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

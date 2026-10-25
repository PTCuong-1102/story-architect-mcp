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

// ============================================================
// Atomic write + Advisory file lock (anti-race cho .story/*.json)
// ============================================================

/**
 * Ghi file nguyên tử: ghi vào file tạm cùng thư mục (cùng filesystem →
 * rename rẻ và nguyên tử) rồi rename đè lên file đích.
 *
 * Garanti: reader (fs.readFile) luôn thấy TRỌN VẸN nội dung cũ hoặc mới,
 * không bao giờ file cắt nửa chừng khi process sập giữa chừng ghi.
 * File tạm được dọn sạch kể cả khi thao tác lỗi.
 */
export async function writeTextFileAtomic(filePath: string, text: string): Promise<void> {
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    await fs.writeFile(tmp, text, 'utf-8');
    await fs.rename(tmp, filePath);
  } catch (error) {
    try { await fs.unlink(tmp); } catch { /* tmp chưa kịp tạo */ }
    throw error;
  }
}

/**
 * Ghi file JSON với pretty-print (nguyên tử — xem writeTextFileAtomic).
 */
export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeTextFileAtomic(filePath, JSON.stringify(data, null, 2) + '\n');
}

export interface FileLockOptions {
  /** Tổng thời gian tối đa chờ khoá (ms) trước khi báo lỗi. */
  timeoutMs?: number;
  /** Khoá "stale" cũ hơn TTL này (ms) sẽ bị mượn (process chủ có thể đã sập). */
  staleTtlMs?: number;
}

const DEFAULT_LOCK_TIMEOUT = 10_000;
const DEFAULT_STALE_TTL = 15_000;
const LOCK_RETRY_DELAY = 25;

/** Mutex nội bộ: serialize các lock cùng path trong cùng process (tool call song song). */
const inProcessLocks = new Map<string, Promise<unknown>>();

/** Đường dẫn khoá on-disk cho một file dữ liệu: cùng thư mục cha, tên `.lock-dir`. */
export function lockPathFor(filePath: string): string {
  return `${filePath}.lock-dir`;
}

/**
 * Advisory lock 2 tầng cho một vùng read-modify-write.
 *
 * - Tầng in-process: mutex Map — các call cùng server instance chạy tuần tự
 *   ngay lập tức (không chờ fs).
 * - Tầng on-disk: `fs.mkdir` trên `<file>.lock-dir` là nguyên tử trên POSIX
 *   lẫn Windows → cross-process an toàn. Khoá stale > staleTtlMs bị mượn.
 *   Chờ quá timeoutMs → throw (fail-fast, không treo server).
 *
 * Dùng cho mọi thao tác read-modify-write trên state JSON (`StoryProject.save*`).
 * Read thuần KHÔNG cần lock vì write đã nguyên tử (rename).
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const prev = inProcessLocks.get(lockPath) ?? Promise.resolve();

  const guarded = async (): Promise<T> => {
    await acquireDirLock(lockPath, options);
    try {
      return await fn();
    } finally {
      await fs.rm(lockPath, { recursive: true, force: true }).catch(() => { /* ok */ });
    }
  };

  const task = prev.then(() => guarded(), () => guarded());
  const guard = task.then(() => { }, () => { }); // promise "gác cổng" — lỗi không lan sang task kế
  inProcessLocks.set(lockPath, guard);
  guard.then(() => { if (inProcessLocks.get(lockPath) === guard) inProcessLocks.delete(lockPath); });
  return task;
}

async function acquireDirLock(lockPath: string, options: FileLockOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT;
  const staleTtlMs = options.staleTtlMs ?? DEFAULT_STALE_TTL;
  const deadline = Date.now() + timeoutMs;

  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      await fs.mkdir(lockPath); // nguyên tử — trúng = chiếm được khoá
      return;
    } catch {
      // Đã có khoá: kiểm tra stale cũ hơn TTL → mượn
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > staleTtlMs) {
          // Mượn: rm rồi mkdir ngay sau đó — có thể thua cho process khác
          // (mkdir dưới sẽ quyết định ai thắng).
          await fs.rm(lockPath, { recursive: true, force: true }).catch(() => { });
          try {
            await fs.mkdir(lockPath);
            return;
          } catch { /* ai đó chiếm trước — vòng lặp tiếp */ }
        }
      } catch { /* khoá vừa được giải phóng — thử lại */ }

      if (Date.now() >= deadline) {
        throw new Error(`⏳ Không chiếm được file lock sau ${timeoutMs}ms: ${lockPath}. Có process khác đang ghi — thử lại sau.`);
      }
      await new Promise(res => setTimeout(res, LOCK_RETRY_DELAY));
    }
  }
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
  // Chặn ký tự điều khiển/newline (tên file chứa \n) và tên quá dài
  // (giới hạn thực tế của hầu hết FS). Giữ fail-closed.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(segment)) return false;
  if (segment.length > 128) return false;
  if (segment !== segment.trim()) return false;
  return true;
}

/**
 * So sánh chuỗi tự nhiên: cụm số so theo giá trị số (ch_002 < ch_010,
 * arc_2 < arc_10), phần còn lại theo locale tiếng Việt.
 * Dùng cho sort arc/chapter — `.sort()` mặc định xếp sai từ 10 chương trở lên.
 */
export function compareNatural(a: string, b: string): number {
  return a.localeCompare(b, 'vi', { numeric: true });
}

const SYSTEM_SCAN_BLOCKLIST = [
  '/', '/etc', '/root', '/proc', '/sys', '/dev',
  '/bin', '/sbin', '/usr', '/var', '/opt', '/boot',
];

/**
 * Chặn quét/refactor vào thư mục hệ thống (/, /etc, /proc...).
 * Các tool scan nhận path tùy ý từ LLM — đây là rào chắn chống
 * prompt-injection dụ agent đọc toàn bộ hệ thống. Trả về true = cấm.
 */
export function isBlockedScanPath(resolvedPath: string): boolean {
  const norm = resolvedPath.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  if (/^[a-z]:$/i.test(norm)) return true; // drive root Windows (C:)
  if (/^[a-z]:\/windows(\/|$)/i.test(norm)) return true;
  return SYSTEM_SCAN_BLOCKLIST.some(r => norm === r || norm.startsWith(r + '/'));
}

/**
 * Kiểm tra xem đường dẫn ghi file đầu ra (export, dashboard) có an toàn không:
 * - Không trỏ vào thư mục hệ thống (dùng isBlockedScanPath)
 * - Không trỏ vào thư mục nội bộ nhạy cảm (.git, .story)
 */
export function isSafeWritePath(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  if (isBlockedScanPath(resolved)) return false;
  const norm = resolved.replace(/\\/g, '/');
  const segments = norm.split('/');
  if (segments.some(seg => seg === '.git' || seg === '.story')) {
    return false;
  }
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
 * Fingerprint nhẹ của danh sách file dựa trên stat (mtime+size).
 * Dùng để phát hiện thay đổi "từ bên ngoài" (tác giả sửa file tay,
 * Oxygen hoặc editor khác ghi đè) mà không cần đọc nội dung:
 * mỗi phần tử = `<path>|<mtimeMs>|<size>`, nối bằng '\n'.
 *
 * Lưu ý: fingerprint nhạy vừa đủ — sửa nội dung cùng kích thước sẽ
 * đổi mtime (các editor/vi đều cập nhật mtime khi ghi), nên rủi ro
 * sót thay đổi là rất thấp. Nếu cần tuyệt đối hãy dùng hash nội dung.
 */
export async function computePathsFingerprint(paths: string[]): Promise<string> {
  const parts: string[] = [];
  for (const p of paths) {
    try {
      const st = await fs.stat(p);
      parts.push(`${p}|${st.mtimeMs}|${st.size}`);
    } catch {
      parts.push(`${p}|missing`);
    }
  }
  return parts.join('\n');
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

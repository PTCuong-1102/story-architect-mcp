// ============================================================
// v0.6.0 — Nhận diện bố cục đa dạng cho "novel as codebase"
// ============================================================
// Người dùng chuyển sang story-architect-mcp có thể đã bố trí tiểu thuyết
// của mình theo nhiều kiểu khác nhau: thư mục arc tự đặt tên, chương
// phẳng trong thư mục gốc, một file lớn chứa cả quyển, số chương ghi bằng
// chữ ("Chương mười hai") hay Hán tự ("第十二章")...
// Module này nhận diện bố cục HIỆN CÓ (không bắt buộc sửa) để:
// (1) story_scan_messy_project báo cáo bố cục thật của người viết,
// (2) story_auto_refactor_structure chọn hành động phù hợp (dry-run + snapshot).

import * as path from 'node:path';

/**
 * Bỏ dấu tiếng Việt (Trăng → Trang) + hạ chữ thường, phục vụ so khớp token.
 * Đặc biệt: ơ/ư/đ là ký tự precomposed (NFD không tách được — "mươi" không
 * → "muoi" nếu thiếu ánh xạ riêng, làm số chương chữ "mười/…mươi" bỏ sót).
 */
export function foldLower(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ơ/gi, 'o')
    .replace(/ư/gi, 'u')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

// ------------------------------------------------------------

/**
 * Đọc số chương Hán tự — "十二" → 12, "一百零一章" → 101, "两千回" → 2000.
 * Cụm số được trích sẵn bởi regex của findChapterHeadings.
 */
export function parseCnNumberPhrase(phrase: string): number | null {
  // Chuỗi thuần số Ả Rập → parseInt (tránh cur bị số cuối ghi đè: "3.5" → 5)
  if (/^\d+$/.test(phrase)) {
    const n = parseInt(phrase, 10);
    return n > 0 && n <= 100_000 ? n : null;
  }
  const value: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6,
    七: 7, 八: 8, 九: 9, '0': 0, '1': 1, '2': 2, '3': 3, '4': 4,
    '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  };
  const unit: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

  let total = 0;
  let cur = 0;
  let sawDigit = false;
  for (const ch of phrase) {
    if (ch in value) { cur = value[ch]; sawDigit = true; continue; }
    if (ch === '十' || ch === '百' || ch === '千') {
      total += (cur || 1) * unit[ch];
      cur = 0;
      continue;
    }
    if (ch === '万') {
      total = (total + cur) * unit[ch];
      cur = 0;
      continue;
    }
    // Ký tự lạ giữa cụm số ("3.5", "3-5") — chunk được trích là TOÀN numeral,
    // lạ là chuỗi rác → null thay vì âm thầm bỏ qua rồi dùng số cuối.
    return null;
  }
  if (!sawDigit) return null;
  return total + cur;
}

const ROMAN_RE = /^(M{0,3})(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i;
const ROMAN_VALUE: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

function parseRomanNumber(s: string): number | null {
  if (s.toUpperCase() !== s && s.toLowerCase() !== s) return null;
  if (!ROMAN_RE.test(s)) return null;
  const digits = s.toLowerCase().split('');
  let total = 0;
  for (let i = 0; i < digits.length; i++) {
    const cur = ROMAN_VALUE[digits[i]];
    const next = ROMAN_VALUE[digits[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total > 0 ? total : null;
}

const VN_UNIT: Record<string, number> = {
  khong: 0, mot: 1, hai: 2, ba: 3, tu: 4, bon: 4, nam: 5, lam: 5,
  sau: 6, bay: 7, tam: 8, chin: 9,
};
const VN_TEN_WORDS = new Set(['muoi', 'chuc']);
const VN_ZERO_FILLERS = new Set(['le', 'linh']);

/**
 * Đọc số chương tiếng Việt viết bằng chữ — "mười hai" → 12,
 * "hai mươi mốt" → 21, "một trăm linh hai" → 102, "ba trăm mười lăm" → 315.
 * Chuỗi không hợp lệ theo cú pháp → null (an toàn chống false positive).
 */
export function parseVnNumberPhrase(phrase: string): number | null {
  const norm = foldLower(phrase);
  // Chỉ chữ cái + khoảng trắng — có số/lý khác xen vào thì out
  if (!/^[a-z\s]+$/.test(norm)) return null;
  const tokens = norm.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 7) return null;

  // ── Hàng trăm: "X trăm ..." ──
  let head = 0;
  let rest = tokens;
  const tramIdx = tokens.indexOf('tram');
  if (tramIdx >= 0) {
    if (tramIdx > 1) return null; // "ba bốn trăm" — sai cú pháp
    if (tramIdx === 1) {
      const h = VN_UNIT[tokens[0]];
      if (h === undefined || h < 1 || h > 9) return null;
      head = h * 100;
    }
    rest = tokens.slice(tramIdx + 1);
    if (rest.length === 0) return head > 0 ? head : null;
    // "linh/lẻ" + phần t Doan chục
    if (VN_ZERO_FILLERS.has(rest[0])) rest = rest.slice(1);
    if (rest.length === 0) return head; // "một trăm linh"
  }

  // ── Hàng chục + đơn vị ──
  // Pattern hợp lệ: [muoi] | [muoi unit] | [d muoi] | [d muoi unit] | [d]
  if (rest[0] === undefined) return head > 0 ? head : null;

  if (VN_TEN_WORDS.has(rest[0])) {
    if (rest.length === 1) return head + 10;
    if (rest.length === 2) {
      const u = VN_UNIT[rest[1]];
      if (u !== undefined && u >= 1 && u <= 9) return head + 10 + u;
      return null;
    }
    return null;
  }

  const d0 = VN_UNIT[rest[0]];
  if (d0 === undefined || d0 < 1 || d0 > 9) return null;

  if (rest.length === 1) return head + d0;
  if (rest.length === 2 && VN_TEN_WORDS.has(rest[1]) && !VN_ZERO_FILLERS.has(rest[0])) return head + d0 * 10;
  if (rest.length === 3 && VN_TEN_WORDS.has(rest[1])) {
    const u = VN_UNIT[rest[2]];
    if (u !== undefined && u >= 1 && u <= 9) return head + d0 * 10 + u;
    return null;
  }
  return null;
}

/**
 * Đọc số chương từ CỤM bất kỳ: số Ả Rập, La Mã, chữ Việt, Hán tự.
 * Trả về null nếu không đọc được (in-world, tiêu đề rác).
 */
export function parseChapterNumber(phrase: string): number | null {
  const s = phrase.trim();
  if (!s) return null;
  if (/^[0-9]+$/.test(s)) {
    const n = parseInt(s, 10);
    return n > 0 && n <= 100_000 ? n : null;
  }
  const roman = parseRomanNumber(s);
  if (roman) return roman;
  const cn = parseCnNumberPhrase(s);
  if (cn) return cn;
  return parseVnNumberPhrase(s);
}

/**
 * Trích số chương từ phần text sau từ khóa "chương" trong tiêu đề:
 * "12: Tên" → 12, "mười hai - Tên" → 12, "XII" → 12.
 * Với cụm chữ, thử prefix dài dần nhất hợp lệ cú pháp số — "hai con mèo"
 * chỉ lấy "hai" (tiêu đề không nuốt số chương).
 */
export function extractChapterNumber(rest: string): number | null {
  const s = rest.trim();
  if (!s) return null;
  // Dẫn đầu bằng số Ả Rập ("12: Tên" → 12)
  const dm = s.match(/^[0-9]+/);
  if (dm) {
    const n = parseInt(dm[0], 10);
    return n > 0 && n <= 100_000 ? n : null;
  }
  const tokens = s.split(/[\s:：,.]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  // Dẫn đầu bằng La Mã ("XII: Bão" → 12)
  const roman = parseRomanNumber(tokens[0]);
  if (roman) return roman;
  // Chữ viết VN: prefix dài nhất hợp lệ cú pháp số
  const words = s.trimEnd().split(/\s+/);
  for (let len = Math.min(words.length, 7); len >= 1; len--) {
    const n = parseVnNumberPhrase(words.slice(0, len).join(' '));
    if (n !== null) return n;
  }
  return null;
}

export interface ChapterHeading {
  /** Số chương đã parse (1...) — null nếu chỉ thấy từ khóa mà không đọc lại số. */
  number: number | null;
  /** Dòng chuẩn hóa (đã trim) dùng làm tiêu đề. */
  rawLine: string;
  /** Vị trí dòng (0-based) trong văn bản đã chuẩn hóa \n. */
  line: number;
}

const HEADING_LINE_MAX = 200;
// Từ khóa khởi đầu tiêu đề chương đủ nhiều ngôn ngữ
const HEAD_KEYWORD_RE = String.raw`(?:chuong|chapter|phan|hoi|chap|ky)`;
const HEAD_LINE_FOLDED_RE = new RegExp(String.raw`^\s*#{0,6}\s*${HEAD_KEYWORD_RE}\b\s*(.*)$`, 'i');
const HEAD_LINE_CN_RE = /^\s*#{0,6}\s*第\s*([0-9零〇一二三四五六七八九十百千万两]+)\s*[章回节话幕]/;

/**
 * Tìm dòng đánh dấu chương trong văn bản. Hỗ trợ:
 * - Tiếng Việt: "Chương 12: ...", "Chương mười hai - ...", "Hồi 3", "Kỳ 2", "Phần 5"
 * - Tiếng Anh: "Chapter 7", "Chapter XII"
 * - Hán tự: "第十二章", "第12章", "第一百零一回"
 * Markdown prefix `#..#` được bỏ qua; dòng phải ngắn (≤200 ký tự — tiêu đề).
 */
export function findChapterHeadings(text: string): ChapterHeading[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const result: ChapterHeading[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0 || line.length > HEADING_LINE_MAX) continue;

    const cnMatch = line.match(HEAD_LINE_CN_RE);
    if (cnMatch) {
      const num = parseCnNumberPhrase(cnMatch[1]);
      if (num !== null && num >= 1) {
        result.push({ number: num, rawLine: line.trim(), line: i });
      }
      continue;
    }

    // So khớp trên bản fold (không dấu) để "Chuong 5" cũng khớp — giữ nguyên
    // dòng gốc làm tiêu đề. Số chương phải đọc được ≥ 1 — dòng "Chương:
    // Lời mở đầu" (không số) bị bỏ qua để không tách chương rác.
    const vMatch = foldLower(line).match(HEAD_LINE_FOLDED_RE);
    if (vMatch) {
      const num = extractChapterNumber(vMatch[1]);
      if (num !== null && num >= 1) {
        result.push({ number: num, rawLine: line.trim(), line: i });
      }
    }
  }
  return result;
}

export interface SplitChapter {
  /** Số chương (null nếu đọc không nổi — đánh lại tuần tự khi ghi file). */
  number: number | null;
  /** Dòng tiêu đề chương sau khi trim. */
  title: string;
  /** Nội dung chương (KHÔNG gồm dòng tiêu đề). */
  content: string;
}

/**
 * Tách một file lớn thành các chương theo heading. Nếu tìm thấy <2 heading
 * → trả [] (caller giữ nguyên file, không tự chia rác).
 * Phần văn bản trước heading đầu tiên (lời tựa/t autoload) được gắn vào
 * chương đầu để không mất chữ.
 */
export function splitChapters(text: string): SplitChapter[] {
  const headings = findChapterHeadings(text);
  if (headings.length < 2) return [];

  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const out: SplitChapter[] = [];

  for (let h = 0; h < headings.length; h++) {
    const startLine = headings[h].line;
    const endLine = h + 1 < headings.length ? headings[h + 1].line : lines.length;
    const body = lines.slice(startLine + 1, endLine).join('\n').trim();
    const preface = h === 0 ? lines.slice(0, startLine).join('\n').trim() : '';

    out.push({
      number: headings[h].number,
      title: headings[h].rawLine,
      content: preface ? (body ? `${preface}\n\n${body}` : preface) : body,
    });
  }
  return out;
}

// ============================================================
// Profile phát hiện bố cục cấp THƯ MỤC
// ============================================================

export interface LayoutProfile {
  kind: 'already_standard' | 'arc_folders' | 'chapters_flat' | 'single_file' | 'mixed_loose' | 'unknown';
  /** 0.3–0.99 — đậm đặc bằng chứng quyết định nốt. */
  confidence: number;
  /** Số file nhìn như chương theo TÊN FILE. */
  chapterLikeFiles: number;
  /** Tổng số dòng đánh dấu chương trong các file có text. */
  headingCount: number;
  /** File lớn có ≥3 heading — candidate "one file = whole novel". */
  singleFileCandidates: { path: string; headingCount: number; words: number }[];
  /** Thư mục con trông như tiểu thuyết riêng (nhiều dự án trong 1 cây). */
  projectCandidates: string[];
  notes: string[];
}

export interface FileInfoInput {
  /** Đường dẫn relative tới root (y hệt vị trí file trong dự án — dùng cả 2 chú ý phân tách fs). */
  rel: string;
  /** Số từ của nội dung (0 nếu binary/không đọc được). */
  words: number;
  /** Nội dung text (chỉ cần phần đầu ~100KB — đủ cho heading). */
  content: string | null;
}

/** Tên file nhìn như chương (tên ngắn: ch1, ch_01, chapter-12, chuong5, phan03...). */
const CHAPTER_FILENAME_RE = /^(?:chapter|chuong|chuon|chap|phan|tap|ch)[\s._-]*(\d+)/i;

// Người tiét viết nhìn như chapter-file mà tên gạch giữa có nhiều tiết mục
const CHAPTER_FILENAME_UNANCHORED_RE = /(?:chapter|chap|chuong|chuon)[\s._-]*(\d{1,4})/i;

const STANDARD_TOP_DIRS = new Set(['.story', '.cbm', 'bible', 'manuscript', 'outline', 'drafts_raw', 'export']);

/**
 * Nhận diện bố cục từ danh sách file đã quét. Không cần đọc đĩa thêm —
 * caller (scan/refactor) đã có nội dung trong tay.
 */
export function detectLayoutProfile(files: FileInfoInput[]): LayoutProfile {
  const profile: LayoutProfile = {
    kind: 'unknown',
    confidence: 0.3,
    chapterLikeFiles: 0,
    headingCount: 0,
    singleFileCandidates: [],
    projectCandidates: [],
    notes: [],
  };
  if (files.length === 0) return profile;

  // Chapter-like theo TÊN FILE (tên ngắn dạng ch1, ch_01, chapter-12...)
  const byName = files.filter(f =>
    CHAPTER_FILENAME_RE.test(foldLower(path.basename(f.rel)))
    || CHAPTER_FILENAME_UNANCHORED_RE.test(foldLower(path.basename(f.rel)))
  );

  // Kiểu chuẩn: manuscript/arc_XX/ch_XXX.md
  const normRel = (r: string): string => r.replace(/\\/g, '/');
  const standardChapterRe = /^manuscript\/arc_\d{2}\/ch_\d{3}(?:[_-][^/]+)?\.md$/i;
  const standardFiles = files.filter(f => standardChapterRe.test(normRel(f.rel)));

  // Heading đếm cho các file lớn (đủ phần đầu)
  let headingCount = 0;
  for (const f of files) {
    if (!f.content) continue;
    const head = f.content.length > 100_000 ? f.content.slice(0, 100_000) : f.content;
    if (f.words > 2000) {
      const hs = findChapterHeadings(head);
      if (hs.length >= 3) {
        profile.singleFileCandidates.push({ path: f.rel, headingCount: hs.length, words: f.words });
      }
      headingCount += hs.length;
    }
  }
  profile.singleFileCandidates.sort((a, b) => b.headingCount - a.headingCount);

  // Chapter-like group theo thư mục
  const dirGroups = new Map<string, number>();
  for (const f of byName) {
    const top = normRel(f.rel).split('/')[0];
    dirGroups.set(top, (dirGroups.get(top) || 0) + 1);
  }
  const multiChapterDirs = [...dirGroups.entries()]
    .filter(([d, c]) => c >= 2 && d !== '.' && !STANDARD_TOP_DIRS.has(d));

  // Thư mục con riêng: mỗi thư mục top-level có ≥2 chương → có thể là tiểu thuyết riêng
  profile.projectCandidates = multiChapterDirs
    .filter(([d]) => !d.includes('/'))
    .map(([d]) => d);

  profile.chapterLikeFiles = byName.length;
  profile.headingCount = headingCount;

  // ─── Quyết định kind theo bằng chứng đậm dần ───
  if (standardFiles.length >= 3) {
    profile.kind = 'already_standard';
    profile.confidence = Math.min(0.99, 0.7 + standardFiles.length * 0.03);
    const loose = files.length - standardFiles.length;
    if (loose > 2) {
      profile.notes.push(`${loose} file ngoài layout chuẩn — refactor có thể sắp phần còn lại (lore/outline/notes).`);
    }
    return profile;
  }

  if (profile.singleFileCandidates.length > 0
    && (profile.chapterLikeFiles < 3
      || profile.singleFileCandidates[0].headingCount >= profile.chapterLikeFiles * 2)) {
    const cand = profile.singleFileCandidates[0];
    profile.kind = 'single_file';
    profile.confidence = Math.min(0.95, 0.5 + cand.headingCount * 0.04);
    profile.notes.push(
      `File "${cand.path}" chứa ${cand.headingCount} đánh dấu chương (${cand.words} từ) — parsed như "one file = whole novel".`,
    );
    return profile;
  }

  if (multiChapterDirs.length >= 1) {
    profile.kind = 'arc_folders';
    profile.confidence = Math.min(0.9, 0.6 + multiChapterDirs.length * 0.05);
    if (profile.projectCandidates.length >= 2) {
      profile.notes.push(
        `Phát hiện ${profile.projectCandidates.length} thư mục con nhìn như tiểu thuyết RIÊNG (mỗi thư mục có nhóm chương riêng): ${profile.projectCandidates.slice(0, 5).join(', ')} — cân nhắc story_set_project từng thư mục.`,
      );
    }
    return profile;
  }

  if (byName.length >= 3) {
    profile.kind = 'chapters_flat';
    profile.confidence = Math.min(0.85, 0.5 + byName.length * 0.03);
    return profile;
  }

  profile.kind = 'mixed_loose';
  profile.confidence = 0.4;
  return profile;
}

/**
 * Gợi ý tên file chương chuẩn cho refactor: ch_XXX.md — số lấy từ tên
 * file nếu parse được (cap 999), nếu không dùng thứ tự sắp tuần tự.
 */
export function proposeChapterFilename(numInName: number | null, seq: number): string {
  const n = numInName && numInName > 0 ? Math.min(numInName, 999) : Math.min(seq, 999);
  return `ch_${String(n).padStart(3, '0')}.md`;
}

/**
 * Map thư mục con → arc_XX: ưu tiên số trong tên (quyển 3 → arc_03,
 * vol 2 → arc_02, phan → arc_XX...); không có số → đánh số tuần tự.
 */
export function subdirToArc(dirname: string, seq: number): string {
  const m = foldLower(dirname).match(/(?:arc|quyen|hoi|phan|tap|part|vol|book)[\s_.-]*0*(\d+)/i);
  const n = m ? parseInt(m[1], 10) : seq;
  return `arc_${String(Math.max(1, Math.min(n, 99))).padStart(2, '0')}`;
}

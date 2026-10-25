// ============================================================
// v0.7.0 — Phân tích bố cục bằng AI ("AI in-the-loop")
// ============================================================
// Heuristic (v0.6.0) là lưới an toàn dựa trên quy tắc cứng; người thật
// bố trí tiểu thuyết quirks hơn nhiều: "I. Mở màn" (không có từ khóa),
// "01.txt", nhật ký theo ngày, truyện thư từ... — AI đọc NGỮ CẢNH tuần
// tra tốt hơn hẳn regex. Server không có LLM, nhưng agent gọi MCP có.
// Nên cơ chế: server gói BẰNG CHỨNG THÔ → agent phân tích → nộp VERDICT
// JSON → server XÁC THỰC nghiêm ngặt và lưu .story/layout-verdict.json
// để refactor/scan ưu tiên dùng. AI chỉ ĐỊA ĐIỂM; mọi thao tác dữ liệu
// vẫn qua dry-run + snapshot như cũ.

import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  walkDir, readTextFile, exists, isBlockedScanPath,
  writeTextFileAtomic, readJsonFile,
} from '../../utils/fileUtils.js';
import { countWords } from '../../utils/wordCount.js';
import {
  detectLayoutProfile,
  findChapterHeadings,
  type FileInfoInput as LayoutFileInfo,
  type LayoutProfile,
} from '../../utils/layoutDetect.js';
import { errResult } from '../../utils/mcpResults.js';
import { StoryProject } from '../../server/StoryProject.js';

// ------------------------------------------------------------
// Verdict schema — ngôn ngữ hợp đồng giữa AI agent và server
// ------------------------------------------------------------

export const VerdictChapterSchema = z.object({
  /** File chứa chương (đường dẫn tương đối, / phân tách). */
  file: z.string().min(1),
  /** Tiêu đề chương (mặc định: chính dòng startLine). */
  title: z.string().optional(),
  /** Số chương, null nếu AI không dám chắc (fallback đánh số tuần tự). */
  number: z.number().int().min(1).max(9999).nullable().optional(),
  /** Dòng tiêu đề chương trong file (1-based — người đọc dòng số 1 là đầu). */
  startLine: z.number().int().min(1),
});

export const VerdictArcSchema = z.object({
  /** Thư mục con (tương đối, 1 tầng) trông như phân tập. */
  fromDir: z.string().min(1),
  /** arc đích: arc_01..arc_99 */
  arc: z.string().regex(/^arc_\d{2}$/, 'arc phải có dạng arc_XX (arc_01..arc_99)'),
});

export const VerdictFileSchema = z.object({
  path: z.string().min(1),
  /**
   * Đích di chuyển (đường dẫn tương đối, bắt đầu bằng manuscript/,
   * bible/, outline/ hoặc drafts_raw/). Bỏ trống = giữ nguyên (skip).
   */
  destination: z.string().optional(),
  reason: z.string().optional(),
});

export const LayoutVerdictSchema = z.object({
  kind: z.enum([
    'already_standard', 'arc_folders', 'chapters_flat',
    'single_file', 'mixed_loose', 'unknown',
  ]),
  confidence: z.number().min(0).max(1),
  /** Giải thích bằng tiếng người — AI phải nêu bằng chứng đọc được. */
  reasoning: z.string().min(3),
  /** (single_file) Ranh giới chương do suy đoán AI. */
  chapters: z.array(VerdictChapterSchema).optional(),
  /** (arc_folders) Map thư mục → arc_XX. */
  arcs: z.array(VerdictArcSchema).optional(),
  /** Định danh mục từng file (move trực tiếp hoặc skip). */
  files: z.array(VerdictFileSchema).optional(),
});
export type LayoutVerdict = z.infer<typeof LayoutVerdictSchema>;

export interface StoredVerdict {
  verdict: LayoutVerdict;
  appliedAt: string;
  /** Heuristic profile lúc áp (để so khớp). */
  heuristicKind: string;
  source: 'agent';
}

const VERDICT_FILE = path.join('.story', 'layout-verdict.json');

export function verdictPath(projectPath: string): string {
  return path.join(projectPath, VERDICT_FILE);
}

/** Nạp verdict đã lưu (null nếu chưa có hoặc hỏng). */
export async function loadLayoutVerdict(projectPath: string): Promise<StoredVerdict | null> {
  try {
    const raw = await readJsonFile<StoredVerdict>(verdictPath(projectPath));
    if (!raw || typeof raw !== 'object' || !raw.verdict) return null;
    // Re-validate schema đề phòng người sửa tay
    const checked = LayoutVerdictSchema.safeParse(raw.verdict);
    if (!checked.success) return null;
    raw.verdict = checked.data;
    return raw;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// Path safety — mọi đường dẫn AI nộp phải nằm trong dự án
// ------------------------------------------------------------

export function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export function isInsideProject(projectPath: string, rel: string): boolean {
  if (path.isAbsolute(rel) || rel.includes('..') || rel.trim().length === 0) return false;
  const resolved = path.resolve(projectPath, rel);
  const root = path.resolve(projectPath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

const DEST_ROOTS = new Set(['manuscript', 'bible', 'outline', 'drafts_raw']);

function isValidDestinationRel(rel: string): boolean {
  const norm = normalizeRel(rel);
  const root = norm.split('/')[0];
  return DEST_ROOTS.has(root) && norm.includes('/');
}

// ------------------------------------------------------------
// Brief — gói bằng chứng thô cho AI phân tích
// ------------------------------------------------------------

const BRIEF_MAX_FILES = 150;
const BRIEF_EXCERPT_LINES = 10;
const BRIEF_EXCERPT_CHARS = 800;

export async function buildLayoutBrief(projectPath: string): Promise<string> {
  const files = (await walkDir(projectPath, ['.md', '.txt', '.doc', '.rtf']))
    .map(f => path.relative(projectPath, f))
    .sort()
    .slice(0, BRIEF_MAX_FILES);

  const inputs: LayoutFileInfo[] = [];
  const excerpts: string[] = [];
  const headingStats: string[] = [];

  for (const rel of files) {
    const full = path.join(projectPath, rel);
    const ext = path.extname(full).toLowerCase();
    let content: string | null = null;
    let words = 0;
    if (ext !== '.doc' && ext !== '.rtf') {
      content = (await readTextFile(full)) || '';
      words = countWords(content);
    }
    inputs.push({ rel, words, content });

    // Trích mẫu: AI cần THẤY ngoài những gì regex khớp
    if (content && content.trim().length > 0) {
      const lines = content.replace(/\r\n?/g, '\n').split('\n').slice(0, BRIEF_EXCERPT_LINES);
      let sample = lines.join('\n');
      if (sample.length > BRIEF_EXCERPT_CHARS) sample = sample.slice(0, BRIEF_EXCERPT_CHARS) + '…';
      excerpts.push(`### ${rel} (${words} từ)\n\`\`\`\n${sample || '(trống)'}\n\`\`\``);
      // Gần-miss regex: những heading heuristic tìm thấy — AI đối chiếu có sót không
      const hs = findChapterHeadings(content);
      if (hs.length > 0) {
        headingStats.push(`${rel}: ${hs.length} heading regex tìm thấy (số: ${hs.slice(0, 5).map(h => h.number ?? '?').join(', ')})`);
      }
    }
  }

  const profile = detectLayoutProfile(inputs);
  const tree = inputs
    .map(f => `${f.rel} (${f.words || (f.content === null ? 'binary/doc' : 0)} từ)`)
    .join('\n');

  return [
    `# LAYOUT BRIEF — ${path.resolve(projectPath)}`,
    `# Mục đích: bạn (AI) phân tích bố cục HIỆN CÓ của dự án tiểu thuyết này, sau đó`,
    `# gọi tool "story_apply_layout_verdict" nộp phán đoán. BELOW là bằng chứng thô.`,
    '',
    '## A. Cây file (tổng ' + inputs.length + ' — cắt bớt nếu vượt ' + BRIEF_MAX_FILES + ')',
    '```',
    tree,
    '```',
    '',
    '## B. Heuristic profile (quy tắc cứng — có thể SAI, bạn hãy soi lại)',
    `- kind: ${profile.kind} (tin cậy ${Math.round(profile.confidence * 100)}%)`,
    `- File nhìn như chương theo tên: ${profile.chapterLikeFiles}`,
    `- Regex heading tìm thấy tổng: ${profile.headingCount}`,
    profile.singleFileCandidates.length > 0
      ? `- File lớn nghi "1 file = cả quyển": ${profile.singleFileCandidates.map(c => `${c.path} (${c.headingCount} heading, ${c.words} từ)`).join('; ')}`
      : '- Không có file lớn nào nghe dấu chương rõ ràng.',
    profile.projectCandidates.length > 0
      ? `- Thư mục nghi là nhiều tiểu thuyết riêng: ${profile.projectCandidates.join(', ')}`
      : '',
    ...profile.notes.map(n => `- ℹ️ ${n}`),
    '',
    '## C. Regex tìm thấy các heading này (kiểm tra có heading regex BỎ SÓT trong phần D)',
    headingStats.length > 0 ? headingStats.map(s => `- ${s}`).join('\n') : '- (không thấy heading nào)',
    '',
    '## D. Trích mẫu nội dung (10 dòng đầu mỗi file có chữ)',
    excerpts.join('\n'),
    '',
    '## E. YÊU CẦU OUTPUT',
    'Phân tích bằng chứng trên bằng NGỮ CẢNH (tiêu đề không cần từ khóa "chương",',
    'tên file tự đặt, nhiều ngôn ngữ, truyện thư từ, nhật ký...), rồi gọi tool',
    '`story_apply_layout_verdict` với JSON gồm: kind (already_standard|arc_folders|',
    'chapters_flat|single_file|mixed_loose|unknown), confidence (0..1), reasoning',
    '(bằng chứng đọc được), và tùy bố cục thêm: chapters [{file,title?,number?,startLine}]',
    '(1-based — nếu một file chứa nhiều chương), arcs [{fromDir, arc}],',
    'files [{path, destination?, reason?}] — destination bắt đầu bằng',
    'manuscript/ | bible/ | outline/ | drafts_raw/',
  ].join('\n');
}

// ------------------------------------------------------------
// Tool registration
// ------------------------------------------------------------

export function registerAiLayoutTools(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_export_layout_brief',
    {
      title: 'Export Layout Brief for AI Analysis',
      description: [
        'Gói bằng chứng thô của dự án (cây file + trích nội dung + heuristic profile)',
        'để BẠN/AI phân tích bố cục bằng ngữ cảnh thay vì quy tắc regex cứng.',
        'Luồng: gọi tool này → bạn đọc brief và suy đoán → gọi story_apply_layout_verdict nộp phán đoán.',
        'Sau đó story_auto_refactor_structure (strategy auto_profile) sẽ dùng phán đoán của bạn.',
      ].join(' '),
      inputSchema: z.object({
        projectPath: z.string().min(1).describe('Đường dẫn dự án'),
      }),
    },
    async (params) => {
      if (isBlockedScanPath(path.resolve(params.projectPath))) {
        return errResult(`🚫 Từ chối phân tích thư mục hệ thống: ${params.projectPath}`);
      }
      if (!await exists(params.projectPath)) {
        return errResult(`❌ Không tìm thấy: ${params.projectPath}`);
      }
      const brief = await buildLayoutBrief(params.projectPath);
      return {
        content: [{
          type: 'text' as const,
          text: brief,
        }],
      };
    },
  );

  server.registerTool(
    'story_apply_layout_verdict',
    {
      title: 'Apply AI Layout Verdict',
      description: [
        'Nộp phán đoán bố cục (verdict JSON) — kết quả đọc story_export_layout_brief bằng AI.',
        'Server XÁC THỰC nghiêm ngặt (đường dẫn phải nằm trong dự án, đích giới hạn trong',
        'manuscript/bible/outline/drafts_raw, dòng chương phải tồn tại) rồi lưu vào',
        '.story/layout-verdict.json. story_auto_refactor_structure (auto_profile) và',
        'story_scan_messy_project sẽ ưu tiên dùng. Xóa file để quay về heuristic.',
      ].join(' '),
      inputSchema: z.object({
        projectPath: z.string().min(1).describe('Đường dẫn dự án'),
        verdict: LayoutVerdictSchema.describe('Phán đoán bố cục của AI'),
      }),
    },
    async (params) => {
      if (isBlockedScanPath(path.resolve(params.projectPath))) {
        return errResult(`🚫 Từ chối thư mục hệ thống: ${params.projectPath}`);
      }
      const projectPath = path.resolve(params.projectPath);
      if (!await exists(projectPath)) {
        return errResult(`❌ Không tìm thấy: ${params.projectPath}`);
      }
      const v = params.verdict;

      const errors: string[] = [];

      // 1) files[] — path phải tồn tại trong dự án; destination hợp lệ
      for (const f of v.files ?? []) {
        const normSrc = normalizeRel(f.path);
        if (normSrc.startsWith('.story/')) {
          errors.push(`- files: không được trỏ vào .story/ (nội bộ dự án): ${f.path}`);
          continue;
        }
        if (!isInsideProject(projectPath, normSrc)) {
          errors.push(`- files: đường dẫn rời khỏi dự án hoặc không hợp lệ: ${f.path}`);
          continue;
        }
        if (!await exists(path.join(projectPath, normalizeRel(f.path)))) {
          errors.push(`- files: file không tồn tại: ${f.path}`);
        }
        if (f.destination && !isValidDestinationRel(f.destination)) {
          errors.push(`- files: destination phải bắt đầu bằng manuscript/ bible/ outline/ drafts_raw/ : ${f.destination}`);
        }
      }

      // 2) chapters[] — file tồn tại, startLine trong phạm vi file
      for (const c of v.chapters ?? []) {
        const rel = normalizeRel(c.file);
        if (rel.startsWith('.story/')) {
          errors.push(`- chapters: không được trỏ vào .story/ (nội bộ dự án): ${c.file}`);
          continue;
        }
        if (!isInsideProject(projectPath, rel)) {
          errors.push(`- chapters: đường dẫn rời khỏi dự án: ${c.file}`);
          continue;
        }
        const full = path.join(projectPath, rel);
        const content = await exists(full) ? (await readTextFile(full)) || '' : null;
        if (content === null) {
          errors.push(`- chapters: file không tồn tại: ${c.file}`);
          continue;
        }
        const lineCount = content.replace(/\r\n?/g, '\n').split('\n').length;
        if (c.startLine > lineCount) {
          errors.push(`- chapters: startLine ${c.startLine} vượt quá số dòng (${lineCount}) của ${c.file}`);
        }
      }

      // 3) arcs[] — fromDir phải là thư mục có thật trong dự án
      for (const a of v.arcs ?? []) {
        const rel = normalizeRel(a.fromDir);
        if (!isInsideProject(projectPath, rel)) {
          errors.push(`- arcs: thư mục rời khỏi dự án: ${a.fromDir}`);
          continue;
        }
        const st = await fs.stat(path.join(projectPath, rel)).catch(() => null);
        if (!st || !st.isDirectory()) {
          errors.push(`- arcs: không phải thư mục có thật: ${a.fromDir}`);
        }
      }

      if (errors.length > 0) {
        return errResult(
          `❌ Verdict bị từ chối — ${errors.length} lỗi xác thực (AI chỉ được phán đoán, không phá dữ liệu):\n${errors.join('\n')}\n\n💡 Xem brief của story_export_layout_brief để lấy đúng tên file/startLine.`,
        );
      }

      // Heuristic hiện tại (để so khớp chéo với phán đoán AI)
      const files0 = await walkDir(projectPath, ['.md', '.txt']);
      const inputs: LayoutFileInfo[] = [];
      for (const rel of files0.map(f => path.relative(projectPath, f)).slice(0, BRIEF_MAX_FILES)) {
        const c = await readTextFile(path.join(projectPath, rel)) || '';
        inputs.push({ rel, words: countWords(c), content: c });
      }
      const heuristic = detectLayoutProfile(inputs);

      const stored: StoredVerdict = {
        verdict: v,
        appliedAt: new Date().toISOString(),
        heuristicKind: heuristic.kind,
        source: 'agent',
      };

      const target = verdictPath(projectPath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await writeTextFileAtomic(target, JSON.stringify(stored, null, 2));

      const disagree = stored.heuristicKind !== v.kind;
      const counts = [
        v.chapters ? `${v.chapters.length} ranh giới chương` : null,
        v.arcs ? `${v.arcs.length} map arc` : null,
        v.files ? `${v.files.length} file định danh mục` : null,
      ].filter(Boolean).join(', ');

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Verdict AI đã lưu: ${target}

🧠 Phán đoán: ${v.kind} (tin cậy ${Math.round(v.confidence * 100)}%)${counts ? ` — gồm ${counts}` : ''}
📌 Lý giải: ${v.reasoning}

⚖️ So khớp heuristic (quy tắc cứng): ${heuristic.kind}${disagree ? ' — LỆCH với AI; hệ thống TIN AI, nhưng preview refactor vẫn hiển thị để bạn kiểm tra trước khi confirm.' : ' — khớp.'}

▶️ Tiếp theo: gọi story_auto_refactor_structure (strategy auto_profile; dry-run trước). Muốn quay về heuristic: xóa file ${VERDICT_FILE}.`,
        }],
      };
    },
  );
}
// (không cần project state hiện tại — tools này thao tác trực tiếp trên đường dẫn)

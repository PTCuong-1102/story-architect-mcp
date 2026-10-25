import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { StoryProject } from '../../server/StoryProject.js';
import { walkDir, readFileBuffer, detectTextEncoding, decodeBuffer, isBlockedScanPath } from '../../utils/fileUtils.js';
import { countWords } from '../../utils/wordCount.js';
import { detectLayoutProfile, type LayoutProfile, type FileInfoInput as LayoutFileInfo } from '../../utils/layoutDetect.js';
import type { FileClassification } from '../../server/types.js';
import { errResult } from '../../utils/mcpResults.js';

function classifyFile(filePath: string, content: string): { category: FileClassification['category']; confidence: number } {
  const basename = path.basename(filePath).toLowerCase();
  const dir = path.dirname(filePath).toLowerCase();
  const words = countWords(content);

  if (dir.includes('manuscript') || dir.includes('chapter') || dir.includes('draft')) {
    return { category: 'manuscript', confidence: 0.85 };
  }
  if (dir.includes('bible') || dir.includes('character') || dir.includes('world') || dir.includes('lore')) {
    return { category: 'lore', confidence: 0.85 };
  }
  if (dir.includes('outline') || dir.includes('plan') || dir.includes('structure')) {
    return { category: 'outline', confidence: 0.85 };
  }
  if (dir.includes('note') || dir.includes('scratch') || dir.includes('idea')) {
    return { category: 'notes', confidence: 0.80 };
  }

  if (/^ch[_\-]?\d+/i.test(basename) || /chapter/i.test(basename)) {
    return { category: 'manuscript', confidence: 0.80 };
  }
  if (/outline|synopsis|summary/i.test(basename)) {
    return { category: 'outline', confidence: 0.80 };
  }
  if (/character|profile|npc|protagonist|antagonist/i.test(basename)) {
    return { category: 'lore', confidence: 0.75 };
  }
  if (/note|idea|brainstorm|todo|scratch/i.test(basename)) {
    return { category: 'notes', confidence: 0.75 };
  }
  if (/world|map|magic|history|lore|setting|location/i.test(basename)) {
    return { category: 'lore', confidence: 0.75 };
  }

  if (words > 1000) {
    const hasDialogue = (content.match(/[""「」『』]/g) || []).length > 5;
    const hasParagraphs = content.split(/\n\n/).length > 5;
    if (hasDialogue && hasParagraphs) {
      return { category: 'manuscript', confidence: 0.65 };
    }
  }

  if (words < 200) {
    return { category: 'notes', confidence: 0.50 };
  }

  if (content.startsWith('---\n')) {
    return { category: 'lore', confidence: 0.60 };
  }

  const headingCount = (content.match(/^#{1,3}\s+/gm) || []).length;
  if (headingCount > 5 && words < 500) {
    return { category: 'outline', confidence: 0.60 };
  }

  return { category: 'unknown', confidence: 0.30 };
}

function simpleSimilarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const nA = normalize(a);
  const nB = normalize(b);

  if (nA === nB) return 1.0;
  if (nA.length === 0 || nB.length === 0) return 0;

  const setA = new Set(nA.split(' '));
  const setB = new Set(nB.split(' '));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  return intersection.size / union.size;
}

function isBinaryBuffer(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  // OLE2 Compound Document Header (Microsoft Word .doc): D0 CF 11 E0 A1 B1 1A E1
  if (buf.length >= 8 &&
      buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0 &&
      buf[4] === 0xa1 && buf[5] === 0xb1 && buf[6] === 0x1a && buf[7] === 0xe1) {
    return true;
  }
  // Kiểm tra null byte trong 1024 bytes đầu
  const checkLen = Math.min(buf.length, 1024);
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export function registerScanMessyProjectTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_scan_messy_project',
    {
      title: 'Scan Messy Novel Project',
      description: 'Quét toàn bộ dự án tiểu thuyết lộn xộn: phát hiện trùng lặp, nhận diện encoding, phân loại file vào 4 nhóm (Manuscript, Notes, Lore, Outline) kèm confidence score.',
      inputSchema: z.object({
        path: z.string().min(1).describe('Đường dẫn đến thư mục dự án cần quét'),
        detectDuplicates: z.boolean().default(true).describe('Phát hiện file trùng lặp/tương đồng'),
      }),
    },
    async (params) => {
      const scanPath = params.path;

      if (isBlockedScanPath(path.resolve(scanPath))) {
        return errResult(`🚫 Từ chối quét thư mục hệ thống: ${scanPath}\n\n💡 Chỉ quét thư mục dự án tiểu thuyết do bạn chỉ định.`);
      }

      try {
        await fs.access(scanPath);
      } catch {
        return errResult(`❌ Không tìm thấy thư mục: ${scanPath}`);
      }

      const files = await walkDir(scanPath, ['.md', '.txt', '.doc', '.rtf']);

      if (files.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `⚠️ Không tìm thấy file văn bản nào trong: ${scanPath}` }],
        };
      }

      const classifications: FileClassification[] = [];
      const fileContents: Map<string, string> = new Map();

      for (const file of files) {
        const buffer = await readFileBuffer(file) || Buffer.alloc(0);
        const isBinary = isBinaryBuffer(buffer);
        const relPath = path.relative(scanPath, file);

        let encoding: string = 'utf-8';
        let content = '';
        let words = 0;

        if (isBinary) {
          encoding = 'binary';
          content = ''; // Không decode nhị phân rác
          words = 0;
        } else {
          const textEncoding = detectTextEncoding(buffer);
          encoding = textEncoding;
          content = decodeBuffer(buffer, textEncoding);
          words = countWords(content);
        }

        const { category, confidence } = classifyFile(file, content);

        if (content) {
          fileContents.set(relPath, content);
        }

        classifications.push({
          path: relPath,
          category,
          confidence: isBinary ? Math.min(confidence, 0.7) : confidence,
          encoding: isBinary ? 'binary' : (encoding === 'ascii' ? 'utf-8' : encoding),
          wordCount: words,
          similarTo: [],
        });
      }

      // So sánh O(n²) nên giới hạn: tối đa 300 file, mỗi file CẮT 50KB đầu
      // cho mục đích similarity (phân loại vẫn dùng toàn bộ nội dung).
      // Tránh treo RAM/CPU khi quét thư mục hàng nghìn file.
      const SIMILARITY_FILE_CAP = 300;
      const SIMILARITY_CHARS = 50_000;
      let similarityCapped = false;
      if (params.detectDuplicates) {
        const allPaths = [...fileContents.keys()];
        const paths = allPaths.slice(0, SIMILARITY_FILE_CAP);
        similarityCapped = allPaths.length > paths.length;
        const snippetOf = (p: string): string => {
          const full = fileContents.get(p) || '';
          return full.length > SIMILARITY_CHARS ? full.slice(0, SIMILARITY_CHARS) : full;
        };
        for (let i = 0; i < paths.length; i++) {
          for (let j = i + 1; j < paths.length; j++) {
            const contentA = snippetOf(paths[i]);
            const contentB = snippetOf(paths[j]);
            if (contentA.length <= 100 || contentB.length <= 100) continue;
            // Early-exit rẻ: chênh lệch độ dài quá lớn thì không thể giống nhau
            const lenA = contentA.length;
            const lenB = contentB.length;
            if (Math.abs(lenA - lenB) / Math.max(lenA, lenB) > 0.5) continue;
            const sim = simpleSimilarity(contentA, contentB);
            if (sim > 0.6) {
              const classA = classifications.find(c => c.path === paths[i]);
              const classB = classifications.find(c => c.path === paths[j]);
              if (classA) classA.similarTo.push(`${paths[j]} (${Math.round(sim * 100)}%)`);
              if (classB) classB.similarTo.push(`${paths[i]} (${Math.round(sim * 100)}%)`);
            }
          }
        }
      }

      const categoryCount = {
        manuscript: classifications.filter(c => c.category === 'manuscript').length,
        notes: classifications.filter(c => c.category === 'notes').length,
        lore: classifications.filter(c => c.category === 'lore').length,
        outline: classifications.filter(c => c.category === 'outline').length,
        unknown: classifications.filter(c => c.category === 'unknown').length,
      };

      const totalWords = classifications.reduce((sum, c) => sum + c.wordCount, 0);
      const duplicatePairs = classifications.filter(c => c.similarTo.length > 0).length;

      // ─── v0.6.0 — Nhận diện bố cục Hiện CÓ (layout profile) ───
      // Người viết trước đây bố trí tiểu thuyết rất đa dạng: chapter phẳng,
      // arc tự đặt tên, một file chứa cả quyển, số chương chữ/Hán tự... Báo
      // cáo bố cục thật để LLM/người dùng quyết định (không ép sửa).
      const layoutInputs: LayoutFileInfo[] = classifications.map(c => ({
        rel: c.path,
        words: c.wordCount,
        content: fileContents.get(c.path) ?? null,
      }));
      const profile = detectLayoutProfile(layoutInputs);
      const KIND_LABELS: Record<LayoutProfile['kind'], string> = {
        already_standard: 'Đã chuẩn (manuscript/arc_XX/ch_XXX.md)',
        arc_folders: 'Thư mục phân tập/arc (tự đặt tên)',
        chapters_flat: 'Chương phẳng (nhiều file chương cạnh nhau)',
        single_file: 'Một file lớn chứa nhiều chương',
        mixed_loose: 'Loại hỗn tạp/rải rác',
        unknown: 'Không nhận diện được',
      };
      const KIND_NEXT: Record<LayoutProfile['kind'], string> = {
        already_standard: 'project đã theo layout chuẩn — chỉ cần story_init (nếu chưa) là dùng được ngay.',
        arc_folders: 'story_auto_refactor_structure với strategy tự nhận diện sẽ map từng thư mục → arc_XX (giữ nội dung nguyên vẹn).',
        chapters_flat: 'story_auto_refactor_structure sẽ đánh số lại ch_XXX vào arc_01.',
        single_file: 'story_auto_refactor_structure với strategy auto_profile sẽ TÁCH theo tiêu đề chương ("Chương N" / "第N章" / "Chapter N") thành ch_001..., file gốc bảo toàn vào drafts_raw/.',
        mixed_loose: 'quét kỹ hơn trước khi refactor; refactor vẫn dry-run được.',
        unknown: 'thêm .md/.txt hoặc review tay trước khi refactor.',
      };
      const layoutSection = [
        `🧭 Nhận diện bố cục (layout profile): ${KIND_LABELS[profile.kind]} (tin cậy ${Math.round(profile.confidence * 100)}%)`,
        `   ├── File nhìn như chương: ${profile.chapterLikeFiles}`,
        `   ├── Đánh dấu chương tìm thấy trong nội dung: ${profile.headingCount}`,
        profile.singleFileCandidates.length > 0
          ? `   ├── File lớn có nhiều chương: ${profile.singleFileCandidates.slice(0, 3).map(c => `${c.path} (${c.headingCount} chương, ${c.words} từ)`).join('; ')}`
          : '',
        profile.projectCandidates.length > 0
          ? `   ├── 🔖 Nghi là NHIỀU tiểu thuyết riêng trong cùng cây: ${profile.projectCandidates.join(', ')} — story_set_project từng thư mục để tách dự án`
          : '',
        ...profile.notes.map(n => `   ├── ℹ️ ${n}`),
        `   └── Gợi ý: ${KIND_NEXT[profile.kind]}`,
      ].filter(Boolean).join('\n');

      const report = classifications.map(c => {
        const simInfo = c.similarTo.length > 0 ? ` ⚠️ Tương tự: ${c.similarTo.join(', ')}` : '';
        return `  ${c.category.padEnd(12)} [${Math.round(c.confidence * 100)}%] ${c.encoding.padEnd(12)} ${c.path} (${c.wordCount} từ)${simInfo}`;
      }).join('\n');

      return {
        content: [{
          type: 'text' as const,
          text: `📊 Kết quả quét dự án: ${scanPath}

📁 Tổng số file: ${files.length}
📝 Tổng số từ: ${totalWords.toLocaleString()}
${duplicatePairs > 0 ? `⚠️ File có nội dung tương đồng: ${duplicatePairs}\n` : ''}${similarityCapped ? `ℹ️ So trùng lặp chỉ chạy trên ${SIMILARITY_FILE_CAP} file đầu (giới hạn hiệu năng).\n` : ''}
📂 Phân loại:
  Manuscript: ${categoryCount.manuscript}
  Notes:      ${categoryCount.notes}
  Lore:       ${categoryCount.lore}
  Outline:    ${categoryCount.outline}
  Unknown:    ${categoryCount.unknown}

${layoutSection}

📋 Chi tiết:
${report}

💡 Tiếp theo: Dùng \`story_auto_refactor_structure\` để tự động sắp xếp lại (với dry-run trước).`,
        }],
      };
    }
  );
}

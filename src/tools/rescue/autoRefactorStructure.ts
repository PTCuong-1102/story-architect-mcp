import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { StoryProject } from '../../server/StoryProject.js';
import { walkDir, readTextFile, exists, isBlockedScanPath, writeTextFileAtomic } from '../../utils/fileUtils.js';
import { countWords } from '../../utils/wordCount.js';
import {
  detectLayoutProfile, findChapterHeadings,
  proposeChapterFilename, subdirToArc,
  type FileInfoInput as LayoutFileInfo,
} from '../../utils/layoutDetect.js';
import type { RefactorAction } from '../../server/types.js';
import { createSnapshot } from './snapshot.js';
import { errResult } from '../../utils/mcpResults.js';

/**
 * Đoán số arc từ tên file hoặc đầu nội dung ("arc 2", "quyển 3", "hồi 1"...).
 * Trả về tên thư mục arc (mặc định arc_01).
 */
function detectArcDir(basename: string, contentHead: string): string {
  const m = (basename + '\n' + contentHead).match(
    /(?:arc|quyển|quyen|hồi|hoi|phần|phan|tập|tap|part)[\s_\-]*0*(\d+)/i
  );
  const n = m ? parseInt(m[1], 10) : 1;
  return `arc_${String(Math.max(1, n)).padStart(2, '0')}`;
}

/**
 * v0.6.0 — Giữ nguyên bản sao thư mục arc tự đặt tên của người viết:
 * map thư mục con top-level → arc_XX bằng số trong tên nếu có (quyển 3 →
 * arc_03, vol 2 → arc_02), thiếu số thì đánh số tuần tự theo thứ tự gặp.
 */
function determineDestinationArcFolders(
  relPath: string,
  content: string,
  arcByDir: Map<string, string>,
): RefactorAction | null {
  const basename = path.basename(relPath);
  const lowerBasename = basename.toLowerCase();
  const words = countWords(content);
  const topDir = relPath.split(/[/\\]/)[0];
  const arcDir = arcByDir.get(topDir);

  if (!arcDir) {
    // File ở thư mục gốc — xếp kiểu by_chapter thông thường
    return determineDestination(relPath, content, 'by_chapter');
  }

  if (/^ch[_\-]?\d+/i.test(lowerBasename) || /chapter|chuong|chương/i.test(lowerBasename) || words > 1000) {
    return {
      type: 'move',
      source: relPath,
      destination: path.join('manuscript', arcDir, basename),
      reason: `Chương trong thư mục "${topDir}" → manuscript/${arcDir}/ (map thư mục → arc, nội dung giữ nguyên)`,
    };
  }
  // Không phải chương → phân loại chủ đề như cũ nhưng KHÔNG nằm trong cây arc
  return null;
}

/**
 * v0.6.0 — Tách một file lớn chứa nhiều chương thành các ch_XXX.md chuẩn.
 * Ưu tiên số chương parse từ tiêu đề (Chương 12 / XII / mười hai / 第12章);
 * trùng/null (v) → đánh lại theo vị trí. Trả về null nếu <2 tiêu đề.
 */
async function splitAndWriteChapters(
  projectPath: string,
  srcRel: string,
): Promise<{ written: string[]; chapterCount: number } | { error: string }> {
  const srcFull = path.join(projectPath, srcRel);
  const content = (await readTextFile(srcFull)) || '';
  const headings = findChapterHeadings(content);
  if (headings.length < 2) {
    return { error: 'Không tìm thấy ≥2 tiêu đề chương ("Chương N" / "Chapter N" / "第N章") — giữ nguyên file.' };
  }

  const arcDir = path.join(projectPath, 'manuscript', 'arc_01');
  await fs.mkdir(arcDir, { recursive: true });

  const normalized = content.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const written: string[] = [];
  const usedNums = new Set<number>();

  for (let h = 0; h < headings.length; h++) {
    const startLine = headings[h].line;
    const endLine = h + 1 < headings.length ? headings[h + 1].line : lines.length;
    const title = headings[h].rawLine.trim();
    let body = lines.slice(startLine + 1, endLine).join('\n').trim();
    const preface = h === 0 ? lines.slice(0, startLine).join('\n').trim() : '';
    if (preface) body = preface ? `${preface}\n\n${body}` : body;

    // Số chương: parse → trùng/hợp lệ không → tuần tự
    let num = headings[h].number;
    if (num === null || usedNums.has(num)) num = h + 1;
    usedNums.add(num);

    const filename = proposeChapterFilename(num, h + 1);
    let destFull = path.join(arcDir, filename);
    if (await exists(destFull)) {
      let n = 2;
      while (await exists(path.join(arcDir, filename.replace('.md', `_${n}.md`)))) n++;
      destFull = path.join(arcDir, filename.replace('.md', `_${n}.md`));
    }
    await writeTextFileAtomic(destFull, `${title}\n\n${body}\n`);
    written.push(path.relative(projectPath, destFull));
  }
  return { written, chapterCount: headings.length };
}

function determineDestination(
  filePath: string,
  content: string,
  strategy: 'by_chapter' | 'by_arc' | 'chronological',
  seq = 0
): RefactorAction {  const basename = path.basename(filePath);
  const lowerBasename = basename.toLowerCase();
  const words = countWords(content);

  let category = 'unknown';
  if (/^ch[_\-]?\d+/i.test(lowerBasename) || /chapter|chương|chuong/i.test(lowerBasename) || words > 1000) {
    category = 'manuscript';
  } else if (/outline|synopsis|summary|dàn.?ý|dany|tóm.?tắt|tomtat/i.test(lowerBasename)) {
    category = 'outline';
  } else if (/character|profile|world|lore|magic|setting|nhân.?vật|nhanvat|thế.?giới|thegioi/i.test(lowerBasename)) {
    category = 'lore';
  } else if (/note|idea|brainstorm|todo|nháp|nhap|ghi.?chú|ghichu/i.test(lowerBasename)) {
    category = 'notes';
  }

  switch (category) {
    case 'manuscript': {
      if (strategy === 'by_arc') {
        const arcDir = detectArcDir(basename, content.slice(0, 2000));
        return {
          type: 'move',
          source: filePath,
          destination: path.join('manuscript', arcDir, basename),
          reason: `File bản thảo → manuscript/${arcDir}/ (nhận diện arc từ tên/nội dung)`,
        };
      }
      if (strategy === 'chronological') {
        // Đánh số theo thứ tự mtime (seq do caller sắp xếp trước)
        const numbered = `ch_${String(seq + 1).padStart(3, '0')}_${basename}`;
        return {
          type: 'move',
          source: filePath,
          destination: path.join('manuscript', 'arc_01', numbered),
          reason: `File bản thảo → manuscript/arc_01/ (đánh số theo thời gian sửa)`,
        };
      }
      return {
        type: 'move',
        source: filePath,
        destination: path.join('manuscript', 'arc_01', basename),
        reason: 'File bản thảo → manuscript/arc_01/',
      };
    }
    case 'outline':
      return {
        type: 'move',
        source: filePath,
        destination: path.join('outline', basename),
        reason: 'File dàn ý → outline/',
      };
    case 'lore': {
      if (/character|profile|npc|protagonist|antagonist/i.test(lowerBasename)) {
        return {
          type: 'move',
          source: filePath,
          destination: path.join('bible', 'characters', basename),
          reason: 'Hồ sơ nhân vật → bible/characters/',
        };
      }
      return {
        type: 'move',
        source: filePath,
        destination: path.join('bible', 'world', basename),
        reason: 'Worldbuilding → bible/world/',
      };
    }
    case 'notes':
      return {
        type: 'move',
        source: filePath,
        destination: path.join('drafts_raw', basename),
        reason: 'Ghi chú/nháp → drafts_raw/',
      };
    default:
      return {
        type: 'skip',
        source: filePath,
        destination: filePath,
        reason: 'Không thể phân loại tự động — giữ nguyên vị trí',
      };
  }
}

export function registerAutoRefactorTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_auto_refactor_structure',
    {
      title: 'Auto Refactor Novel Structure',
      description: 'Phân loại và chuẩn hóa cấu trúc thư mục dự án tiểu thuyết theo layout chuẩn. Hỗ trợ dry-run mode (confirm=false) để preview trước khi thực hiện.',
      inputSchema: z.object({
        projectPath: z.string().min(1).describe('Đường dẫn dự án'),
        strategy: z.enum(['auto_profile', 'by_chapter', 'by_arc', 'chronological']).default('auto_profile')
          .describe(`Chiến lược sắp xếp:
  auto_profile (mặc định, v0.6.0) — nhận diện bố cục hiện có trước: một file lớn chứa nhiều chương → TÁCH theo tiêu đề chương; thư mục phân tập tự đặt tên → map thành arc_XX; chương phẳng → đánh số lại ch_XXX
  by_chapter — mọi file bản thảo → manuscript/arc_01/
  by_arc — đoán arc từ tên file/nội dung ("quyển 3", "part 2"...)
  chronological — đánh số theo thời gian sửa file`),
        confirm: z.boolean().default(false)
          .describe('false = dry-run (chỉ preview), true = thực hiện thực sự (sẽ tự động snapshot trước)'),
      }),
    },
    async (params) => {
      // Chuẩn hóa mặc định (khi call qua MCP, zod đã fill; còn gọi trực tiếp
      // từ test/CLI thì đây là lưới an toàn).
      const strategy = params.strategy ?? 'auto_profile';
      const confirm = params.confirm ?? false;
      const projectPath = params.projectPath;

      if (isBlockedScanPath(path.resolve(projectPath))) {
        return errResult(`🚫 Từ chối tái cấu trúc thư mục hệ thống: ${projectPath}\n\n💡 Chỉ tái cấu trúc thư mục dự án tiểu thuyết do bạn chỉ định.`);
      }

      if (!await exists(projectPath)) {
        return errResult(`❌ Không tìm thấy: ${projectPath}`);
      }

      const standardDirs = ['.story', '.cbm', 'bible', 'manuscript', 'outline', 'drafts_raw', 'export', 'node_modules'];
      const allFiles = await walkDir(projectPath, ['.md', '.txt', '.doc', '.rtf']);

      const unstruturedFiles = allFiles.filter(f => {
        const rel = path.relative(projectPath, f);
        const topDir = rel.split(path.sep)[0];
        return !standardDirs.includes(topDir);
      });

      if (unstruturedFiles.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: '✅ Dự án đã có cấu trúc chuẩn — không cần refactor.',
          }],
        };
      }

      // chronological: sắp theo mtime để đánh số thứ tự đúng
      let orderedFiles = unstruturedFiles;
      if (strategy === 'chronological') {
        const withTime = await Promise.all(unstruturedFiles.map(async (f) => {
          try {
            const st = await fs.stat(f);
            return { f, mtime: st.mtimeMs };
          } catch {
            return { f, mtime: 0 };
          }
        }));
        orderedFiles = withTime.sort((a, b) => a.mtime - b.mtime).map(x => x.f);
      }

      // v0.6.0 — auto_profile: nhận diện bố cục hiện có để chọn hành vi
      let effectiveStrategy: 'by_chapter' | 'by_arc' | 'chronological'
        = strategy === 'auto_profile' ? 'by_arc' : strategy;
      let splitSource: string | null = null;
      let splitHeadingCount = 0;
      let arcByDir = new Map<string, string>();
      let profileNote = '';
      if (strategy === 'auto_profile') {
        const readOnce = async (file: string): Promise<string> => {
          const ext = path.extname(file).toLowerCase();
          if (ext === '.doc' || ext === '.rtf') return '';
          return (await readTextFile(file)) || '';
        };
        const layoutInputs: LayoutFileInfo[] = [];
        for (const file of unstruturedFiles) {
          const content = await readOnce(file);
          layoutInputs.push({
            rel: path.relative(projectPath, file),
            words: countWords(content),
            content,
          });
        }
        const profile = detectLayoutProfile(layoutInputs);
        if (profile.kind === 'single_file' && profile.singleFileCandidates.length > 0) {
          splitSource = profile.singleFileCandidates[0].path;
          splitHeadingCount = profile.singleFileCandidates[0].headingCount;
          profileNote = `Bố cục nhận diện: một file lớn ("${splitSource}", ${splitHeadingCount} chương) → sẽ TÁCH theo tiêu đề chương, bản gốc bảo toàn vào drafts_raw/.`;
        } else if (profile.kind === 'arc_folders') {
          effectiveStrategy = 'by_arc';
          // Map mỗi thư mục top-level có chương → arc_XX (số trong tên nếu có)
          const dirOrder = new Map<string, number>();
          for (const f of layoutInputs) {
            const top = f.rel.split(/[/\\]/)[0];
            if (top.includes('/') || top === '.') continue;
            if (!dirOrder.has(top)) dirOrder.set(top, dirOrder.size + 1);
          }
          for (const [dir, ord] of dirOrder) {
            arcByDir.set(dir, subdirToArc(dir, ord));
          }
          profileNote = `Bố cục nhận diện: thư mục phân tập (${[...dirOrder.keys()].slice(0, 3).join(', ')}) → map thành arc_XX tương ứng, tên file giữ nguyên.`;
        } else if (profile.kind === 'chapters_flat') {
          profileNote = 'Bố cục nhận diện: các chương phẳng → đánh số lại ch_XXX trong manuscript/arc_01/.';
          effectiveStrategy = 'by_chapter';
        } else {
          profileNote = `Bố cục nhận diện: ${profile.kind} — dùng chiến lược mặc định (by_arc).`;
          effectiveStrategy = profile.kind === 'already_standard' ? 'by_arc' : 'by_arc';
        }
      }

      const actions: RefactorAction[] = [];
      let seq = 0;
      for (const file of orderedFiles) {
        const ext = path.extname(file).toLowerCase();
        const relPath = path.relative(projectPath, file);
        if (strategy === 'auto_profile' && splitSource && relPath === splitSource) {
          actions.push({
            type: 'split',
            source: relPath,
            destination: path.join('drafts_raw', path.basename(relPath)),
            reason: `Tách ${splitHeadingCount} chương theo tiêu đề → manuscript/arc_01/ch_XXX.md; bản gốc giữ lại ở drafts_raw/`,
            chapterCount: splitHeadingCount,
          });
          continue;
        }
        const content = (ext === '.doc' || ext === '.rtf') ? '' : (await readTextFile(file) || '');
        let action: RefactorAction;
        if (strategy === 'auto_profile' && effectiveStrategy === 'by_arc' && arcByDir.size > 0) {
          action = determineDestinationArcFolders(relPath, content, arcByDir)
            ?? determineDestination(relPath, content, 'by_chapter', seq);
        } else {
          action = determineDestination(relPath, content, effectiveStrategy, seq);
        }
        actions.push(action);
        if (action.type === 'move') seq++;
      }

      if (!confirm) {
        const preview = actions.map(a => {
          if (a.type === 'skip') {
            return `  ⏭️  SKIP: ${a.source}\n       Lý do: ${a.reason}`;
          }
          if (a.type === 'split') {
            const pad = String(a.chapterCount ?? 0).length;
            return `  ✂️ SPLIT: ${a.source}\n       → manuscript/arc_01/ch_001 ... ch_${'9'.repeat(Math.max(pad, 3)).slice(0, pad) || '000'} (${a.chapterCount} chương, đánh số theo tiêu đề)\n       Bản gốc: → ${a.destination}\n       Lý do: ${a.reason}`;
          }
          return `  📦 ${a.type.toUpperCase()}: ${a.source}\n       → ${a.destination}\n       Lý do: ${a.reason}`;
        }).join('\n\n');

        const moveCount = actions.filter(a => a.type === 'move').length;
        const skipCount = actions.filter(a => a.type === 'skip').length;
        const splitCount = actions.filter(a => a.type === 'split').length;

        return {
          content: [{
            type: 'text' as const,
            text: `🔍 DRY-RUN: Preview tái cấu trúc dự án

📁 Đường dẫn: ${projectPath}
📊 Chiến lược: ${strategy}${profileNote ? `\n🧭 ${profileNote}` : ''}
📋 File cần xử lý: ${unstruturedFiles.length}
  ├── Di chuyển: ${moveCount}
${splitCount > 0 ? `  ├── ✂️ Tách file lớn: ${splitCount}\n` : ''}  └── Bỏ qua: ${skipCount}

${preview}

⚠️ Đây là preview. Để thực hiện, gọi lại với confirm: true.
💡 Hệ thống sẽ tự động tạo snapshot trước khi di chuyển file.`,
          }],
        };
      }

      const dirsToCreate = [
        path.join(projectPath, '.story', 'snapshots'),
        path.join(projectPath, 'bible', 'characters'),
        path.join(projectPath, 'bible', 'world'),
        path.join(projectPath, 'bible', 'subplots'),
        path.join(projectPath, 'manuscript', 'arc_01'),
        path.join(projectPath, 'outline'),
        path.join(projectPath, 'drafts_raw'),
      ];
      for (const dir of dirsToCreate) {
        await fs.mkdir(dir, { recursive: true });
      }

      let movedCount = 0;
      let splitCount = 0;
      const errors: string[] = [];

      // ─── Tự động snapshot trước khi thao tác file (Data Safety) ───
      let snapshotId: string | null = null;
      try {
        const snapshot = await createSnapshot(
          new StoryProject(path.resolve(projectPath)),
          'pre-refactor',
          `Auto-snapshot trước khi tái cấu trúc (chiến lược: ${strategy})`,
          unstruturedFiles.map(f => path.relative(projectPath, f))
        );
        snapshotId = snapshot.id;
      } catch (err) {
        return errResult(`❌ Không thể tạo snapshot an toàn trước khi tái cấu trúc. Đã hủy thao tác để bảo vệ dữ liệu.\n\nLỗi: ${err instanceof Error ? err.message : String(err)}`);
      }

      for (const action of actions) {
        if (action.type === 'skip') continue;

        // ✂️ SPLIT (v0.6.0): viết các ch_XXX.md mới rồi đưa bản gốc vào drafts_raw
        if (action.type === 'split') {
          try {
            const result = await splitAndWriteChapters(projectPath, action.source);
            if ('error' in result) {
              errors.push(`  ❌ ${action.source}: ${result.error}`);
              continue;
            }
            // Đưa bản gốc vào drafts_raw (vẫn dùng hậu tố tăng dần nếu trúng tên trống)
            const srcFull = path.join(projectPath, action.source);
            let archiveFull = path.join(projectPath, action.destination);
            if (await exists(archiveFull)) {
              const ext = path.extname(archiveFull);
              const base = path.basename(archiveFull, ext);
              let n = 2;
              while (await exists(path.join(path.dirname(archiveFull), `${base}_${n}${ext}`))) n++;
              archiveFull = path.join(path.dirname(archiveFull), `${base}_${n}${ext}`);
            }
            try {
              await fs.rename(srcFull, archiveFull);
            } catch (err) {
              if ((err as NodeJS.ErrnoException)?.code === 'EXDEV') {
                await fs.copyFile(srcFull, archiveFull);
                await fs.unlink(srcFull);
              } else {
                throw err;
              }
            }
            splitCount++;
          } catch (err) {
            errors.push(`  ❌ ${action.source}: ${err instanceof Error ? err.message : String(err)}`);
          }
          continue;
        }

        const srcFull = path.join(projectPath, action.source);
        let destFull = path.join(projectPath, action.destination);

        try {
          await fs.mkdir(path.dirname(destFull), { recursive: true });

          // Tránh ghi đè khi trùng tên (kể cả khác hoa/thường trên FS
          // case-insensitive — exists() đã bắt đúng vì FS tự resolve).
          if (await exists(destFull)) {
            const ext = path.extname(destFull);
            const base = path.basename(destFull, ext);
            const dir = path.dirname(destFull);
            let n = 2;
            let candidate = path.join(dir, `${base}_${n}${ext}`);
            while (await exists(candidate)) {
              n++;
              candidate = path.join(dir, `${base}_${n}${ext}`);
            }
            destFull = candidate;
          }

          // rename gãy với EXDEV khi khác mount/device → fallback copy+unlink
          try {
            await fs.rename(srcFull, destFull);
          } catch (err) {
            if ((err as NodeJS.ErrnoException)?.code === 'EXDEV') {
              await fs.copyFile(srcFull, destFull);
              await fs.unlink(srcFull);
            } else {
              throw err;
            }
          }
          movedCount++;
        } catch (err) {
          errors.push(`  ❌ ${action.source}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Tái cấu trúc hoàn tất!

📊 Kết quả:
  ├── Di chuyển thành công: ${movedCount}
${splitCount > 0 ? `  ├── ✂️ Tách file lớn (chương mới viết): ${splitCount}\n` : ''}  ├── Bỏ qua: ${actions.filter(a => a.type === 'skip').length}
  └── Lỗi: ${errors.length}
${snapshotId ? `\n📸 Snapshot an toàn đã tạo trước khi refactor: ${snapshotId}
   Để khôi phục: story_rollback({ snapshotId: "${snapshotId}" })` : ''}

${errors.length > 0 ? '❌ Lỗi:\n' + errors.join('\n') : ''}

💡 Tiếp theo: Chạy \`story_init\` để khởi tạo metadata nếu chưa có.`,
        }],
      };
    }
  );
}

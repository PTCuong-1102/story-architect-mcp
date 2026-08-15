import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { StoryProject } from '../../server/StoryProject.js';
import { walkDir, readTextFile, exists } from '../../utils/fileUtils.js';
import { countWords } from '../../utils/wordCount.js';
import type { RefactorAction } from '../../server/types.js';
import { createSnapshot } from './snapshot.js';

function determineDestination(
  filePath: string,
  content: string,
  strategy: 'by_chapter' | 'by_arc' | 'chronological'
): RefactorAction {
  const basename = path.basename(filePath);
  const lowerBasename = basename.toLowerCase();
  const words = countWords(content);

  let category = 'unknown';
  if (/^ch[_\-]?\d+/i.test(lowerBasename) || /chapter/i.test(lowerBasename) || words > 1000) {
    category = 'manuscript';
  } else if (/outline|synopsis|summary/i.test(lowerBasename)) {
    category = 'outline';
  } else if (/character|profile|world|lore|magic|setting/i.test(lowerBasename)) {
    category = 'lore';
  } else if (/note|idea|brainstorm|todo/i.test(lowerBasename)) {
    category = 'notes';
  }

  switch (category) {
    case 'manuscript':
      return {
        type: 'move',
        source: filePath,
        destination: path.join('manuscript', 'arc_01', basename),
        reason: 'File bản thảo → manuscript/arc_01/',
      };
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
        projectPath: z.string().describe('Đường dẫn dự án'),
        strategy: z.enum(['by_chapter', 'by_arc', 'chronological']).default('by_chapter')
          .describe('Chiến lược sắp xếp'),
        confirm: z.boolean().default(false)
          .describe('false = dry-run (chỉ preview), true = thực hiện thực sự (sẽ tự động snapshot trước)'),
      }),
    },
    async (params) => {
      const projectPath = params.projectPath;

      if (!await exists(projectPath)) {
        return {
          content: [{ type: 'text' as const, text: `❌ Không tìm thấy: ${projectPath}` }],
        };
      }

      const standardDirs = ['.story', '.cbm', 'bible', 'manuscript', 'outline', 'drafts_raw', 'export', 'node_modules'];
      const allFiles = await walkDir(projectPath, ['.md', '.txt']);

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

      const actions: RefactorAction[] = [];
      for (const file of unstruturedFiles) {
        const content = await readTextFile(file) || '';
        const relPath = path.relative(projectPath, file);
        const action = determineDestination(relPath, content, params.strategy);
        actions.push(action);
      }

      if (!params.confirm) {
        const preview = actions.map(a => {
          if (a.type === 'skip') {
            return `  ⏭️  SKIP: ${a.source}\n       Lý do: ${a.reason}`;
          }
          return `  📦 ${a.type.toUpperCase()}: ${a.source}\n       → ${a.destination}\n       Lý do: ${a.reason}`;
        }).join('\n\n');

        const moveCount = actions.filter(a => a.type === 'move').length;
        const skipCount = actions.filter(a => a.type === 'skip').length;

        return {
          content: [{
            type: 'text' as const,
            text: `🔍 DRY-RUN: Preview tái cấu trúc dự án

📁 Đường dẫn: ${projectPath}
📊 Chiến lược: ${params.strategy}
📋 File cần xử lý: ${unstruturedFiles.length}
  ├── Di chuyển: ${moveCount}
  └── Bỏ qua: ${skipCount}

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
      const errors: string[] = [];

      // ─── Tự động snapshot trước khi thao tác file (Data Safety) ───
      let snapshotId: string | null = null;
      try {
        const snapshot = await createSnapshot(
          new StoryProject(path.resolve(projectPath)),
          'pre-refactor',
          `Auto-snapshot trước khi tái cấu trúc (chiến lược: ${params.strategy})`
        );
        snapshotId = snapshot.id;
      } catch (err) {
        errors.push(`  ⚠️ Không thể tạo snapshot an toàn: ${err instanceof Error ? err.message : String(err)}`);
      }

      for (const action of actions) {
        if (action.type === 'skip') continue;

        const srcFull = path.join(projectPath, action.source);
        const destFull = path.join(projectPath, action.destination);

        try {
          await fs.mkdir(path.dirname(destFull), { recursive: true });

          if (await exists(destFull)) {
            const ext = path.extname(destFull);
            const base = path.basename(destFull, ext);
            const dir = path.dirname(destFull);
            const newDest = path.join(dir, `${base}_${Date.now()}${ext}`);
            await fs.rename(srcFull, newDest);
          } else {
            await fs.rename(srcFull, destFull);
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
  ├── Bỏ qua: ${actions.filter(a => a.type === 'skip').length}
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

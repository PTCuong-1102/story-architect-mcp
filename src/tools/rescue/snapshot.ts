import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { StoryProject } from '../../server/StoryProject.js';
import { exists, copyDir, generateId, readJsonFile, writeJsonFile } from '../../utils/fileUtils.js';
import type { SnapshotsIndex, Snapshot } from '../../server/types.js';
import { errResult } from '../../utils/mcpResults.js';

/**
 * Tạo snapshot dùng chung cho dự án (được story_snapshot và các tool
 * destructive khác — ví dụ story_auto_refactor_structure — sử dụng).
 * Sao lưu metadata .story/, manuscript/ và bible/ vào .story/snapshots/{id}/.
 */
export async function createSnapshot(
  project: StoryProject,
  label: string,
  description = ''
): Promise<Snapshot & { snapshotDir: string }> {
  const snapshotsDir = project.getSnapshotsDir();
  await fs.mkdir(snapshotsDir, { recursive: true });

  const snapshotId = generateId();
  const snapshotDir = path.join(snapshotsDir, snapshotId);

  const storyDir = project.storyDir;
  await fs.mkdir(path.join(snapshotDir, '.story'), { recursive: true });

  const metaFiles = ['config.json', 'status.json', 'timeline.json',
    'unresolved_holes.json', 'foreshadowing.json', 'relationships.json', 'style_guide.json'];

  let fileCount = 0;
  for (const file of metaFiles) {
    const src = path.join(storyDir, file);
    if (await exists(src)) {
      await fs.copyFile(src, path.join(snapshotDir, '.story', file));
      fileCount++;
    }
  }

  if (await exists(project.manuscriptDir)) {
    await copyDir(project.manuscriptDir, path.join(snapshotDir, 'manuscript'));
    const countFiles = async (dir: string): Promise<number> => {
      let count = 0;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) count++;
        else if (entry.isDirectory()) count += await countFiles(path.join(dir, entry.name));
      }
      return count;
    };
    fileCount += await countFiles(project.manuscriptDir);
  }

  if (await exists(project.bibleDir)) {
    await copyDir(project.bibleDir, path.join(snapshotDir, 'bible'));
  }

  if (await exists(project.outlineDir)) {
    await copyDir(project.outlineDir, path.join(snapshotDir, 'outline'));
  }

  if (await exists(project.draftsRawDir)) {
    await copyDir(project.draftsRawDir, path.join(snapshotDir, 'drafts_raw'));
  }

  const indexPath = path.join(snapshotsDir, 'index.json');
  const index: SnapshotsIndex = await readJsonFile<SnapshotsIndex>(indexPath) || { snapshots: [] };

  const snapshot: Snapshot = {
    id: snapshotId,
    label,
    createdAt: new Date().toISOString(),
    fileCount,
    description,
  };

  index.snapshots.push(snapshot);
  await writeJsonFile(indexPath, index);

  return { ...snapshot, snapshotDir };
}

export function registerSnapshotTools(server: McpServer, getProject: () => StoryProject): void {

  // ─── story_snapshot ───
  server.registerTool(
    'story_snapshot',
    {
      title: 'Create Snapshot',
      description: 'Lưu snapshot trạng thái dự án hiện tại vào .story/snapshots/ để có thể rollback khi cần.',
      inputSchema: z.object({
        label: z.string().default('manual').describe('Nhãn cho snapshot (ví dụ: "before-refactor")'),
        description: z.string().optional().describe('Mô tả lý do tạo snapshot'),
      }),
    },
    async (params) => {
      const project = getProject();

      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.');
      }

      const snapshot = await createSnapshot(project, params.label, params.description || '');

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Snapshot đã được tạo!

📸 ID: ${snapshot.id}
🏷️  Nhãn: ${params.label}
📁 Số file: ${snapshot.fileCount}
📅 Thời gian: ${snapshot.createdAt}
📂 Vị trí: ${snapshot.snapshotDir}

💡 Để khôi phục: dùng \`story_rollback\` với id = "${snapshot.id}"`,
        }],
      };
    }
  );

  // ─── story_rollback ───
  server.registerTool(
    'story_rollback',
    {
      title: 'Rollback Snapshot',
      description: 'Khôi phục dự án về snapshot trước đó từ .story/snapshots/.',
      inputSchema: z.object({
        snapshotId: z.string().optional().describe('ID snapshot cần rollback (bỏ qua để dùng snapshot mới nhất)'),
        confirm: z.boolean().default(false).describe('false = preview, true = thực hiện rollback'),
      }),
    },
    async (params) => {
      const project = getProject();
      const snapshotsDir = project.getSnapshotsDir();
      const indexPath = path.join(snapshotsDir, 'index.json');

      const index: SnapshotsIndex | null = await readJsonFile<SnapshotsIndex>(indexPath);
      if (!index || index.snapshots.length === 0) {
        return errResult('❌ Không có snapshot nào. Hãy tạo snapshot trước bằng `story_snapshot`.');
      }

      let targetSnapshot: Snapshot | undefined;
      if (params.snapshotId) {
        targetSnapshot = index.snapshots.find(s => s.id === params.snapshotId);
      } else {
        targetSnapshot = index.snapshots[index.snapshots.length - 1];
      }

      if (!targetSnapshot) {
        const available = index.snapshots.map(s => `  - ${s.id} (${s.label}, ${s.createdAt})`).join('\n');
        return errResult(`❌ Không tìm thấy snapshot: ${params.snapshotId}\n\n📋 Snapshots có sẵn:\n${available}`);
      }

      const snapshotDir = path.join(snapshotsDir, targetSnapshot.id);

      if (!await exists(snapshotDir)) {
        return errResult(`❌ Thư mục snapshot không tồn tại: ${snapshotDir}`);
      }

      if (!params.confirm) {
        return {
          content: [{
            type: 'text' as const,
            text: `🔍 Preview Rollback

📸 Snapshot: ${targetSnapshot.id}
🏷️  Nhãn: ${targetSnapshot.label}
📅 Tạo lúc: ${targetSnapshot.createdAt}
📁 Số file: ${targetSnapshot.fileCount}
📝 Mô tả: ${targetSnapshot.description || 'N/A'}

⚠️ Rollback sẽ:
1. Tạo snapshot backup của trạng thái hiện tại (phòng trường hợp hối hận)
2. Ghi đè metadata .story/ bằng snapshot
3. Ghi đè manuscript/ bằng snapshot
4. Ghi đè bible/ bằng snapshot
5. Ghi đè outline/ bằng snapshot
6. Ghi đè drafts_raw/ bằng snapshot

Để thực hiện, gọi lại với confirm: true.`,
          }],
        };
      }

      // ─── Bước 1: Backup trạng thái hiện tại trước khi ghi đè (Data Safety) ───
      let backupId: string | null = null;
      try {
        const backup = await createSnapshot(project, 'pre-rollback', `Backup tự động trước khi rollback về ${targetSnapshot.id}`);
        backupId = backup.id;
      } catch (err) {
        return errResult(`❌ Không thể tạo snapshot backup trước khi rollback. Đã hủy thao tác để bảo vệ dữ liệu.\n\nLỗi: ${err instanceof Error ? err.message : String(err)}`);
      }

      const snapshotStoryDir = path.join(snapshotDir, '.story');
      if (await exists(snapshotStoryDir)) {
        const files = await fs.readdir(snapshotStoryDir);
        for (const file of files) {
          await fs.copyFile(
            path.join(snapshotStoryDir, file),
            path.join(project.storyDir, file)
          );
        }
      }

      const restoreDir = async (srcDir: string, destDir: string): Promise<void> => {
        if (!await exists(srcDir)) return;
        if (await exists(destDir)) {
          await fs.rm(destDir, { recursive: true });
        }
        await copyDir(srcDir, destDir);
      };

      await restoreDir(path.join(snapshotDir, 'manuscript'), project.manuscriptDir);
      await restoreDir(path.join(snapshotDir, 'bible'), project.bibleDir);
      await restoreDir(path.join(snapshotDir, 'outline'), project.outlineDir);
      await restoreDir(path.join(snapshotDir, 'drafts_raw'), project.draftsRawDir);

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Rollback hoàn tất!

📸 Đã khôi phục về snapshot: ${targetSnapshot.id} (${targetSnapshot.label})
📅 Snapshot tạo lúc: ${targetSnapshot.createdAt}
🔐 Backup của trạng thái trước rollback: ${backupId}
   (nếu muốn hoàn tác rollback, dùng story_rollback với id "${backupId}")

⚠️ Các thay đổi sau snapshot đã bị ghi đè.`,
        }],
      };
    }
  );
}

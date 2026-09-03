import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { StoryProject } from '../../server/StoryProject.js';
import { exists, copyDir, generateId, readJsonFile, writeJsonFile } from '../../utils/fileUtils.js';
import type { SnapshotsIndex, Snapshot } from '../../server/types.js';
import { errResult, requireProject, isToolError } from '../../utils/mcpResults.js';
import { invalidateIndex } from '../../utils/knowledgeGraph.js';

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

  // Đủ 8 file init tạo ra (trước đây thiếu character_states.json và
  // emotions_cache.json nên rollback làm mất trạng thái nhân vật).
  const metaFiles = ['config.json', 'status.json', 'timeline.json',
    'unresolved_holes.json', 'foreshadowing.json', 'relationships.json',
    'character_states.json', 'style_guide.json', 'emotions_cache.json'];

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

/** Liệt kê mọi file (đường dẫn tương đối) dưới một thư mục, sort ổn định. */
async function listRelativeFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (cur: string, rel: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(cur, e.name), relPath);
      else if (e.isFile()) out.push(relPath);
    }
  };
  await walk(dir, '');
  return out.sort();
}

/** Tóm tắt danh sách xóa: "N file" + tối đa vài tên đầu. */
function summarizeDeletions(files: string[], maxShow = 8): string {
  if (files.length === 0) return 'không có';
  const shown = files.slice(0, maxShow).map(f => `      - ${f}`).join('\n');
  const more = files.length > maxShow ? `\n      … và ${files.length - maxShow} file nữa` : '';
  return `${files.length} file\n${shown}${more}`;
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
      const project = requireProject(getProject);
      if (isToolError(project)) return project;

      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.');
      }

      const snapshot = await createSnapshot(project, params.label, params.description || '');

      // Cảnh báo phình đĩa: full-copy mỗi snapshot, auto-snapshot mặc định bật
      let retentionNote = '';
      try {
        const entries = await fs.readdir(project.getSnapshotsDir(), { withFileTypes: true });
        const count = entries.filter(e => e.isDirectory()).length;
        if (count >= 20) {
          retentionNote = `\n\n⚠️ Đã có ${count} snapshots — hãy dọn bớt snapshot cũ trong .story/snapshots/ để tránh phình đĩa (mỗi snapshot là full-copy).`;
        }
      } catch {
        // không đọc được thư mục snapshots thì bỏ qua cảnh báo
      }

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Snapshot đã được tạo!

📸 ID: ${snapshot.id}
🏷️  Nhãn: ${params.label}
📁 Số file: ${snapshot.fileCount}
📅 Thời gian: ${snapshot.createdAt}
📂 Vị trí: ${snapshot.snapshotDir}

💡 Để khôi phục: dùng \`story_rollback\` với id = "${snapshot.id}"${retentionNote}`,
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
      const project = requireProject(getProject);
      if (isToolError(project)) return project;
      // snapshotId đi thẳng vào path.join — validate định dạng trước để
      // index.json bị sửa tay (id="../../evil") không thoát ra ngoài.
      if (params.snapshotId && !/^[A-Za-z0-9_-]+$/.test(params.snapshotId)) {
        return errResult('❌ snapshotId không hợp lệ (chỉ cho phép chữ, số, gạch ngang, gạch dưới).');
      }
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
      // Kể cả id từ index.json cũng phải sạch (file này user sửa tay được)
      if (targetSnapshot && !/^[A-Za-z0-9_-]+$/.test(targetSnapshot.id)) {
        return errResult(`❌ Snapshot "${targetSnapshot.id}" có id không hợp lệ — từ chối rollback để bảo vệ dữ liệu.`);
      }

      if (!targetSnapshot) {
        const available = index.snapshots.map(s => `  - ${s.id} (${s.label}, ${s.createdAt})`).join('\n');
        return errResult(`❌ Không tìm thấy snapshot: ${params.snapshotId}\n\n📋 Snapshots có sẵn:\n${available}`);
      }

      const snapshotDir = path.join(snapshotsDir, targetSnapshot.id);

      if (!await exists(snapshotDir)) {
        return errResult(`❌ Thư mục snapshot không tồn tại: ${snapshotDir}`);
      }

      // Tính trước các file sẽ BIẾN MẤT (có ở hiện tại, không có trong
      // snapshot) để preview cảnh báo rõ ràng thay vì xóa câm.
      const contentDirs: [string, string][] = [
        ['manuscript', project.manuscriptDir],
        ['bible', project.bibleDir],
        ['outline', project.outlineDir],
        ['drafts_raw', project.draftsRawDir],
      ];
      const deletions: string[] = [];
      for (const [label, destDir] of contentDirs) {
        const snapFiles = new Set(await listRelativeFiles(path.join(snapshotDir, label)));
        const curFiles = await listRelativeFiles(destDir);
        for (const f of curFiles) {
          if (!snapFiles.has(f)) deletions.push(`${label}/${f}`);
        }
      }
      // .story/: chỉ xét file top-level, không bao giờ đụng tới snapshots/
      const snapStoryFiles = new Set(await listRelativeFiles(path.join(snapshotDir, '.story')));
      let curStoryNames: string[] = [];
      try {
        const entries = await fs.readdir(project.storyDir, { withFileTypes: true });
        curStoryNames = entries.filter(e => e.isFile()).map(e => e.name);
      } catch {
        curStoryNames = [];
      }
      const storyDeletions = curStoryNames.filter(name => !snapStoryFiles.has(name));

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

🗑️ File sẽ BỊ XÓA vì không có trong snapshot (tạo sau thời điểm snapshot):
${deletions.length > 0 ? summarizeDeletions(deletions) : 'không có'}
🗑️ File .story/ sẽ bị xóa:
${storyDeletions.length > 0 ? storyDeletions.map(f => `      - ${f}`).join('\n') : 'không có'}

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
        // Xóa file .story/ top-level không có trong snapshot (đã liệt kê ở
        // preview). Không bao giờ đụng tới thư mục snapshots/.
        for (const name of storyDeletions) {
          try {
            await fs.rm(path.join(project.storyDir, name), { force: true });
          } catch {
            // bỏ qua file không xóa được, tiếp tục copy phần còn lại
          }
        }
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
      // Mọi thứ có thể đã đổi → graph cache cũ
      await invalidateIndex(project);

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

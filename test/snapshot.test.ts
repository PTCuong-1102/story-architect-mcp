import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { StoryProject } from '../src/server/StoryProject.js';
import { createSnapshot, registerSnapshotTools } from '../src/tools/rescue/snapshot.js';
import { readJsonFile } from '../src/utils/fileUtils.js';

const TMP = '/tmp/opencode/unit-snapshot';

type ToolResult = { content: { type: string; text: string }[] };

/** Fake McpServer: chỉ capture handler để gọi trực tiếp trong test. */
function makeFakeServer(): { server: McpServer; handlers: Map<string, (params: never) => Promise<ToolResult>> } {
  const handlers = new Map<string, (params: never) => Promise<ToolResult>>();
  const fake = {
    registerTool: (name: string, _config: unknown, handler: (params: never) => Promise<ToolResult>) => {
      handlers.set(name, handler);
    },
  };
  return { server: fake as unknown as McpServer, handlers };
}

async function freshProject(name = 'Snapshot Novel'): Promise<StoryProject> {
  const dir = path.join(TMP, `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const p = new StoryProject(dir);
  await p.initializeProject({ name, targetWordCount: 1000 });
  return p;
}

async function seedManuscript(p: StoryProject): Promise<string> {
  const chapterPath = path.join(p.manuscriptDir, 'arc_01', 'ch_001.md');
  const original = 'Nội dung gốc của chương một.';
  await fs.writeFile(chapterPath, original, 'utf-8');
  return original;
}

test('createSnapshot: sao chép metadata, manuscript, bible và cập nhật index.json', async () => {
  const p = await freshProject();
  await seedManuscript(p);
  await fs.writeFile(path.join(p.bibleDir, 'characters', 'hero.md'), '# Hero\n', 'utf-8');

  const snap = await createSnapshot(p, 'before-edit', 'kiểm thử');

  // Trả về đúng metadata
  assert.ok(snap.id.length > 0);
  assert.equal(snap.label, 'before-edit');
  assert.equal(snap.description, 'kiểm thử');
  // 7 file meta (.story) + 1 chương manuscript
  assert.equal(snap.fileCount, 8);

  // File đã được sao chép vào thư mục snapshot
  const snapDir = snap.snapshotDir;
  await fs.access(path.join(snapDir, '.story', 'config.json'));
  await fs.access(path.join(snapDir, '.story', 'foreshadowing.json'));
  await fs.access(path.join(snapDir, 'manuscript', 'arc_01', 'ch_001.md'));
  await fs.access(path.join(snapDir, 'bible', 'characters', 'hero.md'));

  // index.json ghi nhận entry mới
  const index = await readJsonFile<{ snapshots: { id: string; label: string }[] }>(
    path.join(p.getSnapshotsDir(), 'index.json')
  );
  assert.ok(index);
  assert.equal(index!.snapshots.length, 1);
  assert.equal(index!.snapshots[0].id, snap.id);
});

test('createSnapshot: hai lần tạo liên tiếp có 2 entry trong index', async () => {
  const p = await freshProject();
  await createSnapshot(p, 's1');
  await createSnapshot(p, 's2');
  const index = await readJsonFile<{ snapshots: { label: string }[] }>(
    path.join(p.getSnapshotsDir(), 'index.json')
  );
  assert.deepEqual(index!.snapshots.map(s => s.label), ['s1', 's2']);
});

test('story_snapshot: từ chối khi dự án chưa khởi tạo', async () => {
  const dir = path.join(TMP, `not-init-${Date.now()}`);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const p = new StoryProject(dir);

  const { server, handlers } = makeFakeServer();
  registerSnapshotTools(server, () => p);

  const result = await handlers.get('story_snapshot')!({ label: 'x' } as never);
  assert.match(result.content[0].text, /chưa được khởi tạo/);
});

test('story_rollback: preview (confirm=false) không thay đổi dữ liệu', async () => {
  const p = await freshProject();
  const original = await seedManuscript(p);
  const snap = await createSnapshot(p, 'snap-1');

  const modified = 'Nội dung đã bị sửa sau snapshot.';
  await fs.writeFile(path.join(p.manuscriptDir, 'arc_01', 'ch_001.md'), modified, 'utf-8');

  const { server, handlers } = makeFakeServer();
  registerSnapshotTools(server, () => p);

  const result = await handlers.get('story_rollback')!({ snapshotId: snap.id, confirm: false } as never);
  assert.match(result.content[0].text, /Preview Rollback/);

  // Dữ liệu vẫn nguyên trạng thái đã sửa
  const current = await fs.readFile(path.join(p.manuscriptDir, 'arc_01', 'ch_001.md'), 'utf-8');
  assert.equal(current, modified);
  assert.notEqual(current, original);
});

test('story_rollback: confirm=true khôi phục dữ liệu và tự tạo backup pre-rollback', async () => {
  const p = await freshProject();
  const original = await seedManuscript(p);
  const snap = await createSnapshot(p, 'good-state');

  await fs.writeFile(path.join(p.manuscriptDir, 'arc_01', 'ch_001.md'), 'Bản hỏng.', 'utf-8');
  await fs.writeFile(path.join(p.bibleDir, 'characters', 'new_char.md'), '# Mới\n', 'utf-8');

  const { server, handlers } = makeFakeServer();
  registerSnapshotTools(server, () => p);

  const result = await handlers.get('story_rollback')!({ snapshotId: snap.id, confirm: true } as never);
  assert.match(result.content[0].text, /Rollback hoàn tất/);

  // Manuscript được khôi phục về bản snapshot
  const restored = await fs.readFile(path.join(p.manuscriptDir, 'arc_01', 'ch_001.md'), 'utf-8');
  assert.equal(restored, original);

  // File mới tạo sau snapshot bị xóa bỏ (ghi đè bằng snapshot)
  await assert.rejects(
    fs.access(path.join(p.bibleDir, 'characters', 'new_char.md'))
  );

  // Tự động tạo backup pre-rollback trong index
  const index = await readJsonFile<{ snapshots: { label: string }[] }>(
    path.join(p.getSnapshotsDir(), 'index.json')
  );
  assert.deepEqual(index!.snapshots.map(s => s.label), ['good-state', 'pre-rollback']);
  assert.match(result.content[0].text, /pre-rollback|Backup/);
});

test('story_rollback: không có snapshot nào → báo lỗi hướng dẫn', async () => {
  const p = await freshProject();
  const { server, handlers } = makeFakeServer();
  registerSnapshotTools(server, () => p);

  const result = await handlers.get('story_rollback')!({ confirm: true } as never);
  assert.match(result.content[0].text, /Không có snapshot nào/);
});

test('story_rollback: id không tồn tại → liệt kê snapshot khả dụng', async () => {
  const p = await freshProject();
  const snap = await createSnapshot(p, 'only-one');

  const { server, handlers } = makeFakeServer();
  registerSnapshotTools(server, () => p);

  const result = await handlers.get('story_rollback')!({ snapshotId: 'khong-ton-tai', confirm: true } as never);
  assert.match(result.content[0].text, /Không tìm thấy snapshot: khong-ton-tai/);
  assert.match(result.content[0].text, new RegExp(snap.id));
});

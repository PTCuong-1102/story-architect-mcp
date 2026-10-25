import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { StoryProject } from '../src/server/StoryProject.js';
import { loadOrBuildIndex } from '../src/utils/knowledgeGraph.js';
import { McpServer } from '@modelcontextprotocol/server';
import { registerMapRelationshipsTool } from '../src/tools/graph/mapRelationships.js';

function makeHandler(project: StoryProject): (params: never) => Promise<{ isError?: boolean; content: { text: string }[] }> {
  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  registerMapRelationshipsTool(server, () => project);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (p: never) => Promise<unknown> }> })._registeredTools
    || (server as unknown as { tools: Record<string, { handler: (p: never) => Promise<unknown> }> }).tools;
  return tools['story_map_relationships'].handler as never;
}

test('loadOrBuildIndex: tự stale khi bible bị sửa từ ngoài (v0.4.0)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'story-idx-stale-'));
  const project = new StoryProject(tmpDir);
  await project.initializeProject({ name: 'Kiểm Tra Index Stale' });

  // 1 nhân vật ban đầu
  const charDir = path.join(tmpDir, 'bible', 'characters');
  await fs.writeFile(path.join(charDir, 'tieu_viem.md'), '---\nname: Tiêu Viêm\n---\n\nHồ sơ khởi đầu.\n', 'utf-8');

  const idx1 = await loadOrBuildIndex(project);
  assert.equal(idx1.characters.length, 1);
  assert.ok(idx1.sourceFingerprint, 'index mới phải có sourceFingerprint');

  // Quay lại -> cache hit (builtAt giữ nguyên)
  const idx2 = await loadOrBuildIndex(project);
  assert.equal(idx2.builtAt, idx1.builtAt, 'không đổi gì → dùng cache');

  // Sửa TỪ NGOÀI: thêm nhân vật mới + đẩy mtime về tương lai chắc chắn lệch fingerprint
  await fs.writeFile(path.join(charDir, 'lam_phong.md'), '---\nname: Lâm Phong\n---\n\nHồ sơ mới thêm tay.\n', 'utf-8');
  const future = new Date(Date.now() + 60_000);
  await fs.utimes(path.join(charDir, 'lam_phong.md'), future, future);

  const idx3 = await loadOrBuildIndex(project);
  assert.notEqual(idx3.builtAt, idx1.builtAt, 'fingerprint lệch → rebuild');
  assert.equal(idx3.characters.length, 2, 'nhân vật thêm tay phải xuất hiện');
  assert.ok(idx3.characters.some(c => c.name === 'Lâm Phong'));
});

test('map_relationships auto-scan: cache fingerprint — thêm chương mới → đếm cập nhật', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'story-scan-cache-'));
  const project = new StoryProject(tmpDir);
  await project.initializeProject({ name: 'Kiểm Tra Scan Cache' });

  const charDir = path.join(tmpDir, 'bible', 'characters');
  await fs.writeFile(path.join(charDir, 'tieu_viem.md'), '---\nname: Tiêu Viêm\naliases: [Tiểu Viêm]\n---\n\nNhân vật A.\n', 'utf-8');
  await fs.writeFile(path.join(charDir, 'lam_phong.md'), '---\nname: Lâm Phong\n---\n\nNhân vật B.\n', 'utf-8');

  const arcDir = path.join(tmpDir, 'manuscript', 'arc_01');
  await fs.mkdir(arcDir, { recursive: true });
  const body = 'Tiêu Viêm và Lâm Phong cùng hành động trong chương này.';
  // 3 chương cùng co-occurrence
  await fs.writeFile(path.join(arcDir, 'ch_001.md'), body, 'utf-8');
  await fs.writeFile(path.join(arcDir, 'ch_002.md'), body, 'utf-8');
  await fs.writeFile(path.join(arcDir, 'ch_003.md'), body, 'utf-8');

  const handler = makeHandler(project);

  // Lần 1: quét → tạo quan hệ INFERRED, chapters=3 (tên cặp sort theo alphabet)
  const res1 = await handler({} as never);
  assert.match(res1.content[0].text, /tạo mới 1/);
  assert.match(res1.content[0].text, /tạo mới \[other\] \(3 chương/);

  // Lần 2 ngay lập tức KHÔNG đổi gì → vẫn cập nhật thành công (cache hit path không throw)
  const res2 = await handler({} as never);
  assert.match(res2.content[0].text, /đã có quan hệ/);

  // Thêm chương 4 (file mới → fingerprint tự lệch, KHÔNG cần xoá cache tay)
  await fs.writeFile(path.join(arcDir, 'ch_004.md'), body, 'utf-8');
  const res3 = await handler({} as never);
  assert.match(res3.content[0].text, /\(4 chương đồng xuất hiện\)/, 'sau khi thêm chương, count phải tăng 3→4');
});

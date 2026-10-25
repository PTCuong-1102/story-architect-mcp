import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { StoryProject } from '../src/server/StoryProject.js';
import { McpServer } from '@modelcontextprotocol/server';
import { registerDetectTimelineTool, generateMermaidTimeline, parseAbsoluteDate } from '../src/tools/analysis/detectTimeline.js';
import { registerSnapshotTools, createSnapshot } from '../src/tools/rescue/snapshot.js';
import { bm25Rank, searchEntities, type KnowledgeGraphIndex } from '../src/utils/knowledgeGraph.js';

// ============================================================
// P3.1 — Timeline absolute dates (v0.5.0)
// ============================================================

function makeTimelineHandler(project: StoryProject) {
  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  registerDetectTimelineTool(server, () => project);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (p: never) => Promise<{ content: { text: string }[] }> }> })._registeredTools;
  return tools['story_detect_timeline_conflicts'].handler;
}

function mktmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('P3.1 timeline: omnipresence khớp khi format ngày khác nhau nhưng cùng ngày', async () => {
  const tmpDir = await mktmp('story-tl-date-');
  const project = new StoryProject(tmpDir);
  await project.initializeProject({ name: 'Timeline Ngày' });
  const handler = makeTimelineHandler(project);

  // Cùng 1 nhân vật, 2 nơi, cùng 1 ngày nhưng ghi khác format
  await handler({ addEvent: { label: 'Sự kiện A', chapter: 'arc_01/ch_001', characters: ['Tiêu Viêm'], location: 'Cổng Bắc', absoluteDate: '2025-01-01', thread: 'Tuyến 1' } });
  const res = await handler({ addEvent: { label: 'Sự kiện B', chapter: 'arc_01/ch_002', characters: ['Tiêu Viêm'], location: 'Kho Nam', absoluteDate: '2025-01-01 00:00', thread: 'Tuyến 2' } });
  const text = (await res).content[0].text;
  assert.ok(text.includes('MÂU THUẪN ĐỊA ĐIỂM'), '"2025-01-01" phải khớp "2025-01-01 00:00"');

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('P3.1 timeline: mâu thuẫn ngày ↔ chương (cùng nhân vật, thread khác)', async () => {
  const tmpDir = await mktmp('story-tl-dch-');
  const project = new StoryProject(tmpDir);
  await project.initializeProject({ name: 'Timeline Ngày Chương' });
  const handler = makeTimelineHandler(project);

  // Sự kiện ở chương SAU nhưng ngày TRƯỚC (ngược nhau) — cùng nhân vật
  await handler({ addEvent: { label: 'Hẹn gặp bang chủ', chapter: 'arc_01/ch_003', characters: ['Lâm Phong'], absoluteDate: '2025-03-01' } });
  const res = await handler({ addEvent: { label: 'Rời thành', chapter: 'arc_01/ch_001', characters: ['Lâm Phong'], absoluteDate: '2025-06-01' } });
  const text = res.content[0].text;
  assert.ok(text.includes('Mâu thuẫn ngày/chương'), `phải phát hiện ngày ngược chương:\n${text.slice(0, 600)}`);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('P3.1 timeline: in-world date không bỏ lỗi, chỉ lưu hiển thị + feedback rõ ràng', async () => {
  const tmpDir = await mktmp('story-tl-world-');
  const project = new StoryProject(tmpDir);
  await project.initializeProject({ name: 'In-World Date' });
  const handler = makeTimelineHandler(project);

  const res = await handler({ addEvent: { label: 'Đức Vàng chứng nghiệm', chapter: 'arc_01/ch_001', characters: ['Phụ đạo tông'], absoluteDate: 'Năm 340 Huyết Nhung' } });
  const text = res.content[0].text;
  assert.ok(text.includes('in-world date') && text.includes('không parse được'), 'feedback phải nói rõ không tham gia check');
  assert.ok(parseAbsoluteDate('Năm 340 Huyết Nhung') === null);
  assert.deepEqual(parseAbsoluteDate('2025-01-01')!.getTime(), parseAbsoluteDate('2025-01-01 00:00')!.getTime());
  assert.ok(parseAbsoluteDate('2025-06-15T09:30')!.getHours() === 9, 'giữ giờ khi có timestamp');

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('P3.1 timeline: Mermaid sort theo ngày khi thiếu relativeOrder', () => {
  const evs = [
    { id: 'evt_b', label: 'Sau', description: '', absoluteDate: '2025-06-01', relativeOrder: 0, characters: [] },
    { id: 'evt_a', label: 'Trước', description: '', absoluteDate: '2025-01-01', relativeOrder: 0, characters: [] },
  ];
  const md = generateMermaidTimeline(evs as never);
  const idxTruoc = md.indexOf('Trước');
  const idxSau = md.indexOf('Sau');
  assert.ok(idxTruoc < idxSau, '"Trước" (2025-01-01) phải đứng trước "Sau" (2025-06-01)');
});

// ============================================================
// P3.2 — BM25 ranking (v0.5.0)
// ============================================================

test('P3.2 BM25: từ hiếm quyết định nhiều hơn từ phổ thông', () => {
  // Docs phải fold không dấu từ caller (như searchEntities làm)
  const docs = [
    { id: 'generic', tokens: ['nhan', 'vat', 'co', 'gai', 'dep', 'vui'] },
    { id: 'generic2', tokens: ['nhan', 'vat', 'co', 'gai', 'buon'] },
    { id: 'rare', tokens: ['nhan', 'vat', 'phuong', 'hoang', 'giang', 'the'] },
  ];
  const scores = bm25Rank('nhân vật phượng hoàng', docs);
  assert.ok((scores.get('rare') ?? 0) > (scores.get('generic') ?? 0), `rare=${scores.get('rare')} > generic=${scores.get('generic')}`);
});

test('P3.2 searchEntities: BM25 không phá các bậc tên/alias/fuzzy cũ', () => {
  const INDEX: KnowledgeGraphIndex = {
    characters: [
      { name: 'Linh Hồn', fileKey: 'linh_hon', aliases: ['Tiểu Hồn'], terms: ['linh', 'hồn', 'kiếm', 'khí'], contentPreview: '' },
      { name: 'Trăng Trang', fileKey: 'trang_trang', aliases: [], terms: ['trăng', 'trang', 'võ', 'thi'], contentPreview: '' },
    ],
    worldEntries: [{ name: 'Thanh Vân Sơn', terms: ['thanh', 'vân', 'sơn', 'tông'], contentPreview: '' }],
    relationships: [],
    timelineEvents: [],
    builtAt: new Date().toISOString(),
  };
  const hits = searchEntities(INDEX, 'Linh Hồn');
  assert.equal(hits[0]?.name, 'Linh Hồn');
  assert.equal(hits[0]?.score, 1.0);
  // terms-only: query về "kiếm khí" → Linh Hồn phải được rank cao hơn Trash
  const hits2 = searchEntities(INDEX, 'kiếm khí võ thi');
  assert.ok(hits2.some(h => h.name === 'Linh Hồn') && hits2.some(h => h.name === 'Trăng Trang'));
});

// ============================================================
// P3.3 — story_prune_snapshots (v0.5.0)
// ============================================================

function makeSnapshotHandlers(project: StoryProject) {
  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  registerSnapshotTools(server, () => project);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (p: never) => Promise<{ content: { text: string }[]; isError?: boolean }> }> })._registeredTools;
  return tools;
}

test('P3.3 prune: preview không xóa, confirm xóa đúng + index sạch + keepLast', async () => {
  const tmpDir = await mktmp('story-prune-');
  const project = new StoryProject(tmpDir);
  await project.initializeProject({ name: 'Prune Novel' });
  await fs.writeFile(path.join(tmpDir, 'manuscript', 'arc_01', 'ch_001.md'), 'Chương.\n', 'utf-8');

  const tools = makeSnapshotHandlers(project);
  // 5 snapshots (timestamps chắc chắn khác nhau nhờ generateId + createdAt ms)
  for (let i = 0; i < 5; i++) {
    await createSnapshot(project, `snap-${i}`);
  }

  // Preview (confirm: false mặc định) → KHÔNG xóa gì
  const preview = await tools['story_prune_snapshots'].handler({ keepLast: 3 } as never);
  assert.match(preview.content[0].text, /Preview/);
  const idxRaw = await fs.readFile(path.join(tmpDir, '.story', 'snapshots', 'index.json'), 'utf-8');
  assert.equal(JSON.parse(idxRaw).snapshots.length, 5, 'preview không được xóa entry');

  // Confirm: keepLast=3 → xóa 2
  const done = await tools['story_prune_snapshots'].handler({ keepLast: 3, confirm: true } as never);
  const dirs = await fs.readdir(path.join(tmpDir, '.story', 'snapshots'));
  const dirsOnly = dirs.filter(d => d !== 'index.json');
  assert.equal(dirsOnly.length, 3, `còn đúng 3 thư mục snapshot, thấy: ${dirsOnly.join(',')}`);
  assert.match(done.content[0].text, /Đã xóa 2/);
  const idxRaw2 = await fs.readFile(path.join(tmpDir, '.story', 'snapshots', 'index.json'), 'utf-8');
  assert.equal(JSON.parse(idxRaw2).snapshots.length, 3, 'index bị dọn sạch entry đã xóa');

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('P3.3 prune: keepLast < 3 yêu cầu confirm tường minh', async () => {
  const tmpDir = await mktmp('story-prune-guard-');
  const project = new StoryProject(tmpDir);
  await project.initializeProject({ name: 'Prune Guard' });
  await createSnapshot(project, 's1');
  await createSnapshot(project, 's2');

  const tools = makeSnapshotHandlers(project);
  const denied = await tools['story_prune_snapshots'].handler({ keepLast: 1 } as never);
  assert.equal(denied.isError, true, 'keepLast<3 không confirm phải từ chối');

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('P3.3 prune: orphan entry (thư mục bị xóa tay) được dọn khỏi index', async () => {
  const tmpDir = await mktmp('story-prune-orphan-');
  const project = new StoryProject(tmpDir);
  await project.initializeProject({ name: 'Prune Orphan' });
  await createSnapshot(project, 'giữ');
  await createSnapshot(project, 'orphan');
  // Xóa tay thư mục của snapshot thứ 2 (lấy id từ index)
  const idxRaw = await fs.readFile(path.join(tmpDir, '.story', 'snapshots', 'index.json'), 'utf-8');
  const ids = (JSON.parse(idxRaw) as { snapshots: { id: string; label: string }[] }).snapshots;
  const orphanId = ids.find(s => s.label === 'orphan')!.id;
  await fs.rm(path.join(tmpDir, '.story', 'snapshots', orphanId), { recursive: true, force: true });

  const tools = makeSnapshotHandlers(project);
  // keepLast đủ lớn — orphan vẫn dọn khỏi index
  await tools['story_prune_snapshots'].handler({ keepLast: 5, confirm: true } as never);
  const idxRaw2 = JSON.parse(await fs.readFile(path.join(tmpDir, '.story', 'snapshots', 'index.json'), 'utf-8')) as { snapshots: unknown[] };
  assert.equal(idxRaw2.snapshots.length, 1, 'orphan entry phải bị loại khỏi index');

  await fs.rm(tmpDir, { recursive: true, force: true });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { StoryProject } from '../src/server/StoryProject.js';
import { McpServer } from '@modelcontextprotocol/server';
import { registerAutoRefactorTool } from '../src/tools/rescue/autoRefactorStructure.js';
import { registerAiLayoutTools, loadLayoutVerdict } from '../src/tools/rescue/aiLayout.js';
import { registerScanMessyProjectTool } from '../src/tools/rescue/scanMessyProject.js';

type Handler = (p: any) => Promise<{ content: { text: string }[]; isError?: boolean }>;

async function mktmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * Server test 3 tool: brief + verdict + refactor (+ scan khi cần).
 * Gọi handler trực tiếp (zod default không áp dụng).
 */
function makeHandlers() {
  const tmpDirPromise = mktmp('ai-layout-');
  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  registerAiLayoutTools(server, () => new StoryProject('.'));
  registerAutoRefactorTool(server, () => new StoryProject('.'));
  registerScanMessyProjectTool(server, () => new StoryProject('.'));
  const tools = (server as unknown as {
    _registeredTools: Record<string, { handler: Handler }>;
  })._registeredTools;
  return {
    tools,
    async handlerFor(name: string): Promise<Handler> {
      const dir = await tmpDirPromise;
      void dir;
      return tools[name].handler;
    },
  };
}

const BODY = 'Câu chữ chương — có đối thoại "này" và đoạn văn dài để máy đếm từ không chê.';

/**
 * Quirky novel: chương KHÔNG có từ khóa "Chương" — regex v0.6.0 tìm
 * không ra ("I. Mở màn", "II. Cuộc gặp", ...). AI đọc ngữ cảnh thấy.
 */
const QUIRK_NOVEL_LINES = [
  'Ky su Nam song vo',                       // 1 (title file)
  '',                                        // 2
  'Dòng mở đầu của tác giả, vài chữ dắt.',   // 3
  '',                                        // 4
  'I. Mở màn',                               // 5  ← chương 1 theo AI
  BODY,
  BODY,
  'II. Cuộc gặp',                            // 8  ← chương 2
  BODY,
  'III. Bão lớn',                            // 10 ← chương 3
  BODY,
  'IV. Trở về',                              // 12 ← chương 4
  BODY,
];

test('brief: chứa cây file, heuristic profile + hướng dẫn nộp verdict', async () => {
  const tmpDir = await mktmp('brief-');
  await fs.writeFile(path.join(tmpDir, 'ky-su.md'), QUIRK_NOVEL_LINES.join('\n'), 'utf-8');
  await fs.writeFile(path.join(tmpDir, 'notetoc.md'), 'ghi chú loắt', 'utf-8');

  const brief = (await (await makeHandlers().handlerFor('story_export_layout_brief'))({ projectPath: tmpDir })) as { content: { text: string }[] };
  const text = brief.content[0].text;
  assert.match(text, /LAYOUT BRIEF/);
  assert.match(text, /notetoc\.md/);
  assert.match(text, /Heuristic profile/);
  assert.match(text, /story_apply_layout_verdict/);
  assert.match(text, /startLine/);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('verdict AI (chương quirks regex bỏ sót) → refactor tách đúng theo startLine', async () => {
  const tmpDir = await mktmp('verdict-split-');
  await fs.writeFile(path.join(tmpDir, 'ky-su.md'), QUIRK_NOVEL_LINES.join('\n'), 'utf-8');

  const applyHandler = await makeHandlers().handlerFor('story_apply_layout_verdict');
  const applyResult = await applyHandler({
    projectPath: tmpDir,
    verdict: {
      kind: 'single_file',
      confidence: 0.9,
      reasoning: 'File "ky-su.md" là truyện ký sự; các tiêu đề "I. Mở màn" / "II. Cuộc gặp" / "III. Bão lớn" / "IV. Trở về" là chương (không có từ khóa "Chương" nên regex bỏ sót).',
      chapters: [
        { file: 'ky-su.md', title: 'I. Mở màn', number: 1, startLine: 5 },
        { file: 'ky-su.md', title: 'II. Cuộc gặp', number: 2, startLine: 8 },
        { file: 'ky-su.md', title: 'III. Bão lớn', number: 3, startLine: 10 },
        { file: 'ky-su.md', title: 'IV. Trở về', number: 4, startLine: 12 },
      ],
    },
  }) as { content: { text: string }[] };
  assert.match(applyResult.content[0].text, /Verdict AI đã lưu/);

  // Verdict phải được persist + load lại được
  const loaded = await loadLayoutVerdict(tmpDir);
  assert.ok(loaded?.verdict.chapters?.length === 4, 'verdict lưu đúng schema');
  assert.equal(loaded.source, 'agent');

  // Refactor — preview phải nhắc "Phán đoán AI" + SPLIT
  const refactor = (await (await makeHandlers().handlerFor('story_auto_refactor_structure'))({ projectPath: tmpDir })) as { content: { text: string }[] };
  assert.match(refactor.content[0].text, /SPLIT/);
  assert.match(refactor.content[0].text, /Phán đoán AI/);

  // Confirm → tách theo ranh giới AI (regex không làm được)
  const done = (await (await makeHandlers().handlerFor('story_auto_refactor_structure'))({
    projectPath: tmpDir,
    confirm: true,
  })) as { content: { text: string }[] };
  assert.match(done.content[0].text, /Lỗi: 0/);
  assert.ok(!done.content[0].text.includes('❌'));

  const arc = await fs.readdir(path.join(tmpDir, 'manuscript', 'arc_01'));
  const chapters = arc.filter(f => f.endsWith('.md')).sort();
  assert.equal(chapters.length, 4, `4 chương quirks, thấy: ${chapters.join(',')}`);
  const ch2 = await fs.readFile(path.join(tmpDir, 'manuscript', 'arc_01', 'ch_002.md'), 'utf-8');
  assert.match(ch2, /^II\. Cuộc gặp/, 'tiêu đề AI nộp nằm đầu file');
  assert.ok(ch2.includes(BODY.slice(0, 20)), 'nội dung chương bảo toàn');

  // Bản gốc bảo toàn vào drafts_raw
  const drafts = await fs.readdir(path.join(tmpDir, 'drafts_raw'));
  assert.ok(drafts.some(f => f.startsWith('ky-su')), 'file gốc vào drafts_raw');

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('verdict định danh mục trực tiếp (files map + arcs map)', async () => {
  const tmpDir = await mktmp('verdict-files-');
  await fs.mkdir(path.join(tmpDir, 'tap1'), { recursive: true });
  await fs.writeFile(path.join(tmpDir, 'tap1', 'ha-so-001.md'), 'Hà Sở tiên hành nạn ' + 'dài '.repeat(80), 'utf-8');
  await fs.writeFile(path.join(tmpDir, 'tap1', 'ha-so-002.md'), 'Hà Sở hai: găng ' + 'dài '.repeat(80), 'utf-8');
  await fs.writeFile(path.join(tmpDir, 'tiet-muc-phan-tich.md'), 'Phân tích chủ đề: ' + 'dài '.repeat(80), 'utf-8');

  const apply = (await (await makeHandlers().handlerFor('story_apply_layout_verdict'))({
    projectPath: tmpDir,
    verdict: {
      kind: 'arc_folders',
      confidence: 0.92,
      reasoning: '"tap1" là tập 1 (arc); tiet-muc-phan-tich.md là worldbuilding; ha-so-002 trùng nội dung nên giữ nguyên',
      arcs: [{ fromDir: 'tap1', arc: 'arc_01' }],
      files: [
        { path: 'tiet-muc-phan-tich.md', destination: 'bible/world/tiet-muc.md', reason: 'Phân tích chủ đề → world' },
      ],
    },
  })) as { content: { text: string }[] };
  assert.match(apply.content[0].text, /Verdict AI đã lưu/);

  const done = (await (await makeHandlers().handlerFor('story_auto_refactor_structure'))({
    projectPath: tmpDir,
    confirm: true,
  })) as { content: { text: string }[] };
  assert.match(done.content[0].text, /Lỗi: 0/);
  assert.ok(!done.content[0].text.includes('❌'));

  assert.ok(
    (await fs.readFile(path.join(tmpDir, 'manuscript', 'arc_01', 'ha-so-001.md'), 'utf-8')).includes('Hà Sở tiên'),
    'arc map giữ nguyên tên + nội dung',
  );
  const world = await fs.stat(path.join(tmpDir, 'bible')).then(s => s.isDirectory()).catch(() => false);
  assert.ok(world, 'bible/ được tạo');
  assert.ok(
    (await fs.readFile(path.join(tmpDir, 'bible', 'world', 'tiet-muc.md'), 'utf-8')).includes('chủ đề'),
    'file AI map → bible/world',
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('verdict HỎNG hợp lệ bị từ chối (path rời dự án, startLine vượt file)', async () => {
  const tmpDir = await mktmp('verdict-bad-');
  await fs.writeFile(path.join(tmpDir, 'nho.md'), 'Chỉ 3 dòng\ndòng hai\ndòng ba', 'utf-8');

  const apply = (await makeHandlers().handlerFor('story_apply_layout_verdict')) as unknown as Handler;

  const res1 = await apply({
    projectPath: tmpDir,
    verdict: {
      kind: 'single_file',
      confidence: 0.8,
      reasoning: 'test đường dẫn rời khỏi dự án',
      chapters: [{ file: '../../etc/passwd', startLine: 1 }],
    },
  });
  assert.match(res1.content[0].text, /bị từ chối/);
  assert.match(res1.content[0].text, /rời khỏi dự án/);

  const res2 = await apply({
    projectPath: tmpDir,
    verdict: {
      kind: 'single_file',
      confidence: 0.8,
      reasoning: 'startLine vượt quá 3 dòng',
      chapters: [{ file: 'nho.md', startLine: 99 }],
    },
  });
  assert.match(res2.content[0].text, /vượt quá số dòng/);

  const res3 = await apply({
    projectPath: tmpDir,
    verdict: {
      kind: 'mixed_loose',
      confidence: 0.5,
      reasoning: 'destination ngoài root chuẩn',
      files: [{ path: 'nho.md', destination: 'random/dir/x.md' }],
    },
  });
  assert.match(res3.content[0].text, /destination phải bắt đầu bằng/);

  // Verdict không hợp lệ KHÔNG được ghi đĩa — dự án vẫn sạch
  const loaded = await loadLayoutVerdict(tmpDir);
  assert.equal(loaded, null, 'không lưu verdict từ chối');

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('scan hiển thị mục phán đoán AI (đã áp) hoặc tip (chưa áp)', async () => {
  const tmpDir = await mktmp('scan-ai-');
  await fs.writeFile(path.join(tmpDir, 'ky-su.md'), QUIRK_NOVEL_LINES.join('\n'), 'utf-8');

  // Chưa áp verdict → tip
  const scanBefore = (await (await makeHandlers().tools['story_scan_messy_project'].handler)({
    path: tmpDir,
  })) as { content: { text: string }[] };
  assert.match(scanBefore.content[0].text, /story_export_layout_brief/, 'tip AI khi chưa có verdict');

  // Áp verdict → mục 🧠
  await (await makeHandlers().handlerFor('story_apply_layout_verdict'))({
    projectPath: tmpDir,
    verdict: {
      kind: 'single_file',
      confidence: 0.88,
      reasoning: 'ky-su.md là truyện ký sự, tiêu đề La Mã số là chương.',
      chapters: [
        { file: 'ky-su.md', title: 'I. Mở màn', startLine: 5 },
        { file: 'ky-su.md', title: 'II. Cuộc gặp', startLine: 8 },
      ],
    },
  });
  const scanAfter = (await (await makeHandlers().tools['story_scan_messy_project'].handler)({
    path: tmpDir,
  })) as { content: { text: string }[] };
  assert.match(scanAfter.content[0].text, /Phán đoán AI/, 'mục AI khi có verdict');
  assert.match(scanAfter.content[0].text, /La Mã số/, 'hiển thị lý giải của AI');

  await fs.rm(tmpDir, { recursive: true, force: true });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { StoryProject } from '../src/server/StoryProject.js';
import { registerProjectManagerTools, detectProjectType } from '../src/tools/projectManager.js';

const TMP = '/tmp/opencode/unit-pm';

type ToolResult = { content: { type: string; text: string }[] };

function makeFakeServer(): { server: McpServer; handlers: Map<string, (params: never) => Promise<ToolResult>> } {
  const handlers = new Map<string, (params: never) => Promise<ToolResult>>();
  const fake = {
    registerTool: (name: string, _config: unknown, handler: (params: never) => Promise<ToolResult>) => {
      handlers.set(name, handler);
    },
  };
  return { server: fake as unknown as McpServer, handlers };
}

async function makeDir(entries: Record<string, string | null> = {}): Promise<string> {
  const dir = path.join(TMP, `d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await fs.mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(entries)) {
    if (content === null) {
      await fs.mkdir(path.join(dir, name), { recursive: true });
    } else {
      await fs.writeFile(path.join(dir, name), content, 'utf-8');
    }
  }
  return dir;
}

test('detectProjectType: .story → novel confidence 1.0', async () => {
  const dir = await makeDir({ '.story': '{}' });
  const d = await detectProjectType(dir);
  assert.equal(d.type, 'novel');
  assert.equal(d.confidence, 1.0);
  assert.deepEqual(d.novelSignals, ['.story']);
});

test('detectProjectType: ≥2 novel markers → novel 0.8', async () => {
  const dir = await makeDir({ manuscript: null, bible: null });
  const d = await detectProjectType(dir);
  assert.equal(d.type, 'novel');
  assert.equal(d.confidence, 0.8);
});

test('detectProjectType: package.json → code project', async () => {
  const dir = await makeDir({ 'package.json': '{}' });
  const d = await detectProjectType(dir);
  assert.equal(d.type, 'code');
  assert.ok(d.codeSignals.includes('package.json'));
  // confidence tăng theo số signal
  assert.ok(d.confidence > 0.5 && d.confidence <= 0.95);
});

test('detectProjectType: glob *.csproj nhận diện .NET project', async () => {
  const dir = await makeDir({ 'MyApp.csproj': '<Project/>' });
  const d = await detectProjectType(dir);
  assert.equal(d.type, 'code');
  assert.ok(d.codeSignals.includes('*.csproj'));
});

test('detectProjectType: thư mục src/ thật sự là directory → code signal', async () => {
  const dir = await makeDir({ src: null });
  const d = await detectProjectType(dir);
  assert.equal(d.type, 'code');
  assert.ok(d.codeSignals.includes('src/'));

  // File tên "src" (không phải directory) không tính là code signal
  const dir2 = await makeDir({ src: 'not a dir' });
  const d2 = await detectProjectType(dir2);
  assert.notEqual(d2.type, 'code');
});

test('detectProjectType: chỉ có .git → KHÔNG tính là code project', async () => {
  const dir = await makeDir({ '.git': null });
  const d = await detectProjectType(dir);
  assert.equal(d.type, 'unknown');
  assert.equal(d.codeSignals.length, 0);
});

test('detectProjectType: thư mục trống / không tồn tại → empty', async () => {
  const empty = await makeDir();
  assert.equal((await detectProjectType(empty)).type, 'empty');
  assert.equal((await detectProjectType(path.join(empty, 'khong-ton-tai'))).type, 'empty');
});

test('detectProjectType: mixed signals → ưu tiên novel', async () => {
  const dir = await makeDir({ '.story': '{}', 'package.json': '{}' });
  const d = await detectProjectType(dir);
  assert.equal(d.type, 'novel');
  assert.equal(d.confidence, 1.0);
  assert.ok(d.novelSignals.includes('.story'));
  assert.ok(d.codeSignals.includes('package.json'));
});

test('story_set_project: từ chối code project khi force=false', async () => {
  const codeDir = await makeDir({
    'Cargo.toml': '[package]',
    src: null,
    target: null,
  });

  let current: StoryProject | null = null;
  const { server, handlers } = makeFakeServer();
  registerProjectManagerTools(
    server,
    (p) => { current = new StoryProject(p); return current; },
    () => current,
    () => (current ? current.projectPath : null),
  );

  const rejected = await handlers.get('story_set_project')!({ projectPath: codeDir } as never);
  assert.match(rejected.content[0].text, /không phải dự án tiểu thuyết/);
  assert.match(rejected.content[0].text, /force: true/);
  assert.equal(current, null);

  // force=true → chấp nhận kèm cảnh báo
  const forced = await handlers.get('story_set_project')!({ projectPath: codeDir, force: true } as never);
  assert.match(forced.content[0].text, /Đã thiết lập dự án/);
  assert.match(forced.content[0].text, /⚠️ Đã bỏ qua kiểm tra/);
  assert.ok(current instanceof StoryProject);
});

test('story_set_project: đường dẫn không tồn tại → báo lỗi', async () => {
  const { server, handlers } = makeFakeServer();
  registerProjectManagerTools(
    server,
    (p) => new StoryProject(p),
    () => null,
    () => null,
  );

  const result = await handlers.get('story_set_project')!({
    projectPath: path.join(TMP, `missing-${Date.now()}`),
  } as never);
  assert.match(result.content[0].text, /Không tìm thấy thư mục/);
});

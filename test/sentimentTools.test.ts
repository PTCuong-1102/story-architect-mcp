import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { StoryProject } from '../src/server/StoryProject.js';
import { registerAnalyzeSentimentTool } from '../src/tools/analysis/analyzeSentiment.js';
import { registerTrackEmotionTool } from '../src/tools/analysis/trackEmotion.js';
import { registerAnalyzeVoiceTool } from '../src/tools/analysis/analyzeVoice.js';
import { registerGenerateWritingPromptTool } from '../src/tools/generatePrompt.js';
import { registerResources } from '../src/resources/index.js';

const TMP = '/tmp/opencode/unit-sentiment';

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
type ResourceResult = { contents: { uri: string; mimeType: string; text: string }[] };

function makeFakeServer(): {
  server: McpServer;
  handlers: Map<string, (params: any) => Promise<ToolResult>>;
  resources: Map<string, () => Promise<ResourceResult>>;
} {
  const handlers = new Map<string, (params: any) => Promise<ToolResult>>();
  const resources = new Map<string, () => Promise<ResourceResult>>();

  const fake = {
    registerTool: (name: string, _config: unknown, handler: (params: any) => Promise<ToolResult>) => {
      handlers.set(name, handler);
    },
    registerResource: (name: string, uriOrTemplate: unknown, _config: unknown, handler: () => Promise<ResourceResult>) => {
      if (typeof uriOrTemplate === 'string') {
        resources.set(uriOrTemplate, handler);
      }
    },
  };
  return { server: fake as unknown as McpServer, handlers, resources };
}

async function freshProject(): Promise<StoryProject> {
  const dir = path.join(TMP, `novel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const p = new StoryProject(dir);
  await p.initializeProject({ name: 'Thiên Địa Phong Vân', author: 'Tác Giả Mẫu', genre: ['Tiên Hiệp'] });
  return p;
}

test('story_analyze_sentiment: từ chối khi dự án chưa khởi tạo', async () => {
  const uninitDir = path.join(TMP, `uninit-${Date.now()}`);
  const uninitProject = new StoryProject(uninitDir);

  const { server, handlers } = makeFakeServer();
  registerAnalyzeSentimentTool(server, () => uninitProject);

  const handler = handlers.get('story_analyze_sentiment');
  assert.ok(handler);

  const res = await handler({ arc: 'arc_01' });
  assert.strictEqual(res.isError, true);
  assert.ok(res.content[0].text.includes('chưa được khởi tạo'));
});

test('story_analyze_sentiment: từ chối khi không tìm thấy chương trong arc', async () => {
  const p = await freshProject();
  const { server, handlers } = makeFakeServer();
  registerAnalyzeSentimentTool(server, () => p);

  const handler = handlers.get('story_analyze_sentiment');
  assert.ok(handler);

  const res = await handler({ arc: 'arc_99_not_found' });
  assert.strictEqual(res.isError, true);
  assert.ok(res.content[0].text.includes('Không tìm thấy chương'));
});

test('story_analyze_sentiment: phân tích đầy đủ arc và lưu cache', async () => {
  const p = await freshProject();
  await fs.writeFile(
    path.join(p.manuscriptDir, 'arc_01', 'ch_001.md'),
    'Nắng mai rực rỡ, chim hót vang lừng. Nàng mỉm cười hạnh phúc bên người yêu thương trong sự bình yên.',
    'utf-8'
  );
  await fs.writeFile(
    path.join(p.manuscriptDir, 'arc_01', 'ch_002.md'),
    'Bóng tối ập xuống phế tích. Quái vật gầm thét, máu chảy thành sông, sự chết chóc và tuyệt vọng bao trùm.',
    'utf-8'
  );

  const { server, handlers } = makeFakeServer();
  registerAnalyzeSentimentTool(server, () => p);

  const handler = handlers.get('story_analyze_sentiment');
  assert.ok(handler);

  const res = await handler({ arc: 'arc_01', windowSize: 50, compareToStyleGuide: true });
  assert.ok(res.content[0].text.includes('Phân tích Cảm xúc & Giọng văn'));
  assert.ok(res.content[0].text.includes('Chương: ch_001'));
  assert.ok(res.content[0].text.includes('Chương: ch_002'));
  assert.ok(res.content[0].text.includes('Tone Drift'));

  // Kiểm tra cache đã được ghi
  const cache = await p.getSentimentCache();
  assert.ok(cache !== null);
  assert.strictEqual(cache.arc, 'arc_01');
  assert.strictEqual(cache.chapters.length, 2);
});

test('story_analyze_sentiment: phân tích một chương cụ thể (params.chapter)', async () => {
  const p = await freshProject();
  await fs.writeFile(
    path.join(p.manuscriptDir, 'arc_01', 'ch_001.md'),
    'Nắng mai rực rỡ, chim hót vang lừng. Nàng mỉm cười hạnh phúc bên người yêu thương.',
    'utf-8'
  );

  const { server, handlers } = makeFakeServer();
  registerAnalyzeSentimentTool(server, () => p);

  const handler = handlers.get('story_analyze_sentiment');
  assert.ok(handler);

  const res = await handler({ arc: 'arc_01', chapter: 'ch_001' });
  assert.ok(res.content[0].text.includes('Chương: ch_001'));
  assert.ok(!res.content[0].text.includes('Chương: ch_002'));
});

test('story_track_emotion: phân tích nhanh đoạn text đơn lẻ và xử lý text rỗng', async () => {
  const { server, handlers } = makeFakeServer();
  registerTrackEmotionTool(server);

  const handler = handlers.get('story_track_emotion');
  assert.ok(handler);

  // Normal text
  const res = await handler({ text: 'Tôi cảm thấy vô cùng tuyệt vọng và sợ hãi trước bóng tối mịt mù.' });
  assert.ok(res.content[0].text.includes('Quick Emotion Tracker'));
  assert.ok(res.content[0].text.includes('Polarity'));
  assert.ok(res.content[0].text.includes('Giọng văn'));

  // Empty text
  const emptyRes = await handler({ text: '   ' });
  assert.ok(emptyRes.content[0].text.includes('trống'));
});

test('story_analyze_voice: tích hợp thông tin cảm xúc & so sánh style guide', async () => {
  const p = await freshProject();
  await fs.writeFile(
    path.join(p.manuscriptDir, 'arc_01', 'ch_001.md'),
    'Hắn chậm rãi bước đi trên con đường đá cổ kính, lòng thầm nghĩ về tương lai và ước mơ phía trước.',
    'utf-8'
  );

  const { server, handlers } = makeFakeServer();
  registerAnalyzeVoiceTool(server, () => p);

  const handler = handlers.get('story_analyze_voice');
  assert.ok(handler);

  const res = await handler({ arc: 'arc_01' });
  assert.ok(res.content[0].text.includes('Phân tích Giọng Văn'));
  assert.ok(res.content[0].text.includes('Cảm xúc chủ đạo'));
});

test('story://emotions resource: trả về dữ liệu cache hoặc thông báo chưa có dữ liệu', async () => {
  const p = await freshProject();
  const { server, resources } = makeFakeServer();
  registerResources(server, () => p);

  const emotionsResource = resources.get('story://emotions');
  assert.ok(emotionsResource);

  // Khi chưa có cache
  const emptyRes = await emotionsResource();
  assert.ok(emptyRes.contents[0].text.includes('Chưa có dữ liệu sentiment'));

  // Sau khi phân tích và lưu cache
  const { server: toolServer, handlers } = makeFakeServer();
  registerAnalyzeSentimentTool(toolServer, () => p);
  await fs.writeFile(path.join(p.manuscriptDir, 'arc_01', 'ch_001.md'), 'Vui vẻ hạnh phúc.', 'utf-8');
  await handlers.get('story_analyze_sentiment')!({ arc: 'arc_01' });

  const populatedRes = await emotionsResource();
  const data = JSON.parse(populatedRes.contents[0].text);
  assert.strictEqual(data.arc, 'arc_01');
  assert.ok(data.chapters.length > 0);
});

test('story_generate_writing_prompt: inject bối cảnh cảm xúc và định hướng emotional arc', async () => {
  const p = await freshProject();
  await fs.writeFile(
    path.join(p.manuscriptDir, 'arc_01', 'ch_001.md'),
    'Cả thành phố ngập trong biển lửa và chết chóc kinh hoàng.',
    'utf-8'
  );

  // Chạy analyze sentiment trước để tạo cache
  const { server: srv1, handlers: h1 } = makeFakeServer();
  registerAnalyzeSentimentTool(srv1, () => p);
  await h1.get('story_analyze_sentiment')!({ arc: 'arc_01' });

  // Đăng ký prompt generator
  const { server: srv2, handlers: h2 } = makeFakeServer();
  registerGenerateWritingPromptTool(srv2, () => p);

  const promptHandler = h2.get('story_generate_writing_prompt');
  assert.ok(promptHandler);

  const res = await promptHandler({ arc: 'arc_01', chapter: 'ch_002', strategy: 'continue' });
  const promptText = res.content[0].text;

  assert.ok(promptText.includes('BỐI CẢNH CẢM XÚC'));
  assert.ok(promptText.includes('Giọng văn chương trước'));
});

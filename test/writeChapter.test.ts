import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { StoryProject } from '../src/server/StoryProject.js';
import { McpServer } from '@modelcontextprotocol/server';
import { registerManuscriptAuthoringTools } from '../src/tools/manuscript/writeChapter.js';

test('manuscript authoring tools', async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'story-manuscript-test-'));
  const project = new StoryProject(tmpDir);
  await project.initializeProject({ name: 'Chương Trình Viết Thử Nghiệm' });

  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  registerManuscriptAuthoringTools(server, () => project);

  const tools = (server as any)._registeredTools || (server as any).tools;

  await t.test('story_write_chapter: tạo chương mới thành công và ghi nhận word count', async () => {
    const writeHandler = tools['story_write_chapter'].handler;
    const res = await writeHandler({
      arc: 'arc_01',
      chapter: 'ch_001',
      title: 'Khởi Đầu Mới',
      content: 'Trời đổ mưa tầm tã trên ngọn đồi hoang vắng. Tiêu Viêm bước đi từng bước nặng nề.',
      autoSnapshot: true,
    });

    assert.equal(res.isError, undefined);
    assert.ok(res.content[0].text.includes('Đã tạo chương mới'));
    assert.ok(res.content[0].text.includes('arc_01/ch_001'));

    const content = await project.getChapterContent('arc_01', 'ch_001');
    assert.ok(content?.includes('# Khởi Đầu Mới'));
    assert.ok(content?.includes('Tiêu Viêm'));

    const status = await project.getStatus();
    assert.ok(status.totalWordCount > 0);
    assert.equal(status.chapterCount, 1);
  });

  await t.test('story_append_scene: nối thêm scene vào chương hiện có', async () => {
    const appendHandler = tools['story_append_scene'].handler;
    const res = await appendHandler({
      arc: 'arc_01',
      chapter: 'ch_001',
      sceneHeading: 'Gặp Gỡ Ẩn Giả',
      content: 'Một bóng người xuất hiện trong màn sương mù mờ ảo.',
    });

    assert.equal(res.isError, undefined);
    assert.ok(res.content[0].text.includes('Đã nối thêm phân cảnh'));

    const content = await project.getChapterContent('arc_01', 'ch_001');
    assert.ok(content?.includes('### Gặp Gỡ Ẩn Giả'));
    assert.ok(content?.includes('màn sương mù'));
  });

  await t.test('story_read_chapter: đọc nội dung chương và danh sách heading', async () => {
    const readHandler = tools['story_read_chapter'].handler;
    const res = await readHandler({
      arc: 'arc_01',
      chapter: 'ch_001',
    });

    assert.equal(res.isError, undefined);
    assert.ok(res.content[0].text.includes('Bản thảo: arc_01 / ch_001'));
    assert.ok(res.content[0].text.includes('Khởi Đầu Mới'));
    assert.ok(res.content[0].text.includes('Gặp Gỡ Ẩn Giả'));
  });

  await t.test('story_write_chapter: ghi đè có tự động snapshot an toàn', async () => {
    const writeHandler = tools['story_write_chapter'].handler;
    const res = await writeHandler({
      arc: 'arc_01',
      chapter: 'ch_001',
      title: 'Khởi Đầu Mới - Phiên Bản 2',
      content: 'Mưa đã tạnh. Ánh nắng rực rỡ xuyên qua tàng lá.',
      autoSnapshot: true,
    });

    assert.equal(res.isError, undefined);
    assert.ok(res.content[0].text.includes('Đã cập nhật chương'));
    assert.ok(res.content[0].text.includes('snapshot'));
  });

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });
});

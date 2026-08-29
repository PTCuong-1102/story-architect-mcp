import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { StoryProject } from '../src/server/StoryProject.js';
import { McpServer } from '@modelcontextprotocol/server';
import { registerDetectTimelineTool } from '../src/tools/analysis/detectTimeline.js';
import { registerDashboardTool } from '../src/tools/dashboard.js';

test('timeline parallel & dashboard tools', async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'story-parallel-dash-test-'));
  const project = new StoryProject(tmpDir);
  await project.initializeProject({ name: 'Thiết Lập Tuyến Song Song' });

  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  registerDetectTimelineTool(server, () => project);
  registerDashboardTool(server, () => project);

  const tools = (server as any)._registeredTools || (server as any).tools;

  await t.test('detectTimeline: phát hiện sự kiện song song không có mâu thuẫn', async () => {
    const handler = tools['story_detect_timeline_conflicts'].handler;

    // Thêm event 1 ở Tuyến 1
    await handler({
      addEvent: {
        label: 'Tập kích cổng phía Bắc',
        chapter: 'arc_01/ch_001',
        relativeOrder: 1,
        characters: ['Nhân vật A'],
        location: 'Cổng Bắc',
        thread: 'Đội Tiên Phong',
      },
    });

    // Thêm event 2 ở Tuyến 2 diễn ra cùng relativeOrder 1 nhưng khác nhân vật
    const res = await handler({
      addEvent: {
        label: 'Đột kích kho lương phía Nam',
        chapter: 'arc_01/ch_002',
        relativeOrder: 1,
        characters: ['Nhân vật B'],
        location: 'Kho Nam',
        thread: 'Đội Biệt Kích',
      },
    });

    assert.equal(res.isError, undefined);
    assert.ok(res.content[0].text.includes('Không phát hiện mâu thuẫn thời gian'));
    assert.ok(res.content[0].text.includes('Tuyến song song'));
    assert.ok(res.content[0].text.includes('subgraph'));
  });

  await t.test('detectTimeline: phát hiện mâu thuẫn phân thân (cùng nhân vật xuất hiện 2 nơi cùng lúc)', async () => {
    const handler = tools['story_detect_timeline_conflicts'].handler;

    // Thêm event 3 có cùng Nhân vật A tại địa điểm khác ở cùng relativeOrder 1
    const res = await handler({
      addEvent: {
        label: 'Đàm phán tại Hoàng Cung',
        relativeOrder: 1,
        characters: ['Nhân vật A'],
        location: 'Hoàng Cung',
        thread: 'Ngoại Giao',
      },
    });

    assert.equal(res.isError, undefined);
    assert.ok(res.content[0].text.includes('MÂU THUẪN ĐỊA ĐIỂM (Phân Thân)'));
    assert.ok(res.content[0].text.includes('Nhân vật A'));
  });

  await t.test('story_generate_dashboard: tạo file HTML dashboard', async () => {
    const handler = tools['story_generate_dashboard'].handler;
    const res = await handler({});

    assert.equal(res.isError, undefined);
    assert.ok(res.content[0].text.includes('Đã tạo thành công Story Dashboard HTML'));

    const dashboardPath = path.join(tmpDir, 'export', 'dashboard.html');
    const exists = await fs.stat(dashboardPath).then(() => true).catch(() => false);
    assert.equal(exists, true);

    const html = await fs.readFile(dashboardPath, 'utf-8');
    assert.ok(html.includes('Thiết Lập Tuyến Song Song'));
    assert.ok(html.includes('Story Architect Dashboard'));
  });

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });
});

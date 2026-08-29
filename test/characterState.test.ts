import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { StoryProject } from '../src/server/StoryProject.js';
import { McpServer } from '@modelcontextprotocol/server';
import { registerCharacterStateTools } from '../src/tools/management/characterState.js';

test('character state tools', async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'story-charstate-test-'));
  const project = new StoryProject(tmpDir);
  await project.initializeProject({ name: 'Kiểm Tra Trạng Thái Nhân Vật' });

  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  registerCharacterStateTools(server, () => project);

  const tools = (server as any)._registeredTools || (server as any).tools;
  const handler = tools['story_track_character_state'].handler;

  await t.test('log: ghi nhận trạng thái và hành trang ban đầu', async () => {
    const res = await handler({
      character: 'Tiêu Viêm',
      chapter: 'arc_01/ch_001',
      action: 'log',
      state: {
        location: 'Ô Thản Thành - Gia Tộc',
        inventory: ['Huyền Trọng Thước', 'Nhẫn Cổ'],
        condition: 'Bình thường, tu vi suy giảm',
        status: 'alive',
        knownSecrets: ['Nhẫn có thể hấp thu đấu khí'],
      },
    });

    assert.equal(res.isError, undefined);
    assert.ok(res.content[0].text.includes('Đã ghi nhận trạng thái nhân vật "Tiêu Viêm"'));
    assert.ok(res.content[0].text.includes('Huyền Trọng Thước'));
  });

  await t.test('query: truy vấn trạng thái mới nhất', async () => {
    const res = await handler({
      character: 'Tiêu Viêm',
      action: 'query',
    });

    assert.equal(res.isError, undefined);
    assert.ok(res.content[0].text.includes('Trạng thái gần nhất của "Tiêu Viêm"'));
    assert.ok(res.content[0].text.includes('Ô Thản Thành - Gia Tộc'));
    assert.ok(res.content[0].text.includes('Huyền Trọng Thước'));
  });

  await t.test('log & history: ghi nhận thêm mốc mới và lấy toàn bộ lịch sử', async () => {
    await handler({
      character: 'Tiêu Viêm',
      chapter: 'arc_01/ch_005',
      action: 'log',
      state: {
        location: 'Ma Thú Sơn Mạch',
        inventory: ['Huyền Trọng Thước', 'Nhẫn Cổ', 'Tử Tinh Dực Sư Vương Tinh'],
        condition: 'Bị thương nhẹ sau trận chiến',
        status: 'injured',
      },
    });

    const resHistory = await handler({
      character: 'Tiêu Viêm',
      action: 'history',
    });

    assert.equal(resHistory.isError, undefined);
    assert.ok(resHistory.content[0].text.includes('Lịch Sử Trạng Thái Nhân Vật: Tiêu Viêm (2 mốc)'));
    assert.ok(resHistory.content[0].text.includes('Ma Thú Sơn Mạch'));
    assert.ok(resHistory.content[0].text.includes('injured'));
  });

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });
});

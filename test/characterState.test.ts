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

  await t.test('query: lọc đúng theo params.chapter được yêu cầu', async () => {
    // 1. Query chính xác chương cũ (ch_001) trong khi đã có ch_005
    const resExactOld = await handler({
      character: 'Tiêu Viêm',
      chapter: 'arc_01/ch_001',
      action: 'query',
    });
    assert.equal(resExactOld.isError, undefined);
    assert.ok(resExactOld.content[0].text.includes('Ô Thản Thành - Gia Tộc'));
    assert.ok(!resExactOld.content[0].text.includes('Ma Thú Sơn Mạch'));

    // 2. Query chương ở giữa chưa log (ch_003) -> lấy mốc gần nhất trước đó (ch_001)
    const resPrior = await handler({
      character: 'Tiêu Viêm',
      chapter: 'arc_01/ch_003',
      action: 'query',
    });
    assert.equal(resPrior.isError, undefined);
    assert.ok(resPrior.content[0].text.includes('Ô Thản Thành - Gia Tộc'));
    assert.ok(resPrior.content[0].text.includes('tính đến arc_01/ch_003 (mốc gần nhất tại arc_01/ch_001)'));

    // 3. Query chương trước bất kỳ mốc nào -> thông báo không tìm thấy
    const resNotFound = await handler({
      character: 'Tiêu Viêm',
      chapter: 'arc_00/ch_000',
      action: 'query',
    });
    assert.ok(resNotFound.content[0].text.includes('Không tìm thấy trạng thái nào'));

    // 4. Query không truyền chapter -> vẫn lấy mốc mới nhất (ch_005)
    const resLatest = await handler({
      character: 'Tiêu Viêm',
      action: 'query',
    });
    assert.ok(resLatest.content[0].text.includes('Ma Thú Sơn Mạch'));
  });

  await t.test('history: kèm "Biến động so với mốc trước" (diff v0.4.0)', async () => {
    const res = await handler({
      character: 'Tiêu Viêm',
      action: 'history',
    });
    assert.equal(res.isError, undefined);
    const text = res.content[0].text as string;
    // Mốc ch_005 so với ch_001: thu thêm Tử Tinh Dực Sư Vương Tinh, đổi vị trí
    assert.ok(text.includes('Biến động so với mốc trước'), 'phải có dòng diff');
    assert.ok(text.includes('Tử Tinh Dực Sư Vương Tinh'), 'diff chỉ ra vật phẩm mới thu');
  });

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });
});

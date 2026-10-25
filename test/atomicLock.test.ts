import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeJsonFile, withFileLock, lockPathFor, writeTextFileAtomic } from '../src/utils/fileUtils.js';

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `storytest-${prefix}-`));
}

test('writeTextFileAtomic: không để lại file .tmp sau khi ghi', async () => {
  const dir = await tmpDir('atomic');
  const file = path.join(dir, 'state.json');
  await writeTextFileAtomic(file, '{"a":1}\n');
  const content = await fs.readFile(file, 'utf-8');
  assert.equal(content, '{"a":1}\n');
  const leftover = (await fs.readdir(dir)).filter(f => f.includes('.tmp'));
  assert.deepEqual(leftover, []);
});

test('writeJsonFile: ghi nguyên tử JSON pretty-print', async () => {
  const dir = await tmpDir('atomicjson');
  const file = path.join(dir, 'nested', 'data.json');
  await writeJsonFile(file, { name: 'Truyện', arcs: [1, 2] });
  const raw = await fs.readFile(file, 'utf-8');
  assert.deepEqual(JSON.parse(raw), { name: 'Truyện', arcs: [1, 2] });
});

test('writeJsonFile: hai ghi liên tiếp — nội dung mới thắng, không rác .tmp', async () => {
  const dir = await tmpDir('atomicfail');
  const file = path.join(dir, 'x.json');
  await writeJsonFile(file, { keep: true });
  await writeJsonFile(file, { keep: false });
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf-8')), { keep: false });
  const leftovers = (await fs.readdir(dir)).filter(f => f.includes('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('withFileLock: serialize 30 ghi song song trên cùng file — không mất dữ liệu', async () => {
  const dir = await tmpDir('lockconcurrent');
  const file = path.join(dir, 'counter.json');
  await writeJsonFile(file, { count: 0 });

  await Promise.all(Array.from({ length: 30 }, () =>
    withFileLock(lockPathFor(file), async () => {
      const { readJsonFile } = await import('../src/utils/fileUtils.js');
      const raw = await readJsonFile<{ count: number }>(file);
      const next = (raw?.count ?? 0) + 1;
      await writeJsonFile(file, { count: next });
    })
  ));

  const final = await fs.readFile(file, 'utf-8');
  assert.equal(JSON.parse(final).count, 30);
  // Khoá được giải phóng sạch sau khi xong
  const lockDirs = (await fs.readdir(dir)).filter(f => f.endsWith('lock-dir'));
  assert.deepEqual(lockDirs, []);
});

test('withFileLock: kết quả của fn được trả về nguyên vẹn và lỗi không nuốt khoá', async () => {
  const dir = await tmpDir('lockvalue');
  const file = path.join(dir, 'v.json');
  const result = await withFileLock(lockPathFor(file), async () => ({ ok: 42 }));
  assert.deepEqual(result, { ok: 42 });

  await assert.rejects(
    () => withFileLock(lockPathFor(file), async () => { throw new Error('boom'); }),
  );
  // Khoá vẫn được giải phóng sau lỗi — lần gọi tiếp theo phải thành công
  const result2 = await withFileLock(lockPathFor(file), async () => 'retry-ok');
  assert.equal(result2, 'retry-ok');
});

test('withFileLock: khoá stale (giả định process chủ sập) bị mượn khi TTL thấp', async () => {
  const dir = await tmpDir('stale');
  const lock = path.join(dir, 'state.json.lock-dir');
  // Tạo khoá "ma" có mtime cũ — mô phỏng process chủ đã sập hơn 1 phút
  await fs.mkdir(lock);
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(lock, old, old);

  // acquireDirLock so sánh mtime với staleTtlMs — TTL 100ms ⇒ khoá bị mượn ngay
  const result = await withFileLock(lock, async () => 'took-over', { staleTtlMs: 100, timeoutMs: 2000 });
  assert.equal(result, 'took-over');
});

test('withFileLock: timeout khi khoá bị chiếm bởi một task dài (trong cùng process, lỗi 2 tầng không treo)', async () => {
  const dir = await tmpDir('locktimeout');
  const file = path.join(dir, 'busy.json');
  // Tầng on-disk bị chiếm bởi "process khác" — mô phỏng bằng mkdir trực tiếp
  await fs.mkdir(lockPathFor(file));
  await assert.rejects(
    () => withFileLock(
      lockPathFor(file),
      async () => { throw new Error('không bao giờ chạy tới đây'); },
      { timeoutMs: 300 },
    ),
    /Không chiếm được file lock/,
  );
  // Dọn khoá để nhánh test khác không chạm vào
  await fs.rm(lockPathFor(file), { recursive: true, force: true });
});

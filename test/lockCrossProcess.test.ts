import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as url from 'node:url';

const repoRoot = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const distFileUtils = path.join(repoRoot, 'dist', 'utils', 'fileUtils.js');

/**
 * P1.2 của v0.4.0 — Test tranh chấp lock VƯỢT RANH GIỚI process.
 *
 * 4 tiến trình con cùng chạy vòng RMW trên cùng 1 counter JSON:
 * withFileLock (tầng on-disk lock dir) phải serialize để tổng cộng đúng N×K.
 * Test ở v0.3.0 chỉ phủ in-process mutex — tầng on-disk trước giờ
 * chưa có phòng chống regression.
 */
test('withFileLock: 4 process × 10 RMW → counter đúng 40 (cross-process)', async (t) => {
  // Skip khi chưa build dist (dù vậy CI vẫn chạy sau tsc)
  try {
    await fs.access(distFileUtils);
  } catch {
    t.skip('dist chưa build — chạy npm run build trước');
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'story-upcrossproc-'));
  const counterPath = path.join(tmpDir, 'counter.json');
  await fs.writeFile(counterPath, JSON.stringify({ n: 0 }), 'utf-8');

  // Kịch bản con: 10 vòng RMW, nghỉ ngẫu nhiên giữa phần đọc-ghi để phơi bày
  // khoảng trống RMW nếu thiếu khoá.
  const script = `
import { withFileLock } from ${JSON.stringify(distFileUtils)};
import * as fs from 'node:fs/promises';
const file = process.argv[2];
for (let i = 0; i < 10; i++) {
  await withFileLock(file + '.lock-dir', async () => {
    let cur = 0;
    try { cur = JSON.parse(await fs.readFile(file, 'utf-8')).n || 0; } catch {}
    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 25)));
    await fs.writeFile(file, JSON.stringify({ n: cur + 1 }));
  });
}
`;
  const scriptPath = path.join(tmpDir, 'worker.mjs');
  await fs.writeFile(scriptPath, script, 'utf-8');

  const procs = [
    spawn(process.execPath, [scriptPath, counterPath], { stdio: ['ignore', 'pipe', 'pipe'] }),
    spawn(process.execPath, [scriptPath, counterPath], { stdio: ['ignore', 'pipe', 'pipe'] }),
    spawn(process.execPath, [scriptPath, counterPath], { stdio: ['ignore', 'pipe', 'pipe'] }),
    spawn(process.execPath, [scriptPath, counterPath], { stdio: ['ignore', 'pipe', 'pipe'] }),
  ];
  const codes = await Promise.all(procs.map(p => new Promise<{ code: number; stderr: string }>((resolve) => {
    let stderr = '';
    p.stderr.on('data', d => { stderr += d.toString(); });
    p.on('close', code => resolve({ code, stderr }));
  })));

  for (const { code, stderr } of codes) {
    assert.equal(code, 0, `worker lỗi: ${stderr}`);
  }

  const final = JSON.parse(await fs.readFile(counterPath, 'utf-8'));
  assert.equal(final.n, 40, 'RMW song song 4 process phải serialize hoàn toàn bằng lock on-disk');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { StoryProject } from '../src/server/StoryProject.js';

const TMP = '/tmp/opencode/unit-story';

async function freshProject(name = 'Unit Novel'): Promise<StoryProject> {
  const dir = path.join(TMP, `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const p = new StoryProject(dir);
  await p.initializeProject({ name, targetWordCount: 1000 });
  return p;
}

test('initializeProject: tạo đầy đủ cấu trúc', async () => {
  const p = await freshProject();
  for (const d of ['.story', '.cbm', 'bible/characters', 'bible/world', 'manuscript/arc_01', 'outline', 'drafts_raw']) {
    await fs.access(path.join(p.projectPath, d));
  }
  assert.equal(await p.isInitialized(), true);
});

test('recordWritingProgress: ghi nhận delta theo ngày', async () => {
  const p = await freshProject();
  assert.equal((await p.recordWritingProgress()).totalWordCount, 0);

  await fs.writeFile(path.join(p.manuscriptDir, 'arc_01', 'ch_001.md'), Array(100).fill('từ').join(' '));
  const rec1 = await p.recordWritingProgress();
  assert.equal(rec1.writingLog.length, 1);
  assert.equal(rec1.writingLog[0].wordsWritten, 100);

  // Không thay đổi → không thêm entry
  const rec2 = await p.recordWritingProgress();
  assert.equal(rec2.writingLog.length, 1);

  // Thêm nữa cùng ngày → gộp delta
  await fs.appendFile(path.join(p.manuscriptDir, 'arc_01', 'ch_001.md'), ' ' + Array(50).fill('từ').join(' '));
  const rec3 = await p.recordWritingProgress();
  assert.equal(rec3.writingLog[0].wordsWritten, 150);
});

test('getCharacter: parse YAML bằng gray-matter', async () => {
  const p = await freshProject();
  await fs.writeFile(path.join(p.bibleDir, 'characters', 'linh_hon.md'), `---
name: "Linh Hồn"
role: "antagonist"
aliases:
  - "LHS"
goals:
  - "Trả thù"
---

# Linh Hồn

Thân thế bí ẩn.
`);
  const c = await p.getCharacter('linh_hon');
  assert.ok(c);
  assert.equal(c.frontmatter.role, 'antagonist');
  assert.deepEqual(c.frontmatter.aliases, ['LHS']);
  assert.equal(c.frontmatter.goals?.[0], 'Trả thù');
  assert.ok(!c.content.includes('---'));
});

test('getChapterContent: chặn path traversal', async () => {
  const p = await freshProject();
  await fs.writeFile(path.join(p.projectPath, 'secret.txt'), 'secret');
  assert.equal(await p.getChapterContent('arc_01', '../../../secret'), null);
  assert.equal(await p.getChapterContent('../../secret', 'x'), null);
  assert.deepEqual(await p.listChaptersInArc('../..'), []);
});

test('getStatus: tính toán live word count', async () => {
  const p = await freshProject();
  await fs.writeFile(path.join(p.manuscriptDir, 'arc_01', 'ch_001.md'), Array(200).fill('từ').join(' '));
  const status = await p.getStatus();
  assert.equal(status.totalWordCount, 200);
  assert.equal(status.chapterCount, 1);
  assert.equal(status.arcCount, 1);
});

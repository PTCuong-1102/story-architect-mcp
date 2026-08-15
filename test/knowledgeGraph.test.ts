import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, searchEntities, expandRelationships } from '../src/utils/knowledgeGraph.js';
import { StoryProject } from '../src/server/StoryProject.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

async function makeProject(): Promise<StoryProject> {
  const dir = path.join('/tmp/opencode/unit-kg', `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(path.join(dir, 'bible', 'characters'), { recursive: true });
  await fs.mkdir(path.join(dir, 'bible', 'world'), { recursive: true });
  await fs.mkdir(path.join(dir, '.story'), { recursive: true });

  await fs.writeFile(path.join(dir, 'bible', 'characters', 'tieu_viem.md'), `---
name: "Tiêu Viêm"
aliases: ["LV"]
---
# Tiêu Viêm
Thiên tài chiến lực tại Thanh Vân Sơn.
`);
  await fs.writeFile(path.join(dir, 'bible', 'characters', 'na_lan.md'), `---
name: "Na Lan"
---
# Na Lan
Đối thủ truyền kiếp của Tiêu Viêm.
`);
  await fs.writeFile(path.join(dir, 'bible', 'world', 'thanh_van_son.md'), `---
name: "Thanh Vân Sơn"
---
# Thanh Vân Sơn
Ngọn núi nơi Tiêu Viêm tu luyện.
`);
  await fs.writeFile(path.join(dir, '.story', 'relationships.json'), JSON.stringify({
    relationships: [
      { source: 'Tiêu Viêm', target: 'Na Lan', type: 'rival', description: 'Đối thủ', evolution: [] },
      { source: 'Na Lan', target: 'Hắc Vũ', type: 'ally', description: 'Đồng minh', evolution: [] },
    ],
    updatedAt: new Date().toISOString(),
  }));

  return new StoryProject(dir);
}

test('buildIndex: đọc đúng tên hiển thị từ frontmatter', async () => {
  const p = await makeProject();
  const index = await buildIndex(p);
  const names = index.characters.map(c => c.name);
  assert.ok(names.includes('Tiêu Viêm'));
  assert.ok(names.includes('Na Lan'));
  assert.ok(index.worldEntries.some(w => w.name === 'Thanh Vân Sơn'));
  assert.equal(index.relationships.length, 2);
});

test('searchEntities: khớp tên và alias', async () => {
  const p = await makeProject();
  const index = await buildIndex(p);
  const byName = searchEntities(index, 'Tiêu Viêm');
  assert.equal(byName[0].name, 'Tiêu Viêm');
  assert.equal(byName[0].score, 1.0);

  const byAlias = searchEntities(index, 'LV');
  assert.ok(byAlias.some(m => m.name === 'Tiêu Viêm'));
});

test('expandRelationships: BFS mở rộng quan hệ', async () => {
  const p = await makeProject();
  const index = await buildIndex(p);
  const { edges, relatedNames } = expandRelationships(index, ['Tiêu Viêm'], 2);
  assert.ok(edges.some(e => e.source === 'Tiêu Viêm' && e.target === 'Na Lan'));
  assert.ok(edges.some(e => e.source === 'Na Lan' && e.target === 'Hắc Vũ'));
  assert.ok(relatedNames.includes('Hắc Vũ'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { StoryProject } from '../src/server/StoryProject.js';

async function tmpProject(prefix: string): Promise<StoryProject> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `storytest-${prefix}-`));
  return new StoryProject(dir);
}

test('updateRelationships: RMW toàn bộ trong khoá — ghi một mũi thành công', async () => {
  const project = await tmpProject('mutator');
  const result = await project.updateRelationships(cur => ({
    ...cur,
    relationships: [
      ...cur.relationships,
      { source: 'Linh Hồn', target: 'Trăng Trang', type: 'ally', description: 'Đồng đội', evolution: [] },
    ],
  }));
  assert.equal(result.relationships.length, 1);
  const onDisk = await project.getRelationships();
  assert.equal(onDisk.relationships.length, 1);
  assert.equal(onDisk.relationships[0].source, 'Linh Hồn');
});

test('updateRelationships: 30 song song không mất mũi nào (lost-update đã đóng)', async () => {
  const project = await tmpProject('mutatorconc');
  await Promise.all(Array.from({ length: 30 }, (_, i) =>
    project.updateRelationships(cur => ({
      ...cur,
      relationships: [
        ...cur.relationships,
        { source: `A${i}`, target: `B${i}`, type: 'ally', description: '', evolution: [] },
      ],
    }))
  ));
  const final = await project.getRelationships();
  assert.equal(final.relationships.length, 30, 'Mọi RMW có lock không được mất');

  const stored = JSON.parse(await fs.readFile(path.join(project.projectPath, '.story', 'relationships.json'), 'utf-8'));
  assert.equal(stored.relationships.length, 30);
  const names = new Set(stored.relationships.map((r: { source: string }) => r.source));
  for (let i = 0; i < 30; i++) assert.ok(names.has(`A${i}`), `Thiếu A${i}`);
});

test('updateForeshadowing + updatePlotHoles: RMW song song giữa các file khác nhau — không tranh chấp', async () => {
  const project = await tmpProject('mutatorsplit');
  const [fired, holes] = await Promise.all([
    project.updateForeshadowing(cur => ({
      ...cur,
      items: [...cur.items, {
        id: 'fp1', setup: 'Áo bào rách', setupChapter: 'arc_01/ch_001',
        status: 'planted', importance: 'major', createdAt: new Date().toISOString(),
      }],
    })),
    project.updatePlotHoles(cur => ({
      ...cur,
      holes: [...cur.holes, {
        id: 'ph1', title: 'Tuổi không khớp', description: '', severity: 'high',
        chapters: [], createdAt: new Date().toISOString(), status: 'open',
      }],
    })),
  ]);
  assert.equal(fired.items.length, 1);
  assert.equal(holes.holes.length, 1);
  assert.equal((await project.getForeshadowing()).items.length, 1);
  assert.equal((await project.getPlotHoles()).holes.length, 1);
});

test('updateTimeline: add 2 event song song — cả hai đều xuất hiện', async () => {
  const project = await tmpProject('mutatortime');
  await Promise.all(['Về thôn cũ', 'Đổ nát thành'].map(label =>
    project.updateTimeline(cur => ({
      ...cur,
      events: [...cur.events, {
        id: 'evt_' + label, label, description: '', relativeOrder: 0, characters: [],
      }],
    }))
  ));
  const final = await project.getTimeline();
  assert.equal(final.events.length, 2);
});

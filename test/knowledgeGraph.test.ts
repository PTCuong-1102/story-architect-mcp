import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, searchEntities, expandRelationships, findShortestPath, computeGodNodes, provenanceTag, resolveNodeName } from '../src/utils/knowledgeGraph.js';
import { extractCapitalizedTerms, registerExtractEntitiesTool } from '../src/tools/graph/extractEntities.js';
import { StoryProject } from '../src/server/StoryProject.js';
import { McpServer } from '@modelcontextprotocol/server';
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
      { source: 'Tiêu Viêm', target: 'Na Lan', type: 'rival', description: 'Đối thủ', provenance: 'extracted', evolution: [] },
      { source: 'Na Lan', target: 'Hắc Vũ', type: 'ally', description: 'Đồng minh', provenance: 'inferred', evolution: [] },
      { source: 'Bóng Ma', target: 'Bóng Ma', type: 'other', description: 'Tự liên hệ (bỏ qua khi dựng đồ thị)', evolution: [] },
    ],
    updatedAt: new Date().toISOString(),
  }));

  await fs.writeFile(path.join(dir, '.story', 'config.json'), JSON.stringify({
    name: 'Đấu Phá',
    author: 'Thiên Tằm',
    genre: ['Tiên Hiệp'],
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
  assert.equal(index.relationships.length, 3);
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

test('provenance: EXTRACTED/INFERRED đi xuyên suốt buildIndex → BFS', async () => {
  const p = await makeProject();
  const index = await buildIndex(p);
  const byPair = new Map(index.relationships.map(r => [`${r.source}|${r.target}`, r.provenance]));
  assert.equal(byPair.get('Tiêu Viêm|Na Lan'), 'extracted');
  assert.equal(byPair.get('Na Lan|Hắc Vũ'), 'inferred');

  const { edges } = expandRelationships(index, ['Tiêu Viêm'], 2);
  const edgeProv = new Map(edges.map(e => [`${e.source}|${e.target}`, e.provenance]));
  assert.equal(edgeProv.get('Tiêu Viêm|Na Lan'), 'extracted');
  assert.equal(edgeProv.get('Na Lan|Hắc Vũ'), 'inferred');

  assert.equal(provenanceTag('extracted'), 'EXTRACTED');
  assert.equal(provenanceTag('inferred'), 'INFERRED');
  assert.equal(provenanceTag(undefined), 'LEGACY');
  assert.equal(provenanceTag('gia-tri-la'), 'LEGACY');
});

test('findShortestPath: đường 2 hops Tiêu Viêm → Hắc Vũ qua Na Lan', async () => {
  const p = await makeProject();
  const index = await buildIndex(p);
  const path = findShortestPath(index, 'Tiêu Viêm', 'Hắc Vũ');
  assert.ok(path, 'phải tìm được đường đi');
  assert.deepEqual(path.nodes, ['Tiêu Viêm', 'Na Lan', 'Hắc Vũ']);
  assert.equal(path.edges.length, 2);
  assert.equal(path.edges[0].type, 'rival');
  assert.equal(path.edges[1].type, 'ally');
});

test('findShortestPath: cùng nút, tên alias, tên không tồn tại', async () => {
  const p = await makeProject();
  const index = await buildIndex(p);

  const self = findShortestPath(index, 'Tiêu Viêm', 'tiêu viêm');
  assert.ok(self);
  assert.equal(self.edges.length, 0);

  const viaAlias = findShortestPath(index, 'LV', 'Hắc Vũ');
  assert.ok(viaAlias, 'alias LV phải resolve về Tiêu Viêm');
  assert.equal(viaAlias.nodes[0], 'Tiêu Viêm');

  assert.equal(findShortestPath(index, 'Tiêu Viêm', 'Người Không Tồn Tại'), null);
});

test('resolveNodeName: khớp mờ không phân biệt hoa thường', async () => {
  const p = await makeProject();
  const index = await buildIndex(p);
  assert.equal(resolveNodeName(index, 'na lan')?.display, 'Na Lan');
  assert.equal(resolveNodeName(index, 'Ai Đó Xa Lạ'), null);
});

test('computeGodNodes: Na Lan trung tâm nhất, gộp tên trùng hoa/thường', () => {
  const nodes = computeGodNodes([
    { source: 'Tiêu Viêm', target: 'Na Lan' },
    { source: 'Na Lan', target: 'Hắc Vũ' },
    { source: 'Na Lan', target: 'Bóng Ma' },
    { source: 'TIÊU VIÊM', target: 'Hắc Vũ' },
  ], 5);
  // Na Lan kề 3 nút (Tiêu Viêm, Hắc Vũ, Bóng Ma) → đứng đầu
  assert.equal(nodes[0].name, 'Na Lan');
  assert.equal(nodes[0].degree, 3);
  // "Tiêu Viêm" + "TIÊU VIÊM" gộp thành 1 nút duy nhất, bậc 2
  const tieuViem = nodes.filter(n => n.name === 'Tiêu Viêm');
  assert.equal(tieuViem.length, 1);
  assert.equal(tieuViem[0].degree, 2);
});

test('extractCapitalizedTerms: nhận diện đầy đủ chữ hoa tiếng Việt Ă, Ế, Ơ, Ư', () => {
  const sampleText = `
    Ưng Vô Nhai xuất hiện cùng Ếch Ngồi Đáy Giếng tại Ơn Nghĩa Sơn.
    Sau đó, Ưng Vô Nhai lại đến Ơn Nghĩa Sơn để gặp lại người xưa.
    Ếch Ngồi Đáy Giếng cũng đã xuất hiện lần hai tại hội nghị.
  `;
  const result = extractCapitalizedTerms(sampleText);
  assert.ok(result.names.includes('Ưng Vô Nhai'), 'Phải trích xuất được tên bắt đầu bằng Ư');
  assert.ok(result.names.includes('Ếch Ngồi Đáy Giếng'), 'Phải trích xuất được tên bắt đầu bằng Ế');
  assert.ok(result.locations.includes('Ơn Nghĩa Sơn'), 'Phải trích xuất được địa danh bắt đầu bằng Ơ');
});

test('story_extract_entities_to_bible: sanitize tên file an toàn khi entity chứa ký tự đặc biệt', async () => {
  const p = await makeProject();
  await fs.mkdir(path.join(p.manuscriptDir, 'arc_01'), { recursive: true });
  await fs.writeFile(
    path.join(p.manuscriptDir, 'arc_01', 'ch_001.md'),
    'Kiếm Khách Lãng Tử xuất hiện. Kiếm Khách Lãng Tử rút kiếm.',
    'utf-8'
  );

  const server = new McpServer({ name: 'test', version: '1.0' });
  registerExtractEntitiesTool(server, () => p);
  const tools = (server as any)._registeredTools || (server as any).tools;
  const handler = tools['story_extract_entities_to_bible'].handler;

  const res = await handler({ arc: 'arc_01', chapter: 'ch_001', confirm: true });
  assert.equal(res.isError, undefined);
  assert.ok(res.content[0].text.includes('Đã tạo các thực thể mới vào Bible thành công'));
  assert.ok(res.content[0].text.includes('Nhân vật mới đã tạo: 1'));

  // Kiểm tra file được tạo trong bible/characters với tên an toàn
  const createdFile = path.join(p.bibleDir, 'characters', 'kiếm_khách_lãng_tử.md');
  const fileExists = await fs.access(createdFile).then(() => true).catch(() => false);
  assert.ok(fileExists, 'File entity được tạo đúng tên an toàn');
});

test('buildAdjacency & findShortestPath: giữ đúng góc nhìn quan hệ 2 chiều khác type', async () => {
  const p = await makeProject();
  await fs.writeFile(path.join(p.projectPath, '.story', 'relationships.json'), JSON.stringify({
    relationships: [
      { source: 'Tiêu Viêm', target: 'Na Lan', type: 'rival', description: 'Coi là kình địch' },
      { source: 'Na Lan', target: 'Tiêu Viêm', type: 'lover', description: 'Thầm ngưỡng mộ' },
    ],
    updatedAt: new Date().toISOString(),
  }));

  const index = await buildIndex(p);
  const pathAtoB = findShortestPath(index, 'Tiêu Viêm', 'Na Lan');
  assert.ok(pathAtoB);
  assert.equal(pathAtoB.edges[0].source, 'Tiêu Viêm');
  assert.equal(pathAtoB.edges[0].type, 'rival');

  const pathBtoA = findShortestPath(index, 'Na Lan', 'Tiêu Viêm');
  assert.ok(pathBtoA);
  assert.equal(pathBtoA.edges[0].source, 'Na Lan');
  assert.equal(pathBtoA.edges[0].type, 'lover');
});



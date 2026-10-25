import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchEntities,
  resolveNodeName,
  levenshtein,
  type KnowledgeGraphIndex,
} from '../src/utils/knowledgeGraph.js';

const INDEX: KnowledgeGraphIndex = {
  characters: [
    {
      name: 'Linh Hồn',
      fileKey: 'linh_hon',
      aliases: ['Tiểu Hồn', 'nhóc Hồn'],
      terms: ['linh', 'hồn', 'kiếm', 'khí'],
      contentPreview: '...',
    },
    {
      name: 'Trăng Trang',
      fileKey: 'trang_trang',
      aliases: [],
      terms: ['trăng', 'trang', 'võ', 'thi'],
      contentPreview: '...',
    },
  ],
  worldEntries: [
    { name: 'Thanh Vân Sơn', terms: ['thanh', 'vân', 'sơn', 'tông'], contentPreview: '...' },
  ],
  relationships: [
    { source: 'Linh Hồn', target: 'Thanh Vân Sơn', type: 'ally', description: 'Quê hương', provenance: 'extracted' },
  ],
  timelineEvents: [],
  builtAt: new Date().toISOString(),
};

test('levenshtein: giá trị chuẩn', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('trang', 'trăng'.normalize('NFD').replace(/[\u0300-\u036f]/g, '')), 0);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('abc', 'abc'), 0);
});

test('searchEntities: khớp chuẩn không đổi so với v0.2', () => {
  const hits = searchEntities(INDEX, 'Linh Hồn');
  assert.equal(hits[0]?.name, 'Linh Hồn');
  assert.equal(hits[0]?.score, 1.0);
});

test('searchEntities: sai chính tả nhẹ vẫn khớp (fuzzy)', () => {
  const hits = searchEntities(INDEX, 'Linh Hn'); // Hồn → Hn (thiếu 'o') sai 1 ký tự
  assert.ok(hits.some(h => h.name === 'Linh Hồn'), `mong 'Linh Hồn', thấy: ${JSON.stringify(hits)}`);
});

test('searchEntities: gõ thiếu dấu tiếng Việt vẫn khớp theo key không dấu', () => {
  const hits = searchEntities(INDEX, 'thanh van son');
  assert.ok(hits.some(h => h.name === 'Thanh Vân Sơn'));
});

test('searchEntities: không match rác không liên quan', () => {
  const hits = searchEntities(INDEX, 'zzzqqq');
  assert.deepEqual(hits, []);
});

test('resolveNodeName: alias gõ thiếu dấu tiếng Việt', () => {
  const r = resolveNodeName(INDEX, 'nhoc hon'); // "nhóc Hồn" không dấu
  assert.ok(r, 'alias "nhóc Hồn" gõ thiếu dấu phải resolve được');
  if (r) assert.equal(r.display, 'Linh Hồn');
});

test('resolveNodeName: query chênh một ký tự vẫn ra (fuzzy)', () => {
  const r = resolveNodeName(INDEX, 'Trăng Trangg'); // Trang → Trangg (thừa 'g')
  assert.ok(r, '"Trăng Trangg" nên fuzzy khớp "Trăng Trang"');
  if (r) assert.equal(r.display, 'Trăng Trang');
});

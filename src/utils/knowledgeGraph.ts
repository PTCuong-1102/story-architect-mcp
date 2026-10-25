import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import matter from 'gray-matter';
import { StoryProject } from '../server/StoryProject.js';
import { writeJsonFile, readTextFile, walkDir, computePathsFingerprint } from './fileUtils.js';

// ============================================================
// Knowledge Graph nội bộ (mô phỏng tích hợp codebase-memory-mcp)
//
// Đóng vai trò "graph memory": xây index từ Bible + Relationships + Timeline
// vào .cbm/index.json (cache), tìm kiếm thực thể theo query, và mở rộng
// quan hệ (BFS) qua đồ thị nhân vật.
// ============================================================

export interface GraphCharacter {
  /** Tên hiển thị (frontmatter name nếu có, ngược lại là tên file). */
  name: string;
  /** Khóa file dùng để truy xuất hồ sơ qua getCharacter. */
  fileKey: string;
  aliases: string[];
  terms: string[];
  contentPreview: string;
}

export interface GraphWorldEntry {
  name: string;
  terms: string[];
  contentPreview: string;
}

export interface GraphRelationshipEdge {
  source: string;
  target: string;
  type: string;
  description: string;
  /** Nguồn gốc: 'extracted' (người khẳng định) | 'inferred' (máy suy ra) | undefined (dữ liệu cũ). */
  provenance?: string;
}

export interface KnowledgeGraphIndex {
  characters: GraphCharacter[];
  worldEntries: GraphWorldEntry[];
  relationships: GraphRelationshipEdge[];
  timelineEvents: { label: string; description: string }[];
  builtAt: string;
  /**
   * v0.4.0: fingerprint stat của nguồn dữ liệu khi build (bible, relationships,
   * timeline). loadOrBuildIndex so khớp fingerprint trước khi tin cache —
   * file bị sửa từ ngoài editor không cần gọi rebuildIndex thủ công nữa.
   */
  sourceFingerprint?: string;
}

const STOPWORDS = new Set([
  'của', 'và', 'trong', 'một', 'những', 'đã', 'đang', 'sẽ', 'là', 'cho', 'với', 'các',
  'có', 'không', 'này', 'đó', 'tại', 'theo', 'sau', 'trước', 'khi', 'vì', 'ra', 'vào',
  'the', 'and', 'of', 'to', 'a', 'an', 'in', 'on', 'for', 'with', 'is', 'are', 'was',
]);

/** Tách từ khóa (lowercase, lọc stopwords, bỏ ký tự thừa). */
function extractTerms(text: string): string[] {
  const tokens = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 1);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const t of tokens) {
    if (STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    terms.push(t);
  }
  return terms;
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Khoá "không dấu" dùng cho đồ thị & search:
 * NFD + strip combining marks + đ→d + lowercase.
 * "Trăng" ≡ "trang", "Linh Hồn" ≡ "linh hon" — alias gõ thiếu dấu vẫn khớp.
 */
function normalizeKey(s: string): string {
  return normalize(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

/** Khoảng cách Levenshtein (DP cột đơn — O(min(m,n)) bộ nhớ). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Fuzzy threshold: cho phép sai khác ký tự phụ thuộc độ dài tên
 * (tên ≥4 ký tự sai 1, ≥8 ký tự sai tới 2) — phủ chính tả sai/viết tắt.
 */
function fuzzyMatches(a: string, b: string): boolean {
  const maxDist = Math.min(2, Math.floor(Math.min(a.length, b.length) / 4));
  return maxDist >= 1 && levenshtein(a, b) <= maxDist;
}

/** Số token trùng giữa query và danh sách terms của thực thể. */
function termOverlap(query: string, terms: string[]): number {
  const qTokens = extractTerms(query);
  let count = 0;
  for (const t of qTokens) {
    if (terms.includes(t)) count++;
  }
  return count;
}

// ============================================================
// v0.5.0 — BM25 ranking cho khớp theo terms (zero-dep)
// ============================================================

/**
 * BM25 — xếp hạng theo trọng số rare-term: từ hiếm ("phượng hoàng",
 * "thiên tài thuần khiết") quyết định nhiều hơn từ phổ thông ("nhân vật",
 * "cô gái"). Thay termOverlap nguyên thủy (đếm trùng không trọng số)
 * ở bậc 4 của searchEntities — bậc 1–3 (tên/alias/fuzzy) vẫn ưu tiên hơn.
 *
 * Docs là danh sách tokens (KHÔNG dedup — tf có nghĩa), tokens đã fold
 * không dấu. avgdl đo theo token; k1=1.2, b=0.75 (giá trị chuẩn).
 */
export interface Bm25Doc {
  id: string;
  tokens: string[];
}

export function bm25Rank(query: string, docs: Bm25Doc[], k1 = 1.2, b = 0.75): Map<string, number> {
  const scores = new Map<string, number>();
  if (docs.length === 0) return scores;

  // Tokens query phải fold không dấu cùng phía với doc tokens (so khớp "kiếm" ≡ "kiem")
  const qTokens = extractTerms(query).map(normalizeKey);
  if (qTokens.length === 0) return scores;

  const totalLen = docs.reduce((s, d) => s + d.tokens.length, 0);
  const avgdl = totalLen / docs.length || 1;

  // df từng token trong corpus
  const df = new Map<string, number>();
  for (const d of docs) {
    const seen = new Set(d.tokens);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = docs.length;

  for (const d of docs) {
    if (d.tokens.length === 0) continue;
    // tf trong doc này
    const tf = new Map<string, number>();
    for (const t of d.tokens) tf.set(t, (tf.get(t) || 0) + 1);

    let score = 0;
    for (const qt of qTokens) {
      const f = tf.get(qt);
      if (!f) continue;
      const docFreq = df.get(qt) || 0;
      const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.tokens.length) / avgdl)));
    }
    if (score > 0) scores.set(d.id, score);
  }
  return scores;
}


export function buildIndex(project: StoryProject): Promise<KnowledgeGraphIndex> {
  return (async () => {
    const characters: GraphCharacter[] = [];
    for (const fileKey of await project.listCharacters()) {
      const profile = await project.getCharacter(fileKey);
      const content = profile ? `${profile.content}\n${JSON.stringify(profile.frontmatter)}` : fileKey;
      const fmName = profile?.frontmatter?.name;
      characters.push({
        name: typeof fmName === 'string' && fmName.trim() ? fmName.trim() : fileKey,
        fileKey,
        aliases: (profile?.frontmatter?.aliases as string[] | undefined) || [],
        terms: extractTerms(content),
        contentPreview: (profile?.content || '').slice(0, 400),
      });
    }

    const worldEntries: GraphWorldEntry[] = [];
    const worldDir = path.join(project.bibleDir, 'world');
    for (const fileName of await project.listWorldEntries()) {
      const raw = await readTextFile(path.join(worldDir, `${fileName}.md`));
      const parsed = raw ? matter(raw) : null;
      const fmName = parsed?.data?.name;
      const content = parsed ? parsed.content : (await project.getWorldEntry(fileName) || fileName);
      worldEntries.push({
        name: typeof fmName === 'string' && fmName.trim() ? fmName.trim() : fileName,
        terms: extractTerms(content),
        contentPreview: content.slice(0, 400),
      });
    }

    const rels = await project.getRelationships();
    const timeline = await project.getTimeline();

    return {
      characters,
      worldEntries,
      relationships: rels.relationships.map(r => ({
        source: r.source,
        target: r.target,
        type: r.type,
        description: r.description,
        provenance: r.provenance,
      })),
      timelineEvents: timeline.events.map(e => ({ label: e.label, description: e.description })),
      builtAt: new Date().toISOString(),
      sourceFingerprint: await computeSourceFingerprint(project),
    };
  })();
}

/**
 * v0.4.0 — Fingerprint các nguồn dữ liệu của graph: mọi file .md trong bible/
 * (characters + world + subplots), relationships.json, timeline.json.
 * File thay đổi ngoài tool (sửa tay, editor) đổi mtime → fingerprint lệch →
 * cache bị coi là cũ ngay ở lần query kế.
 */
export async function computeSourceFingerprint(project: StoryProject): Promise<string> {
  const bibleFiles = await walkDir(project.bibleDir, ['.md']);
  const stateFiles = [
    path.join(project.projectPath, '.story', 'relationships.json'),
    path.join(project.projectPath, '.story', 'timeline.json'),
  ];
  return computePathsFingerprint([...bibleFiles, ...stateFiles]);
}

/**
 * Xóa cache .cbm/index.json để lần query tới build lại từ dữ liệu mới.
 * Gọi sau mọi thao tác ghi vào bible/relationships/timeline (nếu không
 * story_query_context sẽ phục vụ đồ thị cũ). Không throw khi xóa lỗi.
 */
export async function invalidateIndex(project: StoryProject): Promise<void> {
  try {
    await fs.unlink(path.join(project.projectPath, '.cbm', 'index.json'));
  } catch {
    // cache chưa tồn tại — không có gì để xóa
  }
}

/**
 * Đọc cache .cbm/index.json nếu còn "tươi" (fingerprint nguồn khớp),
 * ngược lại build mới và ghi cache.
 *
 * v0.4.0: cache thiếu `sourceFingerprint` (dữ liệu cũ từ < 0.4.0) luôn bị
 * coi cũ → rebuild một lần rồi cache mới có fingerprint. Result khi
 * forceRebuild=true cũng như fingerprint lệch (bible/state bị sửa từ ngoài).
 */
export async function loadOrBuildIndex(project: StoryProject, forceRebuild = false): Promise<KnowledgeGraphIndex> {
  if (!forceRebuild) {
    const cachePath = path.join(project.projectPath, '.cbm', 'index.json');
    let cached: KnowledgeGraphIndex | null = null;
    try {
      const raw = await fs.readFile(cachePath, 'utf-8');
      cached = JSON.parse(raw) as KnowledgeGraphIndex;
    } catch {
      // cache không tồn tại hoặc hỏng → build mới
    }

    // Cache chỉ được tin khi fingerprint nguồn khớp tình trạng hiện tại
    if (cached && cached.sourceFingerprint) {
      if (cached.sourceFingerprint === await computeSourceFingerprint(project)) {
        return cached;
      }
      // fingerprint lệch (bible/state bị sửa từ ngoài) → rơi xuống build mới
    }
  }

  const index = await buildIndex(project);
  try {
    await writeJsonFile(path.join(project.projectPath, '.cbm', 'index.json'), index);
  } catch {
    // không ghi được cache thì vẫn trả về index
  }
  return index;
}

export interface EntityMatch {
  kind: 'character' | 'world';
  name: string;
  /** Khóa file để truy xuất hồ sơ (character). */
  ref?: string;
  score: number;
}

/** Tìm kiếm thực thể (nhân vật / bối cảnh) khớp với query. */
export function searchEntities(index: KnowledgeGraphIndex, query: string): EntityMatch[] {
  const q = normalizeKey(query);
  const results: EntityMatch[] = [];

  // v0.5.0 — BM25 corpus: tokens fold-không-dấu của mọi thực thể (raw,
  // không dedup nên tf có nghĩa). BM25 chỉ dùng ở bậc 4 — bậc 1–3
  // (tên/alias/fuzzy) vẫn ưu tiên hơn, giữ hành vi cũ.
  const charDocs: Bm25Doc[] = index.characters.map(c => ({
    id: c.name,
    tokens: [...c.terms, ...c.aliases].map(normalizeKey).filter(Boolean).flatMap(t => t.split(' ')),
  }));
  const worldDocs: Bm25Doc[] = index.worldEntries.map(w => ({
    id: w.name,
    tokens: w.terms.map(normalizeKey).filter(Boolean).flatMap(t => t.split(' ')),
  }));
  const charScores = bm25Rank(query, charDocs);
  const worldScores = bm25Rank(query, worldDocs);
  const toScore = (raw: number): number => Math.min(0.4, (raw / (raw + 2)) * 0.4);

  for (const c of index.characters) {
    const nameKey = normalizeKey(c.name);
    const aliasKeys = c.aliases.map(normalizeKey);
    let score = 0;
    if (nameKey === q) score = 1.0;
    else if (nameKey.includes(q) || q.includes(nameKey)) score = 0.8;
    else if (aliasKeys.some(a => a === q || a.includes(q) || q.includes(a))) score = 0.6;
    // Fuzzy Levenshtein: query sai chính tả/thiếu dấu vẫn khớp (score 0.5)
    else if (q.length >= 4 && (fuzzyMatches(nameKey, q) || aliasKeys.some(a => fuzzyMatches(a, q)))) score = 0.5;
    // v0.5.0: BM25 (idf-weighted) thay đếm trùng tuyến tính
    else score = toScore(charScores.get(c.name) || 0);
    if (score > 0) results.push({ kind: 'character', name: c.name, ref: c.fileKey, score });
  }

  for (const w of index.worldEntries) {
    const nameKey = normalizeKey(w.name);
    let score = 0;
    if (nameKey === q) score = 1.0;
    else if (nameKey.includes(q) || q.includes(nameKey)) score = 0.8;
    else if (q.length >= 4 && fuzzyMatches(nameKey, q)) score = 0.5;
    else score = toScore(worldScores.get(w.name) || 0);
    if (score > 0) results.push({ kind: 'world', name: w.name, score });
  }

  return results.sort((a, b) => b.score - a.score);
}

export interface RelatedEdge {
  source: string;
  target: string;
  type: string;
  description: string;
  provenance?: string;
}

/**
 * Nhãn hiển thị nguồn gốc cạnh theo quy ước Graphify:
 * EXTRACTED = người khẳng định, INFERRED = máy suy ra, LEGACY = dữ liệu cũ.
 */
export function provenanceTag(provenance?: string): 'EXTRACTED' | 'INFERRED' | 'LEGACY' {
  if (provenance === 'extracted') return 'EXTRACTED';
  if (provenance === 'inferred') return 'INFERRED';
  return 'LEGACY';
}

type Adjacency = Map<string, { displayName: string; neighbors: Map<string, RelatedEdge> }>;

/**
 * Dựng kề vô hướng của đồ thị nhân vật (dùng chung cho BFS mở rộng
 * và tìm đường ngắn nhất). Key là tên chuẩn hóa, giữ tên hiển thị gốc.
 */
function buildAdjacency(index: KnowledgeGraphIndex): Adjacency {
  const adj: Adjacency = new Map();
  const ensure = (key: string, display: string) => {
    if (!adj.has(key)) adj.set(key, { displayName: display, neighbors: new Map() });
  };

  const setNeighbor = (fromKey: string, toKey: string, e: RelatedEdge) => {
    const nodeNeighbors = adj.get(fromKey)!.neighbors;
    const existing = nodeNeighbors.get(toKey);
    if (!existing) {
      nodeNeighbors.set(toKey, { ...e });
      return;
    }

    const isCurrentFromSource = normalizeKey(e.source) === fromKey;
    const isExistingFromSource = normalizeKey(existing.source) === fromKey;

    if (isCurrentFromSource && !isExistingFromSource) {
      // Cạnh mới đúng chiều xuất phát từ fromKey, thay thế cạnh ngược chiều
      nodeNeighbors.set(toKey, { ...e });
    } else if (isCurrentFromSource && isExistingFromSource) {
      // Cả hai cùng xuất phát từ fromKey nhưng khác mối quan hệ -> gộp thông tin
      if (!existing.type.includes(e.type)) {
        existing.type = `${existing.type}, ${e.type}`;
      }
      if (e.description && !existing.description.includes(e.description)) {
        existing.description = existing.description
          ? `${existing.description}; ${e.description}`
          : e.description;
      }
    } else if (!isCurrentFromSource && !isExistingFromSource) {
      // Cả hai đều là cạnh ngược chiều -> gộp type nếu khác
      if (!existing.type.includes(e.type)) {
        existing.type = `${existing.type}, ${e.type}`;
      }
      if (e.description && !existing.description.includes(e.description)) {
        existing.description = existing.description
          ? `${existing.description}; ${e.description}`
          : e.description;
      }
    }
  };

  for (const r of index.relationships) {
    const a = normalizeKey(r.source);
    const b = normalizeKey(r.target);
    if (a === b) continue;
    ensure(a, r.source);
    ensure(b, r.target);
    const edge: RelatedEdge = {
      source: r.source, target: r.target,
      type: r.type, description: r.description,
      provenance: r.provenance,
    };
    setNeighbor(a, b, edge);
    setNeighbor(b, a, edge);
  }
  return adj;
}

/**
 * Tìm nút đồ thị khớp tên nhập vào (không phân biệt hoa/thường),
 * ưu tiên: tên nhân vật trong bible → alias → đầu/cuối cạnh quan hệ.
 * Trả về key chuẩn hóa + tên hiển thị, hoặc null nếu không khớp.
 */
export function resolveNodeName(
  index: KnowledgeGraphIndex,
  name: string,
): { key: string; display: string } | null {
  const q = normalizeKey(name);
  for (const c of index.characters) {
    if (normalizeKey(c.name) === q) return { key: q, display: c.name };
  }
  for (const c of index.characters) {
    if (c.aliases.some(a => normalizeKey(a) === q)) return { key: normalizeKey(c.name), display: c.name };
  }
  const adj = buildAdjacency(index);
  // Khớp một phần: tên nhập vào chứa hoặc được chứa trong tên nút
  for (const [key, node] of adj) {
    if (key === q || key.includes(q) || q.includes(key)) return { key, display: node.displayName };
  }
  // Fuzzy: query sai chính tả/thiếu dấu — thứ tự ưu tiên: tên bible → alias →
  if (q.length >= 4) {
    for (const c of index.characters) {
      const nameKey = normalizeKey(c.name);
      if (fuzzyMatches(nameKey, q)) return { key: nameKey, display: c.name };
    }
    for (const c of index.characters) {
      if (c.aliases.some(a => fuzzyMatches(normalizeKey(a), q))) return { key: normalizeKey(c.name), display: c.name };
    }
    for (const w of index.worldEntries) {
      const nameKey = normalizeKey(w.name);
      if (fuzzyMatches(nameKey, q)) return { key: nameKey, display: w.name };
    }
    for (const [key, node] of adj) {
      if (fuzzyMatches(key, q)) return { key, display: node.displayName };
    }
  }
  return null;
}

/**
 * Mở rộng quan hệ (BFS) từ các nhân vật đã khớp qua đồ thị,
 * trả về các cạnh quan hệ liên quan và danh sách nhân vật liên quan.
 */
export function expandRelationships(
  index: KnowledgeGraphIndex,
  seedNames: string[],
  maxDepth = 2
): { edges: RelatedEdge[]; relatedNames: string[] } {
  const seed = new Set(seedNames.map(normalizeKey));
  const adj = buildAdjacency(index);

  const visited = new Set<string>();
  const edges = new Map<string, RelatedEdge>();
  let frontier = [...seed];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const node of frontier) {
      if (visited.has(node)) continue;
      visited.add(node);
      const neighbors = adj.get(node)?.neighbors;
      if (!neighbors) continue;
      for (const [nb, edge] of neighbors) {
        edges.set(`${normalizeKey(edge.source)}|${normalizeKey(edge.target)}`, edge);
        if (!visited.has(nb)) next.push(nb);
      }
    }
    frontier = next;
  }

  // Lấy tên liên quan từ chính các cạnh để giữ nguyên chữ hoa/thường gốc
  const relatedNames = [...new Set([...edges.values()].flatMap(e => [e.source, e.target]))]
    .filter(n => !seed.has(normalizeKey(n)));
  return { edges: [...edges.values()], relatedNames };
}

export interface PathResult {
  /** Tên hiển thị các nút trên đường đi, kể cả from và to. */
  nodes: string[];
  /** Các cạnh nối tiếp nhau tạo thành đường đi. */
  edges: RelatedEdge[];
}

/**
 * Đường đi ngắn nhất (BFS) giữa hai nhân vật trên đồ thị vô hướng.
 * Trả về null khi một trong hai đầu không có trong đồ thị hoặc không
 * tồn tại đường nối. Dùng cho truy vấn "A liên quan đến B như thế nào".
 */
export function findShortestPath(
  index: KnowledgeGraphIndex,
  from: string,
  to: string,
): PathResult | null {
  const fromNode = resolveNodeName(index, from);
  const toNode = resolveNodeName(index, to);
  if (!fromNode || !toNode) return null;
  if (fromNode.key === toNode.key) return { nodes: [fromNode.display], edges: [] };

  const adj = buildAdjacency(index);
  if (!adj.has(fromNode.key) || !adj.has(toNode.key)) return null;

  // BFS ghi vết: node -> {prev, edge}
  const prev = new Map<string, { prev: string; edge: RelatedEdge }>();
  const visited = new Set<string>([fromNode.key]);
  const queue: string[] = [fromNode.key];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === toNode.key) break;
    for (const [nb, edge] of adj.get(cur)!.neighbors) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      prev.set(nb, { prev: cur, edge });
      queue.push(nb);
    }
  }

  if (!visited.has(toNode.key)) return null;

  // Dựng ngược đường đi từ `to` về `from`
  const edges: RelatedEdge[] = [];
  const keys: string[] = [toNode.key];
  let cur = toNode.key;
  while (cur !== fromNode.key) {
    const step = prev.get(cur)!;
    edges.unshift(step.edge);
    cur = step.prev;
    keys.unshift(cur);
  }
  const nodes = keys.map(k => (k === fromNode.key ? fromNode.display : k === toNode.key ? toNode.display : adj.get(k)!.displayName));
  return { nodes, edges };
}

export interface GodNode {
  /** Tên hiển thị (giữ nguyên chữ hoa/thường của lần gặp đầu tiên). */
  name: string;
  /** Bậc vô hướng = số mối quan hệ kề với nhân vật. */
  degree: number;
}

/**
 * God-nodes: nhân vật trung tâm nhất theo bậc (degree) trong đồ thị
 * quan hệ — "mọi thứ chảy qua đâu". Gom theo tên chuẩn hóa để
 * "Tiêu Viêm" và "tiêu viêm" không bị đếm thành hai nút.
 */
export function computeGodNodes(
  relationships: { source: string; target: string }[],
  topN = 5,
): GodNode[] {
  const degree = new Map<string, { name: string; degree: number }>();
  const touch = (raw: string) => {
    const key = normalizeKey(raw);
    const slot = degree.get(key);
    if (slot) slot.degree++;
    else degree.set(key, { name: raw.trim(), degree: 1 });
  };
  for (const r of relationships) {
    if (normalizeKey(r.source) === normalizeKey(r.target)) continue;
    touch(r.source);
    touch(r.target);
  }
  return [...degree.values()]
    .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name, 'vi'))
    .slice(0, Math.max(0, topN));
}

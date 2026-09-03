import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import matter from 'gray-matter';
import { StoryProject } from '../server/StoryProject.js';
import { writeJsonFile, readTextFile } from './fileUtils.js';

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

/** Số token trùng giữa query và danh sách terms của thực thể. */
function termOverlap(query: string, terms: string[]): number {
  const qTokens = extractTerms(query);
  let count = 0;
  for (const t of qTokens) {
    if (terms.includes(t)) count++;
  }
  return count;
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
    };
  })();
}

/** Đọc cache .cbm/index.json nếu có, ngược lại build mới và ghi cache. */
export async function loadOrBuildIndex(project: StoryProject, forceRebuild = false): Promise<KnowledgeGraphIndex> {
  if (!forceRebuild) {
    const cachePath = path.join(project.projectPath, '.cbm', 'index.json');
    try {
      const raw = await fs.readFile(cachePath, 'utf-8');
      return JSON.parse(raw) as KnowledgeGraphIndex;
    } catch {
      // cache không tồn tại hoặc hỏng → build mới
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
  const q = normalize(query);
  const results: EntityMatch[] = [];

  for (const c of index.characters) {
    let score = 0;
    if (normalize(c.name) === q) score = 1.0;
    else if (normalize(c.name).includes(q) || q.includes(normalize(c.name))) score = 0.8;
    else if (c.aliases.some(a => normalize(a) === q || normalize(a).includes(q) || q.includes(normalize(a)))) score = 0.6;
    else score = Math.min(0.4, termOverlap(query, c.terms) * 0.15);
    if (score > 0) results.push({ kind: 'character', name: c.name, ref: c.fileKey, score });
  }

  for (const w of index.worldEntries) {
    let score = 0;
    if (normalize(w.name) === q) score = 1.0;
    else if (normalize(w.name).includes(q) || q.includes(normalize(w.name))) score = 0.8;
    else score = Math.min(0.4, termOverlap(query, w.terms) * 0.15);
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
  for (const r of index.relationships) {
    const a = normalize(r.source);
    const b = normalize(r.target);
    if (a === b) continue;
    ensure(a, r.source);
    ensure(b, r.target);
    const edge: RelatedEdge = {
      source: r.source, target: r.target,
      type: r.type, description: r.description,
      provenance: r.provenance,
    };
    adj.get(a)!.neighbors.set(b, edge);
    adj.get(b)!.neighbors.set(a, edge);
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
  const q = normalize(name);
  for (const c of index.characters) {
    if (normalize(c.name) === q) return { key: q, display: c.name };
  }
  for (const c of index.characters) {
    if (c.aliases.some(a => normalize(a) === q)) return { key: normalize(c.name), display: c.name };
  }
  const adj = buildAdjacency(index);
  // Khớp một phần: tên nhập vào chứa hoặc được chứa trong tên nút
  for (const [key, node] of adj) {
    if (key === q || key.includes(q) || q.includes(key)) return { key, display: node.displayName };
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
  const seed = new Set(seedNames.map(normalize));
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
        edges.set(`${normalize(edge.source)}|${normalize(edge.target)}`, edge);
        if (!visited.has(nb)) next.push(nb);
      }
    }
    frontier = next;
  }

  // Lấy tên liên quan từ chính các cạnh để giữ nguyên chữ hoa/thường gốc
  const relatedNames = [...new Set([...edges.values()].flatMap(e => [e.source, e.target]))]
    .filter(n => !seed.has(normalize(n)));
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
    const key = normalize(raw);
    const slot = degree.get(key);
    if (slot) slot.degree++;
    else degree.set(key, { name: raw.trim(), degree: 1 });
  };
  for (const r of relationships) {
    if (normalize(r.source) === normalize(r.target)) continue;
    touch(r.source);
    touch(r.target);
  }
  return [...degree.values()]
    .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name, 'vi'))
    .slice(0, Math.max(0, topN));
}

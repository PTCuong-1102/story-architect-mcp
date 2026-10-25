import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { StoryProject } from '../src/server/StoryProject.js';
import { McpServer } from '@modelcontextprotocol/server';
import { registerAutoRefactorTool } from '../src/tools/rescue/autoRefactorStructure.js';
import {
  parseChapterNumber, parseVnNumberPhrase, parseCnNumberPhrase,
  findChapterHeadings, splitChapters, detectLayoutProfile,
  proposeChapterFilename, subdirToArc, foldLower,
} from '../src/utils/layoutDetect.js';

// ============================================================
// P4.1 — Số chương đa ngôn ngữ (v0.6.0)
// ============================================================

test('layout: parseChapterNumber — số Ả Rập / La Mã / chữ Việt / Hán tự', () => {
  assert.equal(parseChapterNumber('12'), 12);
  assert.equal(parseChapterNumber('045'), 45);
  assert.equal(parseChapterNumber('0'), null, 'chương 0 không hợp lệ');
  assert.equal(parseChapterNumber('XII'), 12);
  assert.equal(parseChapterNumber('xiv'), 14);
  assert.equal(parseChapterNumber('March 5'), null, 'văn xuôi miễn nhiễm');
  assert.equal(parseChapterNumber('3.5'), null, 'số thập phân rác');
  assert.equal(parseChapterNumber('hai con mèo'), null, 'cụm chữ sai cú pháp');
});

test('layout: parseVnNumberPhrase — cú pháp số tiếng Việt đầy đủ', () => {
  assert.equal(parseVnNumberPhrase('mười hai'), 12);
  assert.equal(parseVnNumberPhrase('hai mươi mốt'), 21);
  assert.equal(parseVnNumberPhrase('chín mươi chín'), 99);
  assert.equal(parseVnNumberPhrase('một trăm linh hai'), 102);
  assert.equal(parseVnNumberPhrase('ba trăm mười lăm'), 315);
  assert.equal(parseVnNumberPhrase('chín trăm chín mươi chín'), 999);
  assert.equal(parseVnNumberPhrase('hai con mèo'), null);
  assert.equal(parseVnNumberPhrase(''), null);
});

test('layout: parseCnNumberPhrase — Hán tự + số Ả Rập', () => {
  assert.equal(parseCnNumberPhrase('十二'), 12);
  assert.equal(parseCnNumberPhrase('一百零一'), 101);
  assert.equal(parseCnNumberPhrase('两千'), 2000);
  assert.equal(parseCnNumberPhrase('第三部'), null, 'chữ không phải numeral');
});

test('layout: findChapterHeadings — đa marker, bỏ dòng không số', () => {
  const text = [
    '# Chương 1: Khởi đầu',
    'Văn mẫu chương 1.',
    '',
    'Chương hai - Lửa',
    '',
    'Chương: không có số (phải bỏ qua)',
    '',
    '## 第3章 Tiếp',
    '',
    'Chapter IV: End',
    'Chương mười hai vị thánh (chỉ lấy "mười hai")',
  ].join('\n');
  const hs = findChapterHeadings(text);
  assert.deepEqual(hs.map(h => h.number)?.slice(0, 5), [1, 2, 3, 4, 12]);
  assert.ok(!hs.some(h => h.rawLine.includes('không có số')), 'heading không số bị bỏ qua');
});

test('layout: splitChapters — tách đúng số chương, không mất chữ', () => {
  const text = [
    'Lời tựa: dự án này viết tay 3 năm.',
    '# Chương 1: Khởi đầu',
    'Nội dung một.',
    'Chi tiết kéo dài.',
    'Chương 2: Bùng nổ',
    'Nội dung hai.',
    'Chương 10: Xa xa',
    'Nội dung mười.',
  ].join('\n');
  const parts = splitChapters(text);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map(p => p.number), [1, 2, 10]);
  assert.ok(parts[0].content.startsWith('Lời tựa:'), 'lời tựa gắn vào chương đầu, không mất chữ');
  assert.ok(parts[0].title.includes('Chương 1: Khởi đầu'));
  assert.ok(parts[2].content.includes('Nội dung mười.'));
});

// ============================================================
// P4.2 — Layout profile cấp thư mục (v0.6.0)
// ============================================================

test('layout: detectLayoutProfile — 4 kiểu bố cục', () => {
  const c = (s: string) => s;

  // already_standard
  const std = detectLayoutProfile([
    { rel: 'manuscript/arc_01/ch_001.md', words: 900, content: null },
    { rel: 'manuscript/arc_01/ch_002.md', words: 850, content: null },
    { rel: 'manuscript/arc_01/ch_003.md', words: 880, content: null },
  ].map(f => ({ ...f, content: c('') })));
  assert.equal(std.kind, 'already_standard');

  // chapters_flat
  const flat = detectLayoutProfile([
    { rel: 'chap1.md', words: 900, content: null },
    { rel: 'chuong2.txt', words: 800, content: null },
    { rel: 'Chapter-03.md', words: 820, content: null },
  ]);
  assert.equal(flat.kind, 'chapters_flat');
  assert.equal(flat.chapterLikeFiles, 3);

  // arc_folders — 2 thư mục tự đặt tên
  const arcs = detectLayoutProfile([
    { rel: 'Quyen 3 - Thang thien/chuong 1.md', words: 900, content: null },
    { rel: 'Quyen 3 - Thang thien/chuong 2.md', words: 800, content: null },
    { rel: 'quan truong/chap1.txt', words: 820, content: null },
    { rel: 'quan truong/chap2.txt', words: 810, content: null },
  ]);
  assert.equal(arcs.kind, 'arc_folders');
  assert.deepEqual(arcs.projectCandidates.sort(), ['Quyen 3 - Thang thien', 'quan truong']);

  // single_file
  const big = 'Quyển truyện.\n' + Array.from({ length: 12 }, (_, i) =>
    `Chương ${i + 1}: Tên chương ${i + 1}\nNội dung chương số ${i + 1} kéo dài vài trăm từ...`).join('\n\n');
  const sf = detectLayoutProfile([
    { rel: 'novel-full.md', words: 4000, content: big },
  ]);
  assert.equal(sf.kind, 'single_file');
  assert.equal(sf.singleFileCandidates[0]?.headingCount, 12);
});

test('layout: helpers đặt tên chuẩn', () => {
  assert.equal(proposeChapterFilename(5, 1), 'ch_005.md');
  assert.equal(proposeChapterFilename(null, 7), 'ch_007.md');
  assert.equal(proposeChapterFilename(1200, 2), 'ch_999.md');
  assert.equal(subdirToArc('Quyển 3 - Thăng Thiên', 1), 'arc_03');
  assert.equal(subdirToArc('vol 2', 1), 'arc_02');
  assert.equal(subdirToArc('chapters', 4), 'arc_04');
  assert.equal(foldLower('Quyển 3'), 'quyen 3');
});

// ============================================================
// P4.3 — auto_refactor auto_profile (v0.6.0, tích hợp)
// ============================================================

async function mktmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function makeRefactorHandler(projectNote: string) {
  const tmpDir = projectNote;
  const project = new StoryProject(tmpDir);
  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  registerAutoRefactorTool(server, () => project);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (p: never) => Promise<{ content: { text: string }[]; isError?: boolean }> }> })._registeredTools;
  return tools['story_auto_refactor_structure'].handler;
}

// Nội dung phải > 2000 từ (ngưỡng single-file của profile) — lặp thực tế
const CHAPTER_BODY = 'Nội dung chương — người hướng đạo đi qua đền rừng, ngồi xuống và kể chuyện voi trên trời cho nhóm nghe.';
const BIG_NOVEL = 'Quyển truyện thời Hoại Dương.\n\n' + Array.from({ length: 5 }, (_, i) =>
  `Chương ${i + 1}: Cánh cửa thứ ${i + 1}\n\n${Array.from({ length: 25 }, () => CHAPTER_BODY).join('\n')}`).join('\n\n');

test('auto_refactor: auto_profile tách single-file thành ch_XXX + bản gốc vào drafts_raw', async () => {
  const tmpDir = await mktmp('refactor-single-');
  await fs.mkdir(path.join(tmpDir, 'notes'), { recursive: true });
  await fs.writeFile(path.join(tmpDir, 'novel-full.md'), BIG_NOVEL, 'utf-8');
  await fs.writeFile(path.join(tmpDir, 'notes', 'ghichu.md'), 'Ghi chú tạm.', 'utf-8');

  const handler = makeRefactorHandler(tmpDir);
  // Dry-run: phải gợi ý SPLIT
  const preview = await handler({ projectPath: tmpDir } as never);
  assert.match(preview.content[0].text, /SPLIT/, 'preview phải gợi ý tách file lớn');

  // Confirm: tách thật
  const done = await handler({ projectPath: tmpDir, confirm: true } as never);
  assert.match(done.content[0].text, /Lỗi: 0/, done.content[0].text.slice(0, 400));
  assert.ok(!done.content[0].text.includes('❌'), done.content[0].text.slice(0, 400));

  const arcDir = path.join(tmpDir, 'manuscript', 'arc_01');
  const chapters = (await fs.readdir(arcDir)).filter(f => f.endsWith('.md')).sort();
  assert.equal(chapters.length, 5, `5 chương tách ra, thấy: ${chapters.join(',')}`);
  assert.equal(chapters[0], 'ch_001.md');

  const ch3 = await fs.readFile(path.join(arcDir, 'ch_003.md'), 'utf-8');
  assert.ok(ch3.startsWith('Chương 3:'), 'tiêu đề chương nằm đầu file');
  assert.ok(ch3.includes(CHAPTER_BODY), 'nội dung chương bảo toàn');

  // Bản gốc bảo toàn trong drafts_raw
  const drafts = await fs.readdir(path.join(tmpDir, 'drafts_raw'));
  assert.ok(drafts.some(f => f.startsWith('novel-full')), 'bản gốc vẫn nằm trong drafts_raw');

  // Notes-left-file được phân loại không phá Layout
  const ghiChuMoved = await fs.readdir(path.join(tmpDir, 'drafts_raw'));
  assert.ok(ghiChuMoved.some(f => f.includes('ghichu')), 'ghi chú → drafts_raw');

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('auto_refactor: auto_profile map thư mục arc tự đặt tên → arc_XX', async () => {
  const tmpDir = await mktmp('refactor-arcs-');
  await fs.mkdir(path.join(tmpDir, 'Quyen 1'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'phan 2'), { recursive: true });
  await fs.writeFile(path.join(tmpDir, 'Quyen 1', 'chuong 1.md'), 'Chương mở màn vương triều, nhiều nội dung để nhận diện bản thảo chắc chắn.', 'utf-8');
  await fs.writeFile(path.join(tmpDir, 'Quyen 1', 'chuong 2.md'), 'Chương kết phần một, nhiều nội dung để nhận diện bản thảo chắc chắn.', 'utf-8');
  await fs.writeFile(path.join(tmpDir, 'phan 2', 'chuong 03.md'), 'Phần hai mở màn gió bão, nhiều nội dung để nhận diện bản thảo chắc chắn.', 'utf-8');
  await fs.writeFile(path.join(tmpDir, 'phan 2', 'chuong 04.md'), 'Phần hai kết thúc, nhiều nội dung để nhận diện bản thảo chắc chắn.', 'utf-8');

  const handler = makeRefactorHandler(tmpDir);
  const preview = await handler({ projectPath: tmpDir } as never);
  assert.match(preview.content[0].text, /thư mục phân tập/, 'preview phải ghi nhận bố cục phân tập');

  const done = await handler({ projectPath: tmpDir, confirm: true } as never);
  assert.match(done.content[0].text, /Lỗi: 0/);
  assert.ok(!done.content[0].text.includes('❌'));

  const arc1 = await fs.readdir(path.join(tmpDir, 'manuscript', 'arc_01'));
  const arc2 = await fs.readdir(path.join(tmpDir, 'manuscript', 'arc_02'));
  assert.equal(arc1.filter(f => f.endsWith('.md')).length, 2, 'arc_01 giữ 2 chương');
  assert.equal(arc2.filter(f => f.endsWith('.md')).length, 2, 'arc_02 giữ 2 chương');
  // Nội dung nguyên vẹn
  assert.ok((await fs.readFile(path.join(tmpDir, 'manuscript', 'arc_02', 'chuong 03.md'), 'utf-8')).includes('gió bão'));

  await fs.rm(tmpDir, { recursive: true, force: true });
});

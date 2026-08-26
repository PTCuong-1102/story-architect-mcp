import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { StoryProject } from '../src/server/StoryProject.js';
import { registerExportTool } from '../src/tools/export.js';

const TMP = '/tmp/opencode/unit-export';

type ToolResult = { content: { type: string; text: string }[] };

/** Fake McpServer: chỉ capture handler để gọi trực tiếp trong test. */
function makeFakeServer(): { server: McpServer; handlers: Map<string, (params: never) => Promise<ToolResult>> } {
  const handlers = new Map<string, (params: never) => Promise<ToolResult>>();
  const fake = {
    registerTool: (name: string, _config: unknown, handler: (params: never) => Promise<ToolResult>) => {
      handlers.set(name, handler);
    },
  };
  return { server: fake as unknown as McpServer, handlers };
}

async function freshProject(): Promise<StoryProject> {
  const dir = path.join(TMP, `novel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const p = new StoryProject(dir);
  await p.initializeProject({ name: 'Kiểm Định Xuất Bản', author: 'Nguyễn Văn A', genre: ['Fantasy'] });
  return p;
}

/** Tạo 2 arc / 3 chương để kiểm tra thứ tự gom chương. */
async function seedManuscript(p: StoryProject): Promise<void> {
  await fs.writeFile(path.join(p.manuscriptDir, 'arc_01', 'ch_001.md'), 'Chương một mở đầu. # Tiêu đề phụ\n', 'utf-8');
  await fs.writeFile(path.join(p.manuscriptDir, 'arc_01', 'ch_002.md'), 'Chương hai phát triển.', 'utf-8');
  await fs.mkdir(path.join(p.manuscriptDir, 'arc_02'), { recursive: true });
  await fs.writeFile(path.join(p.manuscriptDir, 'arc_02', 'ch_001.md'), 'Arc hai cao trào <và> thoát XML.', 'utf-8');
}

function readZipEntries(buf: Buffer): { name: string; data: Buffer; method: number }[] {
  const entries: { name: string; data: Buffer; method: number }[] = [];
  let pos = 0;
  while (buf.readUInt32LE(pos) === 0x04034b50) {
    const method = buf.readUInt16LE(pos + 8);
    const compSize = buf.readUInt32LE(pos + 18);
    const nameLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const name = buf.slice(pos + 30, pos + 30 + nameLen).toString('utf-8');
    const data = buf.slice(pos + 30 + nameLen + extraLen, pos + 30 + nameLen + extraLen + compSize);
    entries.push({ name, data, method });
    pos += 30 + nameLen + extraLen + compSize;
  }
  return entries;
}

test('story_export: markdown_single ghi đúng cấu trúc tiêu đề, mục lục và nội dung', async () => {
  const p = await freshProject();
  await seedManuscript(p);

  const { server, handlers } = makeFakeServer();
  registerExportTool(server, () => p);

  const outPath = path.join(p.projectPath, 'export', 'out.md');
  const result = await handlers.get('story_export')!({ format: 'markdown_single', outputPath: outPath } as never);

  assert.match(result.content[0].text, /Đã xuất bản thảo thành công/);
  assert.match(result.content[0].text, /Số chương: 3/);

  const md = await fs.readFile(outPath, 'utf-8');
  assert.match(md, /^# Kiểm Định Xuất Bản/);
  assert.match(md, /\*\*Tác giả\*\*: Nguyễn Văn A/);
  assert.match(md, /## Mục lục/);
  // Arc được chuẩn hóa hiển thị hoa
  assert.match(md, /### ARC 01/);
  // Chương hiển thị dạng "Chương 001" với anchor
  assert.match(md, /\[Chương 001\]\(#ch_001\)/);
  assert.match(md, /{#ch_001}/);
  assert.match(md, /Chương một mở đầu\./);
});

test('story_export: html bọc document đầy đủ và escape nội dung', async () => {
  const p = await freshProject();
  await seedManuscript(p);

  const { server, handlers } = makeFakeServer();
  registerExportTool(server, () => p);

  const outPath = path.join(p.projectPath, 'export', 'out.html');
  await handlers.get('story_export')!({ format: 'html', outputPath: outPath } as never);

  const html = await fs.readFile(outPath, 'utf-8');
  assert.match(html, /<html/i);
  assert.match(html, /<title>Kiểm Định Xuất Bản<\/title>/);
  // Nội dung có ký tự đặc biệt vẫn xuất hiện (đã escape bởi markdownToHtml)
  assert.ok(html.includes('thoát XML'));
});

test('story_export: epub là ZIP hợp lệ, mimetype STORED đứng đầu, đủ các part OEBPS', async () => {
  const p = await freshProject();
  await seedManuscript(p);

  const { server, handlers } = makeFakeServer();
  registerExportTool(server, () => p);

  const outPath = path.join(p.projectPath, 'export', 'out.epub');
  await handlers.get('story_export')!({ format: 'epub', outputPath: outPath } as never);

  const buf = await fs.readFile(outPath);
  const entries = readZipEntries(buf);

  // EPUB spec: entry đầu tiên phải là mimetype, không nén
  assert.equal(entries[0].name, 'mimetype');
  assert.equal(entries[0].method, 0);
  assert.equal(entries[0].data.toString(), 'application/epub+zip');

  const names = entries.map(e => e.name);
  for (const required of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/style.css', 'OEBPS/content.xhtml']) {
    assert.ok(names.includes(required), `thiếu entry ${required}`);
  }

  // content.xhtml chứa cả 3 chương đã escape
  const contentXhtml = entries.find(e => e.name === 'OEBPS/content.xhtml')!.data.toString();
  assert.match(contentXhtml, /id="ch_001"/);
  assert.match(contentXhtml, /&lt;và&gt;/);
  // container.xml trỏ đúng vào content.opf
  assert.match(entries.find(e => e.name === 'META-INF/container.xml')!.data.toString(), /full-path="OEBPS\/content\.opf"/);
});

test('story_export: docx là ZIP hợp lệ với document.xml WordprocessingML', async () => {
  const p = await freshProject();
  await seedManuscript(p);

  const { server, handlers } = makeFakeServer();
  registerExportTool(server, () => p);

  const outPath = path.join(p.projectPath, 'export', 'out.docx');
  await handlers.get('story_export')!({ format: 'docx', outputPath: outPath } as never);

  const buf = await fs.readFile(outPath);
  const names = readZipEntries(buf).map(e => e.name);
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'docProps/core.xml']) {
    assert.ok(names.includes(required), `thiếu entry ${required}`);
  }

  const docXml = readZipEntries(buf).find(e => e.name === 'word/document.xml')!.data.toString();

  // Heading1 cho tên chương, Title cho tên truyện
  assert.match(docXml, /w:val="Title"/);
  assert.match(docXml, /w:val="Heading1"/);
  // Nội dung tiếng Việt giữ nguyên vẹn
  assert.ok(docXml.includes('Chương một mở đầu.'));
});

test('story_export: mặc định ghi vào export/<tên_chuẩn_hóa>.<ext>', async () => {
  const p = await freshProject();
  const { server, handlers } = makeFakeServer();
  registerExportTool(server, () => p);

  const result = await handlers.get('story_export')!({ format: 'markdown_single' } as never);
  const defaultPath = path.join(p.projectPath, 'export', 'kiểm_định_xuất_bản.md');
  assert.ok(result.content[0].text.includes(defaultPath));
  await fs.access(defaultPath);
});

test('story_export: pdf chưa hỗ trợ → trả lời hướng dẫn thay vì lỗi', async () => {
  const p = await freshProject();
  const { server, handlers } = makeFakeServer();
  registerExportTool(server, () => p);

  const result = await handlers.get('story_export')!({ format: 'pdf' } as never);
  assert.match(result.content[0].text, /chưa được hỗ trợ trực tiếp/);
  assert.match(result.content[0].text, /markdown_single, html, epub, docx/);
});

test('story_export: dự án chưa khởi tạo → từ chối', async () => {
  const dir = path.join(TMP, `not-init-${Date.now()}`);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  const { server, handlers } = makeFakeServer();
  registerExportTool(server, () => new StoryProject(dir));

  const result = await handlers.get('story_export')!({ format: 'markdown_single' } as never);
  assert.match(result.content[0].text, /chưa được khởi tạo/);
});

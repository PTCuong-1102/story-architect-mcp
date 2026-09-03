import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { StoryProject } from '../server/StoryProject.js';
import { markdownToHtml, htmlDocument } from '../utils/markdownToHtml.js';
import { createZip } from '../utils/zip.js';
import { findMarkdownFiles, readTextFile } from '../utils/fileUtils.js';
import { errResult, requireProject, isToolError } from '../utils/mcpResults.js';

/**
 * Escape text cho XML (EPUB/DOCX). Đồng thời loại ký tự điều khiển
 * (U+0000–U+0008, U+000B–U+000C, U+000E–U+001F, U+FFFE/U+FFFF) vì chúng
 * làm XML ill-formed → EPUBCheck fatal / Word báo repair.
 */
const escapeXml = (s: string): string =>
  s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

interface ChapterContent { arc: string; chapter: string; content: string; }

async function collectChapters(project: StoryProject): Promise<ChapterContent[]> {
  const arcs = await project.listArcs();
  const chapters: ChapterContent[] = [];
  for (const arc of arcs) {
    const list = await project.listChaptersInArc(arc);
    for (const ch of list) {
      const content = await project.getChapterContent(arc, ch);
      if (content) chapters.push({ arc, chapter: ch, content });
    }
  }
  return chapters;
}

/**
 * Thu thập toàn bộ dàn ý trong outline/ thành một khối Markdown.
 * Chỉ gọi khi user bật includeOutline (tránh quét đĩa không cần thiết).
 */
async function collectOutline(project: StoryProject): Promise<string> {
  const files = await findMarkdownFiles(project.outlineDir);
  if (files.length === 0) return '';
  files.sort();
  const parts: string[] = [];
  for (const f of files) {
    const content = await readTextFile(f);
    if (!content || !content.trim()) continue;
    const rel = path.relative(project.outlineDir, f);
    parts.push(`\n### ${rel}\n\n${content.trim()}`);
  }
  return parts.join('\n');
}

function buildMarkdown(projectName: string, author: string, genre: string, wordCount: string, chapters: ChapterContent[], outlineMd = ''): string {
  const parts: string[] = [];
  parts.push(`# ${projectName}\n`);
  if (author) parts.push(`**Tác giả**: ${author}\n`);
  parts.push(`**Thể loại**: ${genre}\n`);
  parts.push(`**Tổng số từ**: ${wordCount}\n`);
  parts.push('---\n');

  parts.push('## Mục lục\n');
  const byArc = new Map<string, ChapterContent[]>();
  for (const c of chapters) {
    if (!byArc.has(c.arc)) byArc.set(c.arc, []);
    byArc.get(c.arc)!.push(c);
  }
  for (const [arc, list] of byArc) {
    parts.push(`### ${arc.replace(/_/g, ' ').toUpperCase()}\n`);
    for (const c of list) {
      const displayName = c.chapter.replace(/_/g, ' ').replace(/^ch /, 'Chương ');
      parts.push(`- [${displayName}](#${c.chapter})\n`);
    }
  }
  parts.push('\n---\n');

  for (const [arc, list] of byArc) {
    parts.push(`\n# ${arc.replace(/_/g, ' ').toUpperCase()}\n`);
    for (const c of list) {
      parts.push(`\n## ${c.chapter.replace(/_/g, ' ').replace(/^ch /, 'Chương ')} {#${c.chapter}}\n`);
      parts.push(c.content);
      parts.push('\n');
    }
  }

  if (outlineMd) {
    parts.push('\n---\n');
    parts.push('\n# DÀN Ý (OUTLINE)\n');
    parts.push(outlineMd);
    parts.push('\n');
  }
  return parts.join('\n');
}

/** Tạo các entry của EPUB 3.0 (mimetype bắt buộc là entry đầu, lưu STORED). */
function buildEpubEntries(title: string, author: string, language: string, chapters: ChapterContent[], outlineMd = ''): { name: string; data: Buffer; deflate?: boolean }[] {
  const bookId = randomUUID();

  const titlePage = `<section epub:type="titlepage"><h1>${escapeXml(title)}</h1>${author ? `<p>${escapeXml(author)}</p>` : ''}</section>`;

  // href fragment phải URL-encode (tên chương có dấu cách/ký tự đặc biệt
  // sẽ gãy link mục lục); id giữ nguyên để tương thích ngược.
  const navItems = chapters.map(c =>
    `<li><a href="content.xhtml#${encodeURIComponent(c.chapter)}">${escapeXml(c.chapter)}</a></li>`
  ).join('\n') + (outlineMd ? '\n<li><a href="content.xhtml#outline">Dàn ý (Outline)</a></li>' : '');

  const outlineSection = outlineMd
    ? `\n\n<section id="outline" epub:type="appendix"><h2>Dàn ý (Outline)</h2>\n${markdownToHtml(outlineMd)}</section>`
    : '';

  const bodySections = chapters.map(c =>
    `<section id="${escapeXml(c.chapter)}" epub:type="chapter"><h2>${escapeXml(c.chapter)}</h2>\n${markdownToHtml(c.content)}</section>`
  ).join('\n\n') + outlineSection;

  return [
    { name: 'mimetype', data: Buffer.from('application/epub+zip'), deflate: false },
    {
      name: 'META-INF/container.xml',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`),
    },
    {
      name: 'OEBPS/content.opf',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${bookId}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    ${author ? `<dc:creator>${escapeXml(author)}</dc:creator>` : ''}
    <dc:language>${escapeXml(language)}</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="content"/>
  </spine>
</package>
`),
    },
    {
      name: 'OEBPS/nav.xhtml',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>${escapeXml(title)}</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Mục lục</h1>
      <ol>${navItems}</ol>
    </nav>
    <nav epub:type="landmarks" id="landmarks" hidden="">
      <h2>Landmarks</h2>
      <ol>
        <li><a epub:type="toc" href="#toc">Mục lục</a></li>
        <li><a epub:type="bodymatter" href="content.xhtml">Nội dung chính</a></li>
      </ol>
    </nav>
  </body>
</html>
`),
    },
    {
      name: 'OEBPS/style.css',
      data: Buffer.from(`body { font-family: serif; line-height: 1.6; margin: 1em; }
h1, h2, h3 { line-height: 1.3; }
blockquote { margin-left: 1em; color: #555; }
pre { white-space: pre-wrap; }
`),
    },
    {
      name: 'OEBPS/content.xhtml',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <title>${escapeXml(title)}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
${titlePage}
${bodySections}
  </body>
</html>
`),
    },
  ];
}

/** Tạo các entry của DOCX (WordprocessingML tối giản). */
function buildDocxEntries(title: string, chapters: ChapterContent[], outlineMd = ''): { name: string; data: Buffer; deflate?: boolean }[] {
  const paragraphs: string[] = [];
  const pushParagraph = (text: string, style?: string) => {
    const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
    paragraphs.push(`<w:p>${pPr}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`);
  };
  const pushMarkdownBlock = (md: string) => {
    for (const line of md.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const h1 = t.match(/^#\s+(.*)$/);
      const h2 = t.match(/^##\s+(.*)$/);
      const h3 = t.match(/^###\s+(.*)$/);
      if (h1) pushParagraph(h1[1], 'Heading1');
      else if (h2) pushParagraph(h2[1], 'Heading2');
      else if (h3) pushParagraph(h3[1], 'Heading3');
      else pushParagraph(t);
    }
  };

  pushParagraph(title, 'Title');
  for (const c of chapters) {
    pushParagraph(c.chapter, 'Heading1');
    pushMarkdownBlock(c.content);
  }

  if (outlineMd) {
    pushParagraph('Dàn ý (Outline)', 'Heading1');
    pushMarkdownBlock(outlineMd);
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${paragraphs.join('\n')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>
`;

  return [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>
`),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>
`),
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
`),
    },
    {
      name: 'word/styles.xml',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="48"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/></w:rPr>
  </w:style>
</w:styles>
`),
    },
    {
      name: 'docProps/core.xml',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${escapeXml(title)}</dc:title>
</cp:coreProperties>
`),
    },
    { name: 'word/document.xml', data: Buffer.from(documentXml) },
  ];
}

export function registerExportTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_export',
    {
      title: 'Export Story Manuscript',
      description: 'Đóng gói và xuất bản toàn bộ tác phẩm thành file Markdown, HTML, EPUB hoặc DOCX kèm mục lục và thông tin tác giả.',
      inputSchema: z.object({
        format: z.enum(['markdown_single', 'html', 'epub', 'docx', 'pdf']).default('markdown_single')
          .describe('Định dạng xuất: markdown_single | html | epub | docx (pdf chưa hỗ trợ — xem gợi ý)'),
        includeOutline: z.boolean().default(false)
          .describe('Bao gồm dàn ý trong file xuất'),
        outputPath: z.string().optional()
          .describe('Đường dẫn file xuất (mặc định: <project>/export/<name>.<ext>)'),
      }),
    },
    async (params) => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;

      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.');
      }

      const config = await project.getConfig();
      const status = await project.getStatus();
      const chapters = await collectChapters(project);
      const arcs = await project.listArcs();

      const baseName = config.name.toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '') || 'novel';
      const outputDir = path.join(project.projectPath, 'export');
      await fs.mkdir(outputDir, { recursive: true });

      const format = params.format;

      // PDF trả về sớm: vừa giữ thông điệp hướng dẫn, vừa tránh bug
      // outputPath thành "<name>undefined" (pdf không có trong extMap).
      if (format === 'pdf') {
        return errResult(`❌ Định dạng "pdf" hiện chưa được hỗ trợ trực tiếp (PDF yêu cầu nhúng font, chưa hỗ trợ tiếng Việt chuẩn).

💡 Cách xuất PDF: xuất định dạng \`html\` rồi mở bằng trình duyệt và "In → Save as PDF".

✅ Các định dạng đang hỗ trợ: markdown_single, html, epub, docx.`);
      }

      const extMap: Record<string, string> = {
        markdown_single: '.md',
        html: '.html',
        epub: '.epub',
        docx: '.docx',
      };
      const outputPath = params.outputPath || path.join(outputDir, baseName + (extMap[format] ?? '.md'));
      const language = config.language || 'vi';

      const outlineMd = params.includeOutline ? await collectOutline(project) : '';

      switch (format) {
        case 'markdown_single': {
          const md = buildMarkdown(config.name, config.author, config.genre.join(', '), status.totalWordCount.toLocaleString(), chapters, outlineMd);
          await fs.writeFile(outputPath, md, 'utf-8');
          break;
        }
        case 'html': {
          const md = buildMarkdown(config.name, config.author, config.genre.join(', '), status.totalWordCount.toLocaleString(), chapters, outlineMd);
          await fs.writeFile(outputPath, htmlDocument(config.name, markdownToHtml(md)), 'utf-8');
          break;
        }
        case 'epub': {
          // Nén mọi entry trừ mimetype (EPUB bắt buộc mimetype STORED đầu tiên)
          const entries = buildEpubEntries(config.name, config.author, language, chapters, outlineMd)
            .map(e => (e.name === 'mimetype' ? e : { ...e, deflate: true }));
          await fs.writeFile(outputPath, createZip(entries));
          break;
        }
        case 'docx': {
          const entries = buildDocxEntries(config.name, chapters, outlineMd)
            .map(e => ({ ...e, deflate: true }));
          await fs.writeFile(outputPath, createZip(entries));
          break;
        }
        default: {
          return errResult(`❌ Định dạng "${params.format}" không xác định. Hỗ trợ: markdown_single, html, epub, docx.`);
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Đã xuất bản thảo thành công!

📄 File: ${outputPath}
📊 Thống kê:
- Tổng số từ: ${status.totalWordCount.toLocaleString()}
- Số arc: ${arcs.length}
- Số chương: ${chapters.length}
- Định dạng: ${format}
- Dàn ý kèm theo: ${outlineMd ? 'có ✅' : 'không (bật includeOutline=true để kèm outline/)'}`,
        }],
      };
    }
  );
}

import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { StoryProject } from '../server/StoryProject.js';
import { markdownToHtml, htmlDocument } from '../utils/markdownToHtml.js';
import { createZip } from '../utils/zip.js';

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

function buildMarkdown(projectName: string, author: string, genre: string, wordCount: string, chapters: ChapterContent[]): string {
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
  return parts.join('\n');
}

/** Tạo các entry của EPUB 3.0 (mimetype bắt buộc là entry đầu, lưu STORED). */
function buildEpubEntries(title: string, author: string, language: string, chapters: ChapterContent[]): { name: string; data: Buffer; deflate?: boolean }[] {
  const bookId = randomUUID();

  const titlePage = `<section epub:type="titlepage"><h1>${escapeXml(title)}</h1>${author ? `<p>${escapeXml(author)}</p>` : ''}</section>`;

  const navItems = chapters.map(c =>
    `<li><a href="content.xhtml#${escapeXml(c.chapter)}">${escapeXml(c.chapter)}</a></li>`
  ).join('\n');

  const bodySections = chapters.map(c =>
    `<section id="${escapeXml(c.chapter)}" epub:type="chapter"><h2>${escapeXml(c.chapter)}</h2>\n${markdownToHtml(c.content)}</section>`
  ).join('\n\n');

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
function buildDocxEntries(title: string, chapters: ChapterContent[]): { name: string; data: Buffer; deflate?: boolean }[] {
  const paragraphs: string[] = [];
  const pushParagraph = (text: string, style?: string) => {
    const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
    paragraphs.push(`<w:p>${pPr}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`);
  };

  pushParagraph(title, 'Title');
  for (const c of chapters) {
    pushParagraph(c.chapter, 'Heading1');
    for (const line of c.content.split('\n')) {
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
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="48"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
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
      const project = getProject();

      if (!await project.isInitialized()) {
        return {
          content: [{ type: 'text' as const, text: '❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.' }],
        };
      }

      const config = await project.getConfig();
      const status = await project.getStatus();
      const chapters = await collectChapters(project);
      const arcs = await project.listArcs();

      const baseName = config.name.toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '') || 'novel';
      const outputDir = path.join(project.projectPath, 'export');
      await fs.mkdir(outputDir, { recursive: true });

      const format = params.format;
      const extMap: Record<string, string> = {
        markdown_single: '.md',
        html: '.html',
        epub: '.epub',
        docx: '.docx',
      };
      const outputPath = params.outputPath || path.join(outputDir, baseName + extMap[format]);
      const language = config.language || 'vi';

      let written = true;
      switch (format) {
        case 'markdown_single': {
          const md = buildMarkdown(config.name, config.author, config.genre.join(', '), status.totalWordCount.toLocaleString(), chapters);
          await fs.writeFile(outputPath, md, 'utf-8');
          break;
        }
        case 'html': {
          const md = buildMarkdown(config.name, config.author, config.genre.join(', '), status.totalWordCount.toLocaleString(), chapters);
          await fs.writeFile(outputPath, htmlDocument(config.name, markdownToHtml(md)), 'utf-8');
          break;
        }
        case 'epub': {
          const entries = buildEpubEntries(config.name, config.author, language, chapters);
          await fs.writeFile(outputPath, createZip(entries));
          break;
        }
        case 'docx': {
          const entries = buildDocxEntries(config.name, chapters);
          await fs.writeFile(outputPath, createZip(entries));
          break;
        }
        default: {
          written = false;
          break;
        }
      }

      if (!written) {
        return {
          content: [{
            type: 'text' as const,
            text: `❌ Định dạng "${params.format}" hiện chưa được hỗ trợ trực tiếp (PDF yêu cầu nhúng font, chưa hỗ trợ tiếng Việt chuẩn).
            
💡 Cách xuất PDF: xuất định dạng \`html\` rồi mở bằng trình duyệt và "In → Save as PDF".

✅ Các định dạng đang hỗ trợ: markdown_single, html, epub, docx.`,
          }],
        };
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
- Định dạng: ${format}`,
        }],
      };
    }
  );
}

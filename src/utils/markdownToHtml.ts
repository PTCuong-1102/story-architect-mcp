/**
 * Bộ chuyển đổi Markdown → HTML tối giản (không cần thư viện ngoài).
 * Hỗ trợ: heading, đoạn văn, blockquote, code block, hr, list,
 * và inline (link, image, bold, italic, inline code).
 */

/**
 * Escape text để nhúng an toàn vào HTML (dùng chung cho dashboard/export).
 * Đồng thời loại ký tự điều khiển (trừ \t \n \r) vì chúng làm XML
 * ill-formed trong content.xhtml của EPUB (EPUBCheck fatal).
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Chỉ cho phép URL http/https/mailto, anchor, đường dẫn tương đối/tuyệt đối.
 * Chặn `javascript:`/`data:`/`vbscript:` — file HTML export mở trong
 * browser sẽ thực thi scheme nguy hiểm khi click.
 */
function isSafeUrl(url: string): boolean {
  const m = url.trim().match(/^([a-z][a-z0-9+.-]*):/i);
  return !m || ['http', 'https', 'mailto'].includes(m[1].toLowerCase());
}

function renderInline(raw: string): string {
  // Tách code-span ra placeholder TRƯỚC để link/image/bold không ăn
  // vào nội dung literal trong backtick (ví dụ `[doc](http://x)`).
  const codeSpans: string[] = [];
  let r = escapeHtml(raw).replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSpans.push(`<code>${code}</code>`);
    return `\uE000${codeSpans.length - 1}\uE000`;
  });
  r = r.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) =>
    isSafeUrl(src) ? `<img src="${src}" alt="${alt}" />` : alt);
  r = r.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_m, text: string, href: string) =>
    isSafeUrl(href) ? `<a href="${href}">${text}</a>` : text);
  r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  r = r.replace(/__([^_]+)_/g, '<strong>$1</strong>');
  r = r.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  r = r.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  // Khôi phục code-span
  r = r.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => codeSpans[Number(i)] ?? '');
  return r;
}

export function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];

  const flushList = () => {
    if (listType && listItems.length > 0) {
      const tag = listType === 'ul' ? 'ul' : 'ol';
      out.push(`<${tag}>`);
      for (const item of listItems) out.push(`  <li>${renderInline(item)}</li>`);
      out.push(`</${tag}>`);
    }
    listType = null;
    listItems = [];
  };

  const pushParagraph = (raw: string) => {
    flushList();
    out.push(`<p>${renderInline(raw)}</p>`);
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeBuf.push(rawLine);
      continue;
    }

    if (trimmed === '') {
      flushList();
      continue;
    }

    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      flushList();
      out.push('<hr />');
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushList();
      out.push(`<blockquote>${renderInline(trimmed.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const ulItem = trimmed.match(/^[-*+]\s+(.*)$/);
    if (ulItem) {
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      listItems.push(ulItem[1]);
      continue;
    }

    const olItem = trimmed.match(/^\d+\.\s+(.*)$/);
    if (olItem) {
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      listItems.push(olItem[1]);
      continue;
    }

    pushParagraph(trimmed);
  }

  flushList();
  if (inCode) out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);

  return out.join('\n');
}

export function htmlDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { max-width: 42rem; margin: 2rem auto; padding: 0 1rem; font-family: Georgia, 'Times New Roman', serif; line-height: 1.7; color: #1a1a1a; }
    h1, h2, h3 { line-height: 1.3; }
    blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1rem; color: #555; }
    pre { background: #f5f5f5; padding: 0.75rem; overflow-x: auto; }
    code { background: #f5f5f5; padding: 0.1rem 0.3rem; }
    hr { border: none; border-top: 1px solid #ddd; margin: 2rem 0; }
    img { max-width: 100%; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

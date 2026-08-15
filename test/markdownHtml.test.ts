import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml, htmlDocument } from '../src/utils/markdownToHtml.js';

test('markdownToHtml: heading và đoạn văn', () => {
  const html = markdownToHtml('# Tiêu đề\n\nĐoạn văn một.\n\nĐoạn văn hai.');
  assert.ok(html.includes('<h1>Tiêu đề</h1>'));
  assert.ok(html.includes('<p>Đoạn văn một.</p>'));
});

test('markdownToHtml: inline bold/italic/code/link', () => {
  const html = markdownToHtml('Chữ **đậm** và _nghiêng_ với `code` và [link](https://x.com).');
  assert.ok(html.includes('<strong>đậm</strong>'));
  assert.ok(html.includes('<em>nghiêng</em>'));
  assert.ok(html.includes('<code>code</code>'));
  assert.ok(html.includes('<a href="https://x.com">link</a>'));
});

test('markdownToHtml: danh sách', () => {
  const html = markdownToHtml('- Một\n- Hai\n- Ba');
  assert.ok(html.includes('<ul>'));
  assert.equal(html.match(/<li>/g)?.length, 3);
});

test('markdownToHtml: escape HTML injection', () => {
  const html = markdownToHtml('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('markdownToHtml: code block', () => {
  const html = markdownToHtml('```\nconst x = 1;\n```');
  assert.ok(html.includes('<pre><code>'));
  assert.ok(html.includes('const x = 1;'));
});

test('markdownToHtml: hr', () => {
  const html = markdownToHtml('A\n\n---\n\nB');
  assert.ok(html.includes('<hr />'));
});

test('htmlDocument: wrapper hợp lệ', () => {
  const doc = htmlDocument('Tác phẩm', '<h1>X</h1>');
  assert.ok(doc.includes('<title>Tác phẩm</title>'));
  assert.ok(doc.includes('<meta charset="UTF-8"'));
});

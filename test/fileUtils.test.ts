import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTextEncoding, decodeBuffer, isSafePathSegment } from '../src/utils/fileUtils.js';

test('detectTextEncoding: UTF-8 hợp lệ', () => {
  assert.equal(detectTextEncoding(Buffer.from('Một buổi sáng đẹp trời', 'utf-8')), 'utf-8');
});

test('detectTextEncoding: UTF-8 BOM', () => {
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('abc')]);
  assert.equal(detectTextEncoding(bom), 'utf-8');
});

test('detectTextEncoding: ASCII', () => {
  assert.equal(detectTextEncoding(Buffer.from('plain ascii')), 'ascii');
});

test('detectTextEncoding: ISO-8859-1 (byte 0xA0-0xFF, không hợp lệ UTF-8)', () => {
  assert.equal(detectTextEncoding(Buffer.from([0xe9, 0x74, 0xe9, 0x20, 0xf4])), 'iso-8859-1');
});

test('detectTextEncoding: Windows-1252 (smart quotes)', () => {
  assert.equal(detectTextEncoding(Buffer.from([0x93, 0x48, 0x69, 0x94, 0x20, 0xe9])), 'windows-1252');
});

test('decodeBuffer: windows-1252 mapping', () => {
  const buf = Buffer.from([0x93, 0x48, 0x69, 0x94, 0x20, 0xe9]);
  const decoded = decodeBuffer(buf, 'windows-1252');
  assert.equal(decoded, '\u201CHi\u201D é');
});

test('decodeBuffer: iso-8859-1', () => {
  assert.equal(decodeBuffer(Buffer.from([0xe9, 0x74, 0xe9]), 'iso-8859-1'), 'été');
});

test('decodeBuffer: utf-8 strip BOM', () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('abc')]);
  assert.equal(decodeBuffer(buf, 'utf-8'), 'abc');
});

test('isSafePathSegment: chặn path traversal', () => {
  assert.equal(isSafePathSegment('arc_01'), true);
  assert.equal(isSafePathSegment('ch_001'), true);
  assert.equal(isSafePathSegment(''), false);
  assert.equal(isSafePathSegment('..'), false);
  assert.equal(isSafePathSegment('../x'), false);
  assert.equal(isSafePathSegment('a/b'), false);
  assert.equal(isSafePathSegment('a\\b'), false);
  assert.equal(isSafePathSegment('..\\..'), false);
  assert.equal(isSafePathSegment('a\0b'), false);
});

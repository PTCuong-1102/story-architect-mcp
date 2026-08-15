import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZip, crc32 } from '../src/utils/zip.js';
import * as zlib from 'node:zlib';

/** Đọc nhanh cấu trúc ZIP để kiểm tra (chỉ local headers + data). */
function readZipEntries(buf: Buffer): { name: string; data: Buffer; method: number; crc: number }[] {
  const entries: { name: string; data: Buffer; method: number; crc: number }[] = [];
  let pos = 0;
  while (buf.readUInt32LE(pos) === 0x04034b50) {
    const method = buf.readUInt16LE(pos + 8);
    const crc = buf.readUInt32LE(pos + 14);
    const compSize = buf.readUInt32LE(pos + 18);
    const nameLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const name = buf.slice(pos + 30, pos + 30 + nameLen).toString('utf-8');
    const data = buf.slice(pos + 30 + nameLen + extraLen, pos + 30 + nameLen + extraLen + compSize);
    entries.push({ name, data, method, crc });
    pos += 30 + nameLen + extraLen + compSize;
  }
  return entries;
}

test('crc32: giá trị biết trước', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('')), 0x00000000);
});

test('createZip: entries stored đọc lại nguyên vẹn', () => {
  const buf = createZip([
    { name: 'a.txt', data: Buffer.from('Hello World') },
    { name: 'sub/b.txt', data: Buffer.from('Nội dung tiếng Việt: ậ ơ ư') },
  ]);
  const entries = readZipEntries(buf);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'a.txt');
  assert.equal(entries[0].data.toString(), 'Hello World');
  assert.equal(entries[1].data.toString(), 'Nội dung tiếng Việt: ậ ơ ư');
  // crc khớp
  for (const e of entries) assert.equal(crc32(e.data), e.crc);
});

test('createZip: deflate entry giải nén đúng', () => {
  const content = Buffer.from('abcdef'.repeat(100));
  const buf = createZip([{ name: 'f.txt', data: content, deflate: true }]);
  const [entry] = readZipEntries(buf);
  assert.equal(entry.method, 8);
  assert.equal(zlib.inflateRawSync(entry.data).toString(), content.toString());
  assert.equal(crc32(content), entry.crc);
});

test('createZip: có End of Central Directory', () => {
  const buf = createZip([{ name: 'x', data: Buffer.from('y') }]);
  const eocdPos = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocdPos), 0x06054b50);
  assert.equal(buf.readUInt16LE(eocdPos + 8), 1); // số entry
});

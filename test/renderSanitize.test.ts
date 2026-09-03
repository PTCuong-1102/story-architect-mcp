import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMermaidLabel, generateMermaidTimeline } from '../src/tools/analysis/detectTimeline.js';
import { generateDashboardHtml } from '../src/tools/dashboard.js';
import type { TimelineEvent } from '../src/server/types.js';

function makeEvent(over: Partial<TimelineEvent> & { label: string }): TimelineEvent {
  return {
    id: 'evt_test',
    description: '',
    relativeOrder: 1,
    characters: [],
    ...over,
  };
}

describe('sanitizeMermaidLabel', () => {
  it('trung hòa ký tự phá cú pháp flowchart', () => {
    const out = sanitizeMermaidLabel('Gặp gỡ [định mệnh] {lần đầu} "nguy hiểm"\ndòng 2');
    assert.ok(!out.includes('[') && !out.includes(']'), `còn ngoặc vuông: ${out}`);
    assert.ok(!out.includes('{') && !out.includes('}'), `còn ngoặc nhọn: ${out}`);
    assert.ok(!out.includes('"') && !out.includes('\n'), `còn quote/xuống dòng: ${out}`);
    assert.ok(out.includes('(định mệnh)'), `ngoặc vuông phải thành ngoặc tròn: ${out}`);
  });

  it('giữ nguyên ký tự an toàn trong trích dẫn', () => {
    const out = sanitizeMermaidLabel('Âm mưu --> phản bội | tập 2 & đồng bọn 👥');
    assert.ok(out.includes('-->'), `mất -->: ${out}`);
    assert.ok(out.includes('|'), `mất |: ${out}`);
    assert.ok(out.includes('&'), `mất &: ${out}`);
    assert.ok(out.includes('👥'), `mất emoji: ${out}`);
  });

  it('cắt ngắn nhãn quá dài có dấu …', () => {
    const out = sanitizeMermaidLabel('a'.repeat(200), 140);
    assert.ok(out.length <= 140, `dài ${out.length}`);
    assert.ok(out.endsWith('…'), `thiếu …: ${out.slice(-5)}`);
  });
});

describe('generateMermaidTimeline', () => {
  it('node label không chứa ký tự phá vỡ cú pháp', () => {
    const md = generateMermaidTimeline([
      makeEvent({ id: 'a1', label: 'Gặp [định mệnh] {lớn}', chapter: 'arc_01/ch_001', relativeOrder: 1, characters: ['Tiêu Viêm'], location: 'Núi [cao] (cổng <nam>)', thread: 'Tuyến "chính" [mới]' }),
    ]);
    // Lấy phần text trong từng node ["..."]: không được có [ ] { }
    const nodeTexts = [...md.matchAll(/\["([\s\S]*?)"\]/g)].map(m => m[1]);
    assert.ok(nodeTexts.length > 0, 'phải có ít nhất 1 node');
    for (const t of nodeTexts) {
      assert.ok(!/[[{}\]]/.test(t.replace(/<br\/>/g, '')), `node chứa ký tự nguy hiểm: ${t}`);
    }
  });

  it('node ID ổn định theo event.id, không phụ thuộc thứ tự render', () => {
    const ev1 = makeEvent({ id: 'evt_AAA', label: 'Một', relativeOrder: 1 });
    const ev2 = makeEvent({ id: 'evt_BBB', label: 'Hai', relativeOrder: 2 });
    const idsOf = (md: string) => [...md.matchAll(/^\s+(n_\w+)/gm)].map(m => m[1]).sort();
    const forward = idsOf(generateMermaidTimeline([ev1, ev2]));
    const backward = idsOf(generateMermaidTimeline([ev2, ev1]));
    assert.deepEqual(forward, backward);
    assert.ok(forward.some(id => id.includes('AAA')), `ID phải dẫn xuất từ event.id: ${forward}`);
  });

  it('timeline rỗng trả placeholder hợp lệ', () => {
    const md = generateMermaidTimeline([]);
    assert.ok(md.includes('flowchart'), 'phải có flowchart kể cả khi rỗng');
  });
});

describe('generateDashboardHtml escaping', () => {
  it('dữ liệu người dùng chứa < > & không phá layout', () => {
    const html = generateDashboardHtml(
      'Truyện <Demo>',
      'Tác giả "Test" & Co.',
      ['Kiếm hiệp'],
      { totalWordCount: 100, completionPercent: 10, chapterCount: 1, arcCount: 1 },
      [{ status: 'open', title: 'Lỗ <hổng> & "nghiêm trọng"', severity: 'high', chapters: [], description: 'Mô tả có <tag> lạ' }],
      [{ status: 'planted', setup: 'Kiếm [cũ]', setupChapter: 'arc_01/ch_001', importance: 'major' }],
      [{ source: 'A <B>', target: 'C', type: 'friend', description: '', provenance: 'extracted' }],
      ['A <B>', 'C'],
      { overallTone: 'Vui <vẻ>', overallPolarity: 0.5 },
    );
    assert.ok(!html.includes('<hổng>'), 'thẻ lạ lọt vào HTML');
    assert.ok(!html.includes('<tag>'), 'thẻ lạ lọt vào HTML');
    assert.ok(!html.includes('<Demo>'), 'title chưa escape');
    assert.ok(html.includes('&lt;hổng&gt;'), 'thiếu escape entity');
    assert.ok(html.includes('&amp;'), 'dấu & chưa escape');
    assert.ok(html.includes('A &lt;B&gt;'), 'tên nhân vật chưa escape');
  });
});

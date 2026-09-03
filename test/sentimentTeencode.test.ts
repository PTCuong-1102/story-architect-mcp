import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSentiment } from '../src/utils/sentimentLexicon.js';

describe('sentimentLexicon: teencode & tiếng Việt mạng', () => {
  it('phủ định teencode đảo dấu polarity (k/ko/khong)', () => {
    const pos = analyzeSentiment('Nàng vui vẻ mỉm cười.');
    assert.ok(pos.polarity > 0, `gốc phải dương, nhận: ${pos.polarity}`);

    for (const neg of ['Nàng k vui.', 'Nàng ko vui ve.', 'Nang khong vui ve.']) {
      const r = analyzeSentiment(neg);
      assert.ok(r.polarity <= 0, `"${neg}" phải <= 0, nhận: ${r.polarity}`);
    }
  });

  it('chữ kéo dài được chuẩn hóa (vuiii → vui)', () => {
    const r = analyzeSentiment('Hôm nay vuiiiiii quá đi.');
    assert.ok(r.polarity > 0, `phải dương, nhận: ${r.polarity}`);
    assert.strictEqual(r.dominantEmotion, 'joy');
  });

  it('tiếng cười/khóc gõ lặp (hahaha/huhu)', () => {
    const laugh = analyzeSentiment('hahaha vui quá hahaha');
    assert.ok(laugh.polarity > 0, `cười phải dương, nhận: ${laugh.polarity}`);

    const cry = analyzeSentiment('huhuhu buồn quá');
    assert.ok(cry.polarity < 0, `khóc phải âm, nhận: ${cry.polarity}`);
  });

  it('emoticon ASCII cộng/trừ điểm cảm xúc', () => {
    const happy = analyzeSentiment('Buổi họp lớp hôm nay :)');
    const sad = analyzeSentiment('Buổi họp lớp hôm nay :(');
    assert.ok(
      happy.polarity > sad.polarity,
      `":)" (${happy.polarity}) phải cao hơn ":(" (${sad.polarity})`,
    );
  });

  it('text không dấu vẫn nhận diện được (fallback có kiểm soát)', () => {
    const r = analyzeSentiment('Hom nay hanh phuc va hy vong.');
    assert.ok(r.polarity > 0.2, `phải dương rõ, nhận: ${r.polarity}`);
    assert.strictEqual(r.dominantEmotion, 'joy');
  });

  it('slang tiêu cực hiện đại (toang/cay/gắt + intensifier vãi)', () => {
    const r = analyzeSentiment('Trận này toang rồi, cay vãi.');
    assert.ok(r.polarity < -0.2, `phải âm rõ, nhận: ${r.polarity}`);
  });

  it('slang tích cực hiện đại (ngon/đỉnh)', () => {
    const r = analyzeSentiment('Món này ngon, đỉnh thật sự.');
    assert.ok(r.polarity > 0.3, `phải dương rõ, nhận: ${r.polarity}`);
  });

  it('từ chức năng không rơi vào fallback sai (cho/an/do trung tính)', () => {
    // "cho" (for), "an" (ăn/article), "do" (tiếng Anh) không được tính điểm cảm xúc
    const r = analyzeSentiment('Cho an do.');
    assert.strictEqual(r.sentimentWordCount, 0, `phải 0 từ cảm xúc, nhận: ${r.sentimentWordCount}`);
    assert.strictEqual(r.polarity, 0);
  });

  it('dấu câu cuối câu không làm mất match (. ! ?)', () => {
    const r = analyzeSentiment('Buồn! Đau đớn? Tuyệt vọng.');
    assert.ok(r.polarity < -0.3, `phải âm rõ, nhận: ${r.polarity}`);
  });
});

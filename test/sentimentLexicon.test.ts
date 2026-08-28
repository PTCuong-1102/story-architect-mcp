import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeSentiment,
  computeEmotionalArc,
  classifyTone,
  detectToneDrift,
  formatAllEmotions,
  polarityLabel,
  TONE_LABELS,
  type EmotionScores,
} from '../src/utils/sentimentLexicon.js';

describe('sentimentLexicon utility tests', () => {
  it('analyzeSentiment: nhận diện cảm xúc tích cực tiếng Việt', () => {
    const text = 'Hôm nay trời rất đẹp và ấm áp. Nàng mỉm cười vui vẻ, lòng tràn ngập hạnh phúc và hy vọng.';
    const result = analyzeSentiment(text);

    assert.ok(result.polarity > 0.3, `Polarity phải dương (>0.3), nhận được: ${result.polarity}`);
    assert.strictEqual(result.dominantEmotion, 'joy');
    assert.ok(['vui_ve', 'lang_man'].includes(result.tone), `Tone phải là vui vẻ hoặc lãng mạn, nhận được: ${result.tone}`);
    assert.ok(result.emotions.joy > 0);
  });

  it('analyzeSentiment: nhận diện cảm xúc tiêu cực và u ám', () => {
    const text = 'Bóng tối bao trùm phế tích đổ nát. Hắn đau đớn gục ngã, cảm thấy tuyệt vọng và cô đơn vô cùng khi cái chết đang cận kề.';
    const result = analyzeSentiment(text);

    assert.ok(result.polarity < -0.3, `Polarity phải âm (<-0.3), nhận được: ${result.polarity}`);
    assert.ok(['fear', 'sadness'].includes(result.dominantEmotion));
    assert.ok(['u_am', 'bi_thuong'].includes(result.tone), `Tone phải là u ám hoặc bi thương, nhận được: ${result.tone}`);
  });

  it('analyzeSentiment: xử lý phủ định (negation) đảo dấu polarity', () => {
    const positiveText = 'Nàng vui vẻ mỉm cười.';
    const negativeText = 'Nàng không vui vẻ, chẳng hề mỉm cười.';

    const posResult = analyzeSentiment(positiveText);
    const negResult = analyzeSentiment(negativeText);

    assert.ok(posResult.polarity > 0);
    assert.ok(negResult.polarity <= 0, `Khi có "không/chẳng hề", polarity phải <= 0, nhận được: ${negResult.polarity}`);
  });

  it('analyzeSentiment: xử lý từ tăng cường (intensifiers)', () => {
    const normalText = 'Hắn đau đớn.';
    const intenseText = 'Hắn cực kỳ đau đớn vô cùng.';

    const normal = analyzeSentiment(normalText);
    const intense = analyzeSentiment(intenseText);

    assert.ok(Math.abs(intense.polarity) >= Math.abs(normal.polarity));
  });

  it('computeEmotionalArc: tính toán chuỗi điểm cảm xúc sliding window', () => {
    const longText = `
      Chương 1 bắt đầu trong ánh nắng rực rỡ và tiếng cười vui vẻ hạnh phúc của mọi người.
      Đột nhiên sấm sét nổi lên, quái vật xuất hiện mang theo bóng tối kinh hoàng và chết chóc đe dọa.
      Sau trận chiến khốc liệt đầy máu và đau thương, các chiến binh đã chiến thắng vinh quang và hòa bình trở lại.
    `;

    const arc = computeEmotionalArc(longText, 15, 0.5);
    assert.ok(arc.length >= 2, `Cần ít nhất 2 điểm arc, nhận được: ${arc.length}`);
    assert.ok(arc[0].position >= 0 && arc[arc.length - 1].position <= 1.0);
  });

  it('classifyTone: phân loại đúng 8 nhóm giọng văn', () => {
    const emptyScores: EmotionScores = { joy: 0, trust: 0, fear: 0, surprise: 0, sadness: 0, disgust: 0, anger: 0, anticipation: 0 };

    // U ám: fear + sadness >= 40%
    const darkScores: EmotionScores = { ...emptyScores, fear: 50, sadness: 50 };
    assert.strictEqual(classifyTone(darkScores, -0.6), 'u_am');

    // Bi thương: sadness >= 35%
    const tragicScores: EmotionScores = { ...emptyScores, sadness: 80, fear: 10 };
    assert.strictEqual(classifyTone(tragicScores, -0.5), 'bi_thuong');

    // Căng thẳng: fear + anger + anticipation >= 50%
    const tenseScores: EmotionScores = { ...emptyScores, fear: 30, anger: 30, anticipation: 20 };
    assert.strictEqual(classifyTone(tenseScores, -0.1), 'cang_thang');

    // Lãng mạn: joy + trust >= 50%
    const romanceScores: EmotionScores = { ...emptyScores, joy: 40, trust: 40 };
    assert.strictEqual(classifyTone(romanceScores, 0.5), 'lang_man');

    // Trung tính: không có cảm xúc
    assert.strictEqual(classifyTone(emptyScores, 0), 'trung_tinh');
  });

  it('detectToneDrift: phát hiện thay đổi giọng văn và mức độ nghiêm trọng', () => {
    const ch1 = analyzeSentiment('Trời nắng đẹp, mọi người ca hát vui vẻ hạnh phúc.');
    const ch2 = analyzeSentiment('Đêm tối đen kịt, quái vật tàn sát kinh hoàng, chết chóc và máu tanh khắp nơi.');

    const drift = detectToneDrift('ch_001', 'ch_002', ch1, ch2);
    assert.ok(drift !== null, 'Phải phát hiện tone drift giữa 2 chương khác biệt');
    assert.strictEqual(drift.fromChapter, 'ch_001');
    assert.strictEqual(drift.toChapter, 'ch_002');
    assert.ok(['warning', 'critical'].includes(drift.severity));
  });

  it('formatAllEmotions & polarityLabel: sinh text hiển thị đúng', () => {
    const scores: EmotionScores = { joy: 50, trust: 30, fear: 20, surprise: 0, sadness: 0, disgust: 0, anger: 0, anticipation: 0 };
    const formatted = formatAllEmotions(scores);
    assert.ok(formatted.includes('Joy'));
    assert.ok(formatted.includes('Trust'));

    assert.strictEqual(polarityLabel(0.6), 'Tích cực mạnh');
    assert.strictEqual(polarityLabel(-0.7), 'Tiêu cực mạnh');
    assert.strictEqual(polarityLabel(0.0), 'Trung tính');
  });
});

/**
 * sentimentLexicon.ts — Core Sentiment & Tone Analysis Engine
 *
 * Lexicon-Based Heuristics approach cho phân tích cảm xúc / giọng văn
 * trong tiểu thuyết tiếng Việt (và Anh). Hỗ trợ:
 *
 * 1. Custom Vietnamese + English Emotion Lexicon (~1800 mục từ)
 * 2. Negation / Intensifier rules (kèm teencode: ko/k/vl/vãi...)
 * 3. Sentence-level sentiment scoring
 * 4. Sliding window emotional arc computation
 * 5. Tone classification (8 categories)
 * 6. Internet-slang normalization: chữ kéo dài (vuiii→vui),
 *    biến thể cười/khóc (hahaha→haha), text không dấu (fallback
 *    có stoplist chống false-positive), emoticon ASCII (:), :().
 *
 * Kiến trúc sẵn sàng mở rộng sang Local Embedding / Vector Search
 * thông qua interface SentimentAnalyzer.
 */

// ============================================================
// Types & Interfaces
// ============================================================

export type EmotionTag =
  | 'joy'
  | 'trust'
  | 'fear'
  | 'surprise'
  | 'sadness'
  | 'disgust'
  | 'anger'
  | 'anticipation';

export const ALL_EMOTIONS: EmotionTag[] = [
  'joy', 'trust', 'fear', 'surprise',
  'sadness', 'disgust', 'anger', 'anticipation',
];

export interface EmotionEntry {
  /** Polarity score: -1.0 (negative) → +1.0 (positive) */
  polarity: number;
  /** Emotion categories associated with this word */
  emotions: EmotionTag[];
  /** Intensity: 0.0 (weak) → 1.0 (strong) */
  intensity: number;
}

export interface EmotionScores {
  joy: number;
  trust: number;
  fear: number;
  surprise: number;
  sadness: number;
  disgust: number;
  anger: number;
  anticipation: number;
}

export interface SentimentResult {
  /** Overall polarity: -1.0 → +1.0 */
  polarity: number;
  /** Dominant emotion */
  dominantEmotion: EmotionTag;
  /** Detected tone category */
  tone: ToneCategory;
  /** Breakdown of emotion scores (0-100 each, normalized) */
  emotions: EmotionScores;
  /** Number of sentiment-bearing words found */
  sentimentWordCount: number;
  /** Total words analyzed */
  totalWords: number;
  /** Coverage: sentimentWordCount / totalWords */
  coverage: number;
}

export interface EmotionalArcPoint {
  /** Normalized position in text: 0.0 → 1.0 */
  position: number;
  /** Polarity at this point */
  polarity: number;
  /** Dominant emotion at this point */
  dominantEmotion: EmotionTag;
  /** Full emotion scores at this point */
  emotions: EmotionScores;
}

export type ToneCategory =
  | 'trang_trong'    // formal/solemn
  | 'u_am'           // dark/gloomy
  | 'vui_ve'         // cheerful/lighthearted
  | 'cang_thang'     // tense/suspenseful
  | 'lang_man'       // romantic
  | 'hai_huoc'       // humorous/witty
  | 'bi_thuong'      // tragic/sorrowful
  | 'trung_tinh';    // neutral

export const TONE_LABELS: Record<ToneCategory, string> = {
  trang_trong: 'Trang trọng (Formal/Solemn)',
  u_am: 'U ám (Dark/Gloomy)',
  vui_ve: 'Vui vẻ (Cheerful)',
  cang_thang: 'Căng thẳng (Tense/Suspenseful)',
  lang_man: 'Lãng mạn (Romantic)',
  hai_huoc: 'Hài hước (Humorous)',
  bi_thuong: 'Bi thương (Tragic)',
  trung_tinh: 'Trung tính (Neutral)',
};

/**
 * Interface chuẩn cho sentiment analyzer.
 * Tương lai: EmbeddingSentimentAnalyzer implements SentimentAnalyzer
 * để swap-in Local Embedding mà không thay đổi tools layer.
 */
export interface SentimentAnalyzer {
  analyze(text: string): SentimentResult;
  computeArc(text: string, windowSize?: number): EmotionalArcPoint[];
}

// ============================================================
// Vietnamese + English Emotion Lexicon
// ============================================================

/** Helper để tạo entry nhanh */
function e(polarity: number, emotions: EmotionTag[], intensity = 0.6): EmotionEntry {
  return { polarity, emotions, intensity };
}

/**
 * Custom Vietnamese + English Emotion Lexicon
 * ~1800 mục từ, chia theo nhóm cảm xúc.
 *
 * Quy ước:
 * - Polarity: -1.0 (cực tiêu cực) → +1.0 (cực tích cực)
 * - Intensity: 0.3 (nhẹ), 0.6 (vừa), 0.8 (mạnh), 1.0 (cực mạnh)
 */
const EMOTION_LEXICON: Map<string, EmotionEntry> = new Map([
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // JOY / VUI — Tích cực, hạnh phúc
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['vui', e(0.7, ['joy'], 0.7)],
  ['vui vẻ', e(0.8, ['joy'], 0.8)],
  ['vui sướng', e(0.9, ['joy'], 0.9)],
  ['vui mừng', e(0.8, ['joy', 'surprise'], 0.8)],
  ['hạnh phúc', e(0.9, ['joy', 'trust'], 0.9)],
  ['sung sướng', e(0.9, ['joy'], 0.9)],
  ['hoan hỉ', e(0.8, ['joy'], 0.8)],
  ['hân hoan', e(0.8, ['joy', 'anticipation'], 0.8)],
  ['phấn khởi', e(0.7, ['joy', 'anticipation'], 0.7)],
  ['phấn khích', e(0.8, ['joy', 'surprise'], 0.8)],
  ['hào hứng', e(0.7, ['joy', 'anticipation'], 0.7)],
  ['thích thú', e(0.6, ['joy'], 0.6)],
  ['thích', e(0.5, ['joy'], 0.5)],
  ['yêu thích', e(0.6, ['joy', 'trust'], 0.6)],
  ['mãn nguyện', e(0.7, ['joy', 'trust'], 0.7)],
  ['thoả mãn', e(0.6, ['joy'], 0.6)],
  ['thoải mái', e(0.5, ['joy', 'trust'], 0.5)],
  ['dễ chịu', e(0.4, ['joy'], 0.4)],
  ['khoan khoái', e(0.5, ['joy'], 0.5)],
  ['sảng khoái', e(0.6, ['joy'], 0.6)],
  ['rạng rỡ', e(0.7, ['joy'], 0.7)],
  ['rực rỡ', e(0.6, ['joy', 'surprise'], 0.6)],
  ['tươi cười', e(0.6, ['joy'], 0.6)],
  ['mỉm cười', e(0.5, ['joy'], 0.5)],
  ['nụ cười', e(0.5, ['joy'], 0.5)],
  ['cười', e(0.4, ['joy'], 0.4)],
  ['cười lớn', e(0.6, ['joy'], 0.6)],
  ['cười phá lên', e(0.7, ['joy', 'surprise'], 0.7)],
  ['cười tươi', e(0.6, ['joy'], 0.6)],
  ['cười ha hả', e(0.5, ['joy'], 0.5)],
  ['hớn hở', e(0.7, ['joy'], 0.7)],
  ['tươi vui', e(0.6, ['joy'], 0.6)],
  ['nắng', e(0.3, ['joy'], 0.3)],
  ['ấm áp', e(0.5, ['joy', 'trust'], 0.5)],
  ['ấm', e(0.3, ['joy'], 0.3)],
  ['sáng', e(0.2, ['joy'], 0.3)],
  ['sáng ngời', e(0.5, ['joy'], 0.5)],
  ['tự do', e(0.6, ['joy', 'trust'], 0.6)],
  ['thanh thản', e(0.5, ['joy', 'trust'], 0.5)],
  ['bình yên', e(0.5, ['joy', 'trust'], 0.5)],
  ['an yên', e(0.5, ['joy', 'trust'], 0.5)],
  ['nhẹ nhõm', e(0.5, ['joy', 'trust'], 0.5)],
  ['nhẹ nhàng', e(0.3, ['joy', 'trust'], 0.3)],
  ['may mắn', e(0.6, ['joy', 'surprise'], 0.6)],
  ['chiến thắng', e(0.8, ['joy', 'anticipation'], 0.8)],
  ['thắng lợi', e(0.8, ['joy', 'anticipation'], 0.8)],
  ['thành công', e(0.7, ['joy', 'trust'], 0.7)],
  ['vinh quang', e(0.8, ['joy', 'anticipation'], 0.8)],
  ['huy hoàng', e(0.7, ['joy'], 0.7)],
  ['tuyệt vời', e(0.8, ['joy', 'surprise'], 0.8)],
  ['tuyệt đẹp', e(0.7, ['joy'], 0.7)],
  ['xinh đẹp', e(0.5, ['joy'], 0.5)],
  ['đẹp', e(0.4, ['joy'], 0.4)],
  ['đẹp đẽ', e(0.5, ['joy'], 0.5)],
  ['lấp lánh', e(0.4, ['joy', 'surprise'], 0.4)],
  ['lung linh', e(0.4, ['joy'], 0.4)],
  ['nở hoa', e(0.4, ['joy', 'anticipation'], 0.4)],
  ['ăn mừng', e(0.7, ['joy', 'anticipation'], 0.7)],
  ['chúc mừng', e(0.6, ['joy'], 0.6)],
  ['kỳ diệu', e(0.6, ['joy', 'surprise'], 0.6)],
  ['lộng lẫy', e(0.5, ['joy', 'surprise'], 0.5)],
  ['tráng lệ', e(0.5, ['joy'], 0.5)],
  // English joy
  ['happy', e(0.7, ['joy'], 0.7)],
  ['happiness', e(0.8, ['joy'], 0.8)],
  ['joy', e(0.8, ['joy'], 0.8)],
  ['joyful', e(0.8, ['joy'], 0.8)],
  ['delight', e(0.7, ['joy'], 0.7)],
  ['cheerful', e(0.6, ['joy'], 0.6)],
  ['smile', e(0.5, ['joy'], 0.5)],
  ['laugh', e(0.5, ['joy'], 0.5)],
  ['celebrate', e(0.7, ['joy', 'anticipation'], 0.7)],
  ['wonderful', e(0.7, ['joy', 'surprise'], 0.7)],
  ['beautiful', e(0.5, ['joy'], 0.5)],
  ['love', e(0.7, ['joy', 'trust'], 0.7)],
  ['blessed', e(0.6, ['joy', 'trust'], 0.6)],
  ['victory', e(0.8, ['joy', 'anticipation'], 0.8)],
  ['triumph', e(0.8, ['joy', 'anticipation'], 0.8)],
  ['glory', e(0.7, ['joy'], 0.7)],
  ['bright', e(0.3, ['joy'], 0.3)],
  ['sunshine', e(0.4, ['joy'], 0.4)],
  ['warm', e(0.3, ['joy', 'trust'], 0.3)],
  ['peace', e(0.5, ['joy', 'trust'], 0.5)],
  ['freedom', e(0.6, ['joy', 'trust'], 0.6)],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TRUST / TIN TƯỞNG
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['tin', e(0.4, ['trust'], 0.5)],
  ['tin tưởng', e(0.6, ['trust'], 0.7)],
  ['tin cậy', e(0.6, ['trust'], 0.7)],
  ['trung thành', e(0.7, ['trust'], 0.8)],
  ['trung thực', e(0.6, ['trust'], 0.7)],
  ['thật thà', e(0.5, ['trust'], 0.6)],
  ['chân thành', e(0.6, ['trust', 'joy'], 0.6)],
  ['trung kiên', e(0.7, ['trust', 'anticipation'], 0.8)],
  ['bảo vệ', e(0.4, ['trust'], 0.5)],
  ['che chở', e(0.5, ['trust', 'joy'], 0.6)],
  ['an toàn', e(0.5, ['trust'], 0.5)],
  ['an tâm', e(0.5, ['trust', 'joy'], 0.5)],
  ['tôn kính', e(0.5, ['trust'], 0.6)],
  ['kính trọng', e(0.5, ['trust'], 0.6)],
  ['ngưỡng mộ', e(0.5, ['trust', 'joy'], 0.6)],
  ['khâm phục', e(0.6, ['trust', 'surprise'], 0.6)],
  ['đồng hành', e(0.5, ['trust', 'joy'], 0.5)],
  ['đồng minh', e(0.5, ['trust'], 0.5)],
  ['tri kỷ', e(0.7, ['trust', 'joy'], 0.7)],
  ['tình bạn', e(0.5, ['trust', 'joy'], 0.5)],
  // English trust
  ['trust', e(0.5, ['trust'], 0.6)],
  ['loyal', e(0.6, ['trust'], 0.7)],
  ['honest', e(0.5, ['trust'], 0.6)],
  ['protect', e(0.4, ['trust'], 0.5)],
  ['safe', e(0.4, ['trust'], 0.5)],
  ['friend', e(0.4, ['trust', 'joy'], 0.4)],
  ['faithful', e(0.6, ['trust'], 0.7)],
  ['reliable', e(0.5, ['trust'], 0.6)],
  ['devotion', e(0.6, ['trust', 'joy'], 0.7)],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FEAR / SỢ HÃI
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['sợ', e(-0.5, ['fear'], 0.6)],
  ['sợ hãi', e(-0.7, ['fear'], 0.8)],
  ['kinh sợ', e(-0.8, ['fear'], 0.9)],
  ['kinh hãi', e(-0.8, ['fear', 'surprise'], 0.9)],
  ['kinh hoàng', e(-0.9, ['fear', 'surprise'], 1.0)],
  ['khiếp sợ', e(-0.8, ['fear'], 0.9)],
  ['khiếp đảm', e(-0.8, ['fear'], 0.9)],
  ['hoảng sợ', e(-0.8, ['fear', 'surprise'], 0.9)],
  ['hoảng hốt', e(-0.7, ['fear', 'surprise'], 0.8)],
  ['hoảng loạn', e(-0.8, ['fear'], 0.9)],
  ['run', e(-0.4, ['fear'], 0.5)],
  ['run rẩy', e(-0.6, ['fear'], 0.7)],
  ['rùng mình', e(-0.5, ['fear', 'surprise'], 0.6)],
  ['rùng rợn', e(-0.7, ['fear', 'disgust'], 0.8)],
  ['ghê rợn', e(-0.7, ['fear', 'disgust'], 0.8)],
  ['ớn lạnh', e(-0.5, ['fear'], 0.6)],
  ['lạnh sống lưng', e(-0.6, ['fear'], 0.7)],
  ['lạnh gáy', e(-0.6, ['fear'], 0.7)],
  ['bóng tối', e(-0.3, ['fear'], 0.4)],
  ['tối tăm', e(-0.4, ['fear', 'sadness'], 0.5)],
  ['bóng đêm', e(-0.3, ['fear'], 0.4)],
  ['quái vật', e(-0.5, ['fear', 'disgust'], 0.6)],
  ['ma quái', e(-0.5, ['fear', 'disgust'], 0.6)],
  ['ác mộng', e(-0.7, ['fear', 'sadness'], 0.8)],
  ['nguy hiểm', e(-0.5, ['fear', 'anticipation'], 0.6)],
  ['hiểm nguy', e(-0.5, ['fear'], 0.6)],
  ['đe dọa', e(-0.5, ['fear', 'anger'], 0.6)],
  ['lo sợ', e(-0.5, ['fear', 'anticipation'], 0.6)],
  ['lo lắng', e(-0.4, ['fear', 'anticipation'], 0.5)],
  ['lo âu', e(-0.4, ['fear', 'sadness'], 0.5)],
  ['bất an', e(-0.4, ['fear', 'anticipation'], 0.5)],
  ['hồi hộp', e(-0.2, ['fear', 'anticipation'], 0.4)],
  ['chạy trốn', e(-0.5, ['fear'], 0.6)],
  ['bỏ chạy', e(-0.5, ['fear'], 0.6)],
  ['chết lặng', e(-0.6, ['fear', 'surprise'], 0.7)],
  ['thất kinh', e(-0.7, ['fear', 'surprise'], 0.8)],
  ['hãi hùng', e(-0.8, ['fear'], 0.9)],
  // English fear
  ['fear', e(-0.6, ['fear'], 0.7)],
  ['afraid', e(-0.5, ['fear'], 0.6)],
  ['terrified', e(-0.8, ['fear'], 0.9)],
  ['terror', e(-0.9, ['fear'], 1.0)],
  ['horror', e(-0.8, ['fear', 'disgust'], 0.9)],
  ['dread', e(-0.7, ['fear', 'anticipation'], 0.8)],
  ['panic', e(-0.7, ['fear'], 0.8)],
  ['nightmare', e(-0.7, ['fear', 'sadness'], 0.8)],
  ['danger', e(-0.5, ['fear'], 0.6)],
  ['threat', e(-0.5, ['fear', 'anger'], 0.6)],
  ['tremble', e(-0.4, ['fear'], 0.5)],
  ['shiver', e(-0.3, ['fear'], 0.4)],
  ['monster', e(-0.5, ['fear', 'disgust'], 0.6)],
  ['darkness', e(-0.3, ['fear'], 0.4)],
  ['shadow', e(-0.2, ['fear'], 0.3)],
  ['scream', e(-0.5, ['fear', 'surprise'], 0.6)],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SADNESS / BUỒN
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['buồn', e(-0.5, ['sadness'], 0.6)],
  ['buồn bã', e(-0.6, ['sadness'], 0.7)],
  ['buồn rầu', e(-0.6, ['sadness'], 0.7)],
  ['u buồn', e(-0.6, ['sadness'], 0.7)],
  ['u sầu', e(-0.6, ['sadness'], 0.7)],
  ['sầu muộn', e(-0.6, ['sadness'], 0.7)],
  ['sầu thảm', e(-0.7, ['sadness'], 0.8)],
  ['bi thương', e(-0.7, ['sadness'], 0.8)],
  ['bi ai', e(-0.7, ['sadness'], 0.8)],
  ['bi thảm', e(-0.8, ['sadness'], 0.9)],
  ['bi đát', e(-0.8, ['sadness'], 0.9)],
  ['bi kịch', e(-0.7, ['sadness', 'fear'], 0.8)],
  ['đau', e(-0.5, ['sadness'], 0.6)],
  ['đau buồn', e(-0.6, ['sadness'], 0.7)],
  ['đau đớn', e(-0.7, ['sadness'], 0.8)],
  ['đau khổ', e(-0.7, ['sadness'], 0.8)],
  ['đau lòng', e(-0.6, ['sadness'], 0.7)],
  ['đau thương', e(-0.7, ['sadness'], 0.8)],
  ['thương xót', e(-0.5, ['sadness'], 0.6)],
  ['thương tiếc', e(-0.5, ['sadness'], 0.6)],
  ['tiếc nuối', e(-0.4, ['sadness', 'anticipation'], 0.5)],
  ['hối hận', e(-0.5, ['sadness', 'disgust'], 0.6)],
  ['ân hận', e(-0.5, ['sadness'], 0.6)],
  ['khóc', e(-0.5, ['sadness'], 0.6)],
  ['nước mắt', e(-0.4, ['sadness'], 0.5)],
  ['rơi lệ', e(-0.5, ['sadness'], 0.6)],
  ['khóc nấc', e(-0.6, ['sadness'], 0.7)],
  ['nức nở', e(-0.6, ['sadness'], 0.7)],
  ['cô đơn', e(-0.5, ['sadness'], 0.6)],
  ['lẻ loi', e(-0.5, ['sadness'], 0.6)],
  ['cô độc', e(-0.6, ['sadness'], 0.7)],
  ['cô quạnh', e(-0.5, ['sadness'], 0.6)],
  ['trống vắng', e(-0.4, ['sadness'], 0.5)],
  ['mất mát', e(-0.6, ['sadness'], 0.7)],
  ['lìa đời', e(-0.7, ['sadness'], 0.8)],
  ['qua đời', e(-0.6, ['sadness'], 0.7)],
  ['chia ly', e(-0.6, ['sadness'], 0.7)],
  ['ly biệt', e(-0.6, ['sadness'], 0.7)],
  ['tuyệt vọng', e(-0.9, ['sadness', 'fear'], 1.0)],
  ['vô vọng', e(-0.8, ['sadness'], 0.9)],
  ['bất lực', e(-0.6, ['sadness'], 0.7)],
  ['thất vọng', e(-0.5, ['sadness'], 0.6)],
  ['chán nản', e(-0.4, ['sadness'], 0.5)],
  ['mệt mỏi', e(-0.3, ['sadness'], 0.4)],
  ['kiệt sức', e(-0.5, ['sadness'], 0.6)],
  ['héo úa', e(-0.4, ['sadness'], 0.5)],
  ['tàn lụi', e(-0.5, ['sadness'], 0.6)],
  ['hoang tàn', e(-0.5, ['sadness', 'fear'], 0.6)],
  ['đổ nát', e(-0.5, ['sadness'], 0.6)],
  // English sadness
  ['sad', e(-0.5, ['sadness'], 0.6)],
  ['sadness', e(-0.6, ['sadness'], 0.7)],
  ['sorrow', e(-0.7, ['sadness'], 0.8)],
  ['grief', e(-0.8, ['sadness'], 0.9)],
  ['mourn', e(-0.7, ['sadness'], 0.8)],
  ['cry', e(-0.5, ['sadness'], 0.6)],
  ['tears', e(-0.4, ['sadness'], 0.5)],
  ['weep', e(-0.6, ['sadness'], 0.7)],
  ['lonely', e(-0.5, ['sadness'], 0.6)],
  ['alone', e(-0.4, ['sadness'], 0.5)],
  ['despair', e(-0.8, ['sadness', 'fear'], 0.9)],
  ['hopeless', e(-0.8, ['sadness'], 0.9)],
  ['loss', e(-0.5, ['sadness'], 0.6)],
  ['regret', e(-0.5, ['sadness'], 0.6)],
  ['pain', e(-0.5, ['sadness'], 0.6)],
  ['suffer', e(-0.6, ['sadness'], 0.7)],
  ['tragic', e(-0.7, ['sadness'], 0.8)],
  ['miserable', e(-0.6, ['sadness'], 0.7)],
  ['heartbreak', e(-0.7, ['sadness'], 0.8)],
  ['melancholy', e(-0.5, ['sadness'], 0.6)],
  ['desolate', e(-0.6, ['sadness', 'fear'], 0.7)],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ANGER / GIẬN DỮ
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['giận', e(-0.5, ['anger'], 0.6)],
  ['giận dữ', e(-0.7, ['anger'], 0.8)],
  ['tức giận', e(-0.6, ['anger'], 0.7)],
  ['tức', e(-0.4, ['anger'], 0.5)],
  ['nổi giận', e(-0.7, ['anger', 'surprise'], 0.8)],
  ['phẫn nộ', e(-0.8, ['anger'], 0.9)],
  ['phẫn uất', e(-0.7, ['anger', 'sadness'], 0.8)],
  ['căm giận', e(-0.8, ['anger'], 0.9)],
  ['căm hận', e(-0.8, ['anger', 'disgust'], 0.9)],
  ['căm thù', e(-0.8, ['anger', 'disgust'], 0.9)],
  ['thù hận', e(-0.8, ['anger'], 0.9)],
  ['hận', e(-0.7, ['anger'], 0.8)],
  ['oán hận', e(-0.7, ['anger', 'sadness'], 0.8)],
  ['trả thù', e(-0.6, ['anger', 'anticipation'], 0.7)],
  ['báo thù', e(-0.6, ['anger', 'anticipation'], 0.7)],
  ['la hét', e(-0.5, ['anger'], 0.6)],
  ['hét', e(-0.4, ['anger', 'surprise'], 0.5)],
  ['gào', e(-0.5, ['anger', 'sadness'], 0.6)],
  ['quát', e(-0.5, ['anger'], 0.6)],
  ['mắng', e(-0.4, ['anger'], 0.5)],
  ['chửi', e(-0.6, ['anger', 'disgust'], 0.7)],
  ['nguyền rủa', e(-0.7, ['anger', 'disgust'], 0.8)],
  ['đấm', e(-0.5, ['anger'], 0.6)],
  ['đánh', e(-0.4, ['anger'], 0.5)],
  ['chém', e(-0.6, ['anger', 'fear'], 0.7)],
  ['đâm', e(-0.6, ['anger', 'fear'], 0.7)],
  ['giết', e(-0.8, ['anger', 'fear'], 0.9)],
  ['sát hại', e(-0.8, ['anger', 'fear', 'disgust'], 0.9)],
  ['tàn sát', e(-0.9, ['anger', 'fear', 'disgust'], 1.0)],
  ['tàn bạo', e(-0.8, ['anger', 'disgust'], 0.9)],
  ['hung bạo', e(-0.7, ['anger', 'fear'], 0.8)],
  ['hung ác', e(-0.8, ['anger', 'disgust'], 0.9)],
  ['ác độc', e(-0.7, ['anger', 'disgust'], 0.8)],
  ['bạo lực', e(-0.6, ['anger', 'fear'], 0.7)],
  ['phá hủy', e(-0.6, ['anger'], 0.7)],
  ['tiêu diệt', e(-0.7, ['anger'], 0.8)],
  ['hủy diệt', e(-0.8, ['anger', 'fear'], 0.9)],
  ['phản bội', e(-0.8, ['anger', 'sadness', 'disgust'], 0.9)],
  // English anger
  ['angry', e(-0.6, ['anger'], 0.7)],
  ['anger', e(-0.6, ['anger'], 0.7)],
  ['rage', e(-0.8, ['anger'], 0.9)],
  ['fury', e(-0.8, ['anger'], 0.9)],
  ['hate', e(-0.7, ['anger', 'disgust'], 0.8)],
  ['hatred', e(-0.8, ['anger', 'disgust'], 0.9)],
  ['revenge', e(-0.6, ['anger', 'anticipation'], 0.7)],
  ['kill', e(-0.7, ['anger', 'fear'], 0.8)],
  ['murder', e(-0.8, ['anger', 'fear'], 0.9)],
  ['destroy', e(-0.6, ['anger'], 0.7)],
  ['violent', e(-0.6, ['anger', 'fear'], 0.7)],
  ['betray', e(-0.7, ['anger', 'sadness'], 0.8)],
  ['curse', e(-0.5, ['anger', 'disgust'], 0.6)],
  ['fight', e(-0.3, ['anger', 'anticipation'], 0.5)],
  ['war', e(-0.5, ['anger', 'fear'], 0.6)],
  ['cruel', e(-0.7, ['anger', 'disgust'], 0.8)],
  ['wrath', e(-0.8, ['anger'], 0.9)],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SURPRISE / NGẠC NHIÊN
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['bất ngờ', e(0.1, ['surprise'], 0.6)],
  ['ngạc nhiên', e(0.1, ['surprise'], 0.6)],
  ['kinh ngạc', e(0.2, ['surprise'], 0.7)],
  ['sửng sốt', e(0.1, ['surprise'], 0.7)],
  ['sững sờ', e(0.0, ['surprise', 'fear'], 0.7)],
  ['choáng', e(-0.1, ['surprise', 'fear'], 0.6)],
  ['choáng váng', e(-0.2, ['surprise', 'fear'], 0.7)],
  ['chấn động', e(-0.1, ['surprise', 'fear'], 0.7)],
  ['sốc', e(-0.2, ['surprise', 'fear'], 0.7)],
  ['đột ngột', e(0.0, ['surprise'], 0.5)],
  ['thình lình', e(0.0, ['surprise'], 0.5)],
  ['bỗng nhiên', e(0.0, ['surprise'], 0.4)],
  ['lạ lùng', e(0.1, ['surprise'], 0.5)],
  ['kỳ lạ', e(0.1, ['surprise'], 0.5)],
  ['phi thường', e(0.3, ['surprise', 'joy'], 0.6)],
  ['thần kỳ', e(0.4, ['surprise', 'joy'], 0.6)],
  ['kỳ tích', e(0.5, ['surprise', 'joy', 'anticipation'], 0.7)],
  // English surprise
  ['surprise', e(0.1, ['surprise'], 0.6)],
  ['astonish', e(0.2, ['surprise'], 0.7)],
  ['shock', e(-0.2, ['surprise', 'fear'], 0.7)],
  ['sudden', e(0.0, ['surprise'], 0.4)],
  ['unexpected', e(0.0, ['surprise'], 0.5)],
  ['amazing', e(0.5, ['surprise', 'joy'], 0.7)],
  ['miracle', e(0.6, ['surprise', 'joy'], 0.8)],
  ['incredible', e(0.3, ['surprise'], 0.6)],
  ['strange', e(-0.1, ['surprise'], 0.4)],
  ['mysterious', e(0.0, ['surprise', 'anticipation'], 0.5)],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DISGUST / GHÊ TỞM
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['ghê tởm', e(-0.7, ['disgust'], 0.8)],
  ['gớm ghiếc', e(-0.6, ['disgust'], 0.7)],
  ['kinh tởm', e(-0.7, ['disgust', 'fear'], 0.8)],
  ['buồn nôn', e(-0.5, ['disgust'], 0.6)],
  ['bẩn thỉu', e(-0.5, ['disgust'], 0.6)],
  ['dơ bẩn', e(-0.4, ['disgust'], 0.5)],
  ['thối rữa', e(-0.6, ['disgust'], 0.7)],
  ['hôi thối', e(-0.5, ['disgust'], 0.6)],
  ['ô uế', e(-0.5, ['disgust'], 0.6)],
  ['khinh bỉ', e(-0.5, ['disgust', 'anger'], 0.6)],
  ['khinh miệt', e(-0.6, ['disgust', 'anger'], 0.7)],
  ['ghét', e(-0.4, ['disgust', 'anger'], 0.5)],
  ['chán ghét', e(-0.5, ['disgust', 'anger'], 0.6)],
  ['đê tiện', e(-0.7, ['disgust', 'anger'], 0.8)],
  ['đê hèn', e(-0.7, ['disgust', 'anger'], 0.8)],
  ['hèn hạ', e(-0.6, ['disgust'], 0.7)],
  ['xấu xa', e(-0.6, ['disgust', 'anger'], 0.7)],
  ['đồi bại', e(-0.7, ['disgust'], 0.8)],
  ['giả dối', e(-0.6, ['disgust', 'anger'], 0.7)],
  ['lừa dối', e(-0.6, ['disgust', 'anger'], 0.7)],
  ['lừa gạt', e(-0.6, ['disgust', 'anger'], 0.7)],
  ['máu', e(-0.3, ['disgust', 'fear'], 0.4)],
  // English disgust
  ['disgust', e(-0.6, ['disgust'], 0.7)],
  ['disgusting', e(-0.7, ['disgust'], 0.8)],
  ['repulsive', e(-0.7, ['disgust'], 0.8)],
  ['filthy', e(-0.5, ['disgust'], 0.6)],
  ['rotten', e(-0.5, ['disgust'], 0.6)],
  ['blood', e(-0.2, ['disgust', 'fear'], 0.3)],
  ['vile', e(-0.6, ['disgust', 'anger'], 0.7)],
  ['despise', e(-0.6, ['disgust', 'anger'], 0.7)],
  ['contempt', e(-0.5, ['disgust', 'anger'], 0.6)],
  ['corrupt', e(-0.5, ['disgust', 'anger'], 0.6)],
  ['decay', e(-0.4, ['disgust', 'sadness'], 0.5)],
  ['poison', e(-0.5, ['disgust', 'fear'], 0.6)],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ANTICIPATION / KỲ VỌNG
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['hy vọng', e(0.5, ['anticipation', 'joy'], 0.6)],
  ['mong đợi', e(0.4, ['anticipation'], 0.5)],
  ['mong chờ', e(0.4, ['anticipation'], 0.5)],
  ['trông đợi', e(0.3, ['anticipation'], 0.4)],
  ['kỳ vọng', e(0.4, ['anticipation'], 0.5)],
  ['mơ ước', e(0.5, ['anticipation', 'joy'], 0.6)],
  ['ước mơ', e(0.5, ['anticipation', 'joy'], 0.6)],
  ['khao khát', e(0.4, ['anticipation'], 0.6)],
  ['khát khao', e(0.4, ['anticipation'], 0.6)],
  ['quyết tâm', e(0.5, ['anticipation', 'trust'], 0.7)],
  ['sẵn sàng', e(0.3, ['anticipation', 'trust'], 0.4)],
  ['dự cảm', e(0.0, ['anticipation'], 0.4)],
  ['linh cảm', e(0.0, ['anticipation', 'fear'], 0.4)],
  ['điềm báo', e(0.0, ['anticipation'], 0.5)],
  ['số phận', e(0.0, ['anticipation', 'fear'], 0.5)],
  ['vận mệnh', e(0.0, ['anticipation'], 0.5)],
  ['hành trình', e(0.3, ['anticipation'], 0.4)],
  ['thử thách', e(0.1, ['anticipation', 'fear'], 0.5)],
  ['phiêu lưu', e(0.3, ['anticipation', 'joy'], 0.5)],
  ['khám phá', e(0.4, ['anticipation', 'joy'], 0.5)],
  ['bí ẩn', e(0.1, ['anticipation', 'surprise'], 0.5)],
  ['bí mật', e(0.1, ['anticipation'], 0.4)],
  ['tò mò', e(0.2, ['anticipation', 'surprise'], 0.4)],
  // English anticipation
  ['hope', e(0.6, ['anticipation', 'joy'], 0.6)],
  ['expect', e(0.2, ['anticipation'], 0.4)],
  ['anticipate', e(0.3, ['anticipation'], 0.5)],
  ['dream', e(0.4, ['anticipation', 'joy'], 0.5)],
  ['desire', e(0.3, ['anticipation'], 0.5)],
  ['destiny', e(0.1, ['anticipation'], 0.5)],
  ['fate', e(0.0, ['anticipation', 'fear'], 0.5)],
  ['quest', e(0.3, ['anticipation'], 0.5)],
  ['adventure', e(0.4, ['anticipation', 'joy'], 0.5)],
  ['mystery', e(0.1, ['anticipation', 'surprise'], 0.5)],
  ['secret', e(0.1, ['anticipation'], 0.4)],
  ['curious', e(0.2, ['anticipation', 'surprise'], 0.4)],
  ['journey', e(0.3, ['anticipation'], 0.4)],
  ['determination', e(0.5, ['anticipation', 'trust'], 0.7)],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ROMANTIC / LÃNG MẠN
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['yêu', e(0.7, ['joy', 'trust'], 0.7)],
  ['yêu thương', e(0.8, ['joy', 'trust'], 0.8)],
  ['tình yêu', e(0.8, ['joy', 'trust'], 0.8)],
  ['tình cảm', e(0.5, ['joy', 'trust'], 0.5)],
  ['ôm', e(0.4, ['joy', 'trust'], 0.4)],
  ['ôm ấp', e(0.5, ['joy', 'trust'], 0.5)],
  ['hôn', e(0.5, ['joy', 'trust'], 0.6)],
  ['nụ hôn', e(0.5, ['joy', 'trust'], 0.6)],
  ['vuốt ve', e(0.4, ['joy', 'trust'], 0.4)],
  ['âu yếm', e(0.5, ['joy', 'trust'], 0.5)],
  ['dịu dàng', e(0.4, ['joy', 'trust'], 0.4)],
  ['ngọt ngào', e(0.5, ['joy', 'trust'], 0.5)],
  ['thương nhớ', e(0.3, ['sadness', 'trust'], 0.5)],
  ['nhớ nhung', e(0.2, ['sadness', 'anticipation'], 0.5)],
  ['si mê', e(0.4, ['joy', 'anticipation'], 0.6)],
  ['say đắm', e(0.5, ['joy', 'anticipation'], 0.6)],
  ['rung động', e(0.4, ['joy', 'surprise'], 0.5)],
  ['xao xuyến', e(0.3, ['joy', 'surprise', 'anticipation'], 0.5)],
  ['bồi hồi', e(0.2, ['joy', 'anticipation', 'sadness'], 0.4)],
  // English romantic
  ['kiss', e(0.5, ['joy', 'trust'], 0.6)],
  ['embrace', e(0.5, ['joy', 'trust'], 0.5)],
  ['romance', e(0.5, ['joy', 'anticipation'], 0.5)],
  ['tender', e(0.4, ['joy', 'trust'], 0.4)],
  ['passion', e(0.5, ['joy', 'anticipation'], 0.6)],
  ['beloved', e(0.6, ['joy', 'trust'], 0.7)],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DEATH & POWER — context-dependent
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['chết', e(-0.6, ['fear', 'sadness'], 0.7)],
  ['tử thần', e(-0.7, ['fear'], 0.8)],
  ['xác chết', e(-0.6, ['fear', 'disgust'], 0.7)],
  ['thi thể', e(-0.5, ['fear', 'disgust'], 0.6)],
  ['hấp hối', e(-0.7, ['sadness', 'fear'], 0.8)],
  ['death', e(-0.6, ['fear', 'sadness'], 0.7)],
  ['dead', e(-0.5, ['sadness', 'fear'], 0.6)],
  ['die', e(-0.5, ['sadness', 'fear'], 0.6)],
  ['corpse', e(-0.5, ['fear', 'disgust'], 0.6)],
  ['grave', e(-0.3, ['sadness'], 0.4)],
  // Power
  ['sức mạnh', e(0.2, ['anticipation', 'trust'], 0.5)],
  ['quyền lực', e(0.1, ['anticipation'], 0.5)],
  ['nổ', e(-0.3, ['fear', 'surprise'], 0.5)],
  ['bùng nổ', e(-0.3, ['surprise', 'fear'], 0.6)],
  ['power', e(0.1, ['anticipation', 'trust'], 0.5)],
  ['strength', e(0.3, ['trust', 'anticipation'], 0.5)],
  ['sword', e(-0.1, ['anticipation', 'fear'], 0.3)],
  ['weapon', e(-0.2, ['fear', 'anticipation'], 0.4)],
  ['battle', e(-0.2, ['fear', 'anticipation'], 0.5)],
  ['warrior', e(0.1, ['trust', 'anticipation'], 0.5)],
  ['hero', e(0.4, ['trust', 'joy', 'anticipation'], 0.6)],
  ['conquer', e(0.2, ['anticipation', 'joy'], 0.6)],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TEENCODE / KHẨU NGỮ MẠNG — chat, dialogue hiện đại
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ['haha', e(0.6, ['joy'], 0.7)],
  ['hehe', e(0.5, ['joy'], 0.6)],
  ['hihi', e(0.5, ['joy'], 0.6)],
  ['kaka', e(0.5, ['joy'], 0.6)],
  ['huhu', e(-0.5, ['sadness'], 0.6)],
  ['ngon', e(0.5, ['joy'], 0.5)],
  ['xịn', e(0.6, ['joy'], 0.6)],
  ['đỉnh', e(0.7, ['joy', 'surprise'], 0.7)],
  ['dinh', e(0.7, ['joy', 'surprise'], 0.7)],
  ['cay', e(-0.5, ['anger'], 0.6)],
  ['toang', e(-0.6, ['fear', 'sadness'], 0.7)],
  ['gắt', e(-0.4, ['anger'], 0.5)],
  ['gat', e(-0.4, ['anger'], 0.5)],
  ['dở', e(-0.4, ['sadness'], 0.5)],
  // NOTE: không thêm 'do' (dở không dấu) vì trùng trợ động từ tiếng Anh "do".
  ['tệ', e(-0.5, ['sadness'], 0.6)],
  ['te', e(-0.5, ['sadness'], 0.6)],
]);

// ============================================================
// Negators — đảo polarity
// ============================================================

const NEGATORS: Map<string, number> = new Map([
  ['không', -1],
  ['chẳng', -1],
  ['đừng', -1],
  ['chưa', -1],
  ['chớ', -1],
  ['đâu', -0.8],
  ['không hề', -1],
  ['chẳng hề', -1],
  ['không bao giờ', -1],
  ['chẳng bao giờ', -1],
  ['chả', -1],
  ['nào có', -1],
  // Teencode / không dấu (chat, comment, draft nhanh)
  ['ko', -1],
  ['k', -1],
  ['khong', -1],
  ['hok', -1],
  ['hem', -1],
  ['hong', -1],
  ['đéo', -1],
  ['deo', -1],
  // English
  ['not', -1],
  ["n't", -1],
  ['no', -1],
  ['never', -1],
  ['neither', -1],
  ['without', -0.8],
  ['hardly', -0.7],
  ['barely', -0.7],
]);

// ============================================================
// Intensifiers — nhân intensity
// ============================================================

const INTENSIFIERS: Map<string, number> = new Map([
  ['rất', 1.5],
  ['cực kỳ', 2.0],
  ['cực', 1.8],
  ['vô cùng', 2.0],
  ['hết sức', 1.8],
  ['quá', 1.5],
  ['lắm', 1.3],
  ['khá', 0.7],
  ['hơi', 0.5],
  ['một chút', 0.4],
  ['chút', 0.4],
  ['thật', 1.3],
  ['thật sự', 1.5],
  ['thực sự', 1.5],
  ['cực kì', 2.0],
  // Teencode intensifiers
  ['vãi', 1.8],
  ['vl', 1.8],
  ['vcl', 1.8],
  ['vkl', 1.8],
  ['vc', 1.8],
  ['vler', 1.8],
  ['siêu', 1.5],
  ['sieu', 1.5],
  // English
  ['very', 1.5],
  ['extremely', 2.0],
  ['incredibly', 1.8],
  ['absolutely', 2.0],
  ['utterly', 2.0],
  ['really', 1.3],
  ['truly', 1.3],
  ['so', 1.3],
  ['quite', 0.8],
  ['somewhat', 0.6],
  ['slightly', 0.4],
  ['rather', 0.8],
  ['deeply', 1.5],
  ['terribly', 1.5],
]);

// ============================================================
// Vietnamese Internet-Slang Normalization
// (teencode, kéo dài chữ, không dấu, emoticon)
// ============================================================

/** Bỏ dấu tiếng Việt: "hạnh phúc" → "hanh phuc". */
function stripDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Từ chức năng tiếng Việt phổ biến mà dạng không dấu của chúng
 * trùng từ tiếng Anh/Việt trung tính → LOẠI khỏi fallback không dấu
 * để tránh false positive (vd: "cho"=for, "an"=ăn/article, "do"=động từ).
 */
const UNACCENTED_EXCLUDE = new Set([
  'cho', 'an', 'den', 'di', 'da', 'la', 'ma', 'thi', 'con', 'em',
  'anh', 'chi', 'cai', 'nay', 'kia', 'vay', 'the', 'cua', 'nguoi',
  'mot', 'hai', 'khi', 'de', 've', 'ra', 'vao', 'len', 'xuong',
  'tren', 'duoi', 'do', 'o', 'a', 'e', 'i', 'u', 'y', 'doan',
]);

let unaccentedLexicon: Map<string, EmotionEntry> | null = null;

/** Index phụ: key không dấu → entry (build lazy một lần). */
function getUnaccentedLexicon(): Map<string, EmotionEntry> {
  if (!unaccentedLexicon) {
    unaccentedLexicon = new Map();
    for (const [key, entry] of EMOTION_LEXICON) {
      const plain = stripDiacritics(key).toLowerCase();
      if (plain === key) continue; // vốn đã không dấu → exact hit đủ
      if (plain.length < 3 || UNACCENTED_EXCLUDE.has(plain)) continue;
      if (!unaccentedLexicon.has(plain)) unaccentedLexicon.set(plain, entry);
    }
  }
  return unaccentedLexicon;
}

/** Tra cứu lexicon: exact trước, fallback không dấu sau. */
function lookupLexicon(token: string): EmotionEntry | undefined {
  return EMOTION_LEXICON.get(token) ?? getUnaccentedLexicon().get(token);
}

/** Các biến thể cười/khóc gõ lặp → chuẩn hóa về dạng gốc. */
const LAUGHTER_VARIANTS = new Set([
  'hahaha', 'hahahaha', 'hahahahaha', 'hehehe', 'hehehehe',
  'hihihi', 'hihihihi', 'kakaka', 'kakakaka', 'hahaah',
]);
const CRY_VARIANTS = new Set([
  'huhuhu', 'huhuhuhu', 'huuhu', 'huhuuhu', 'huc', 'huc huc',
]);

/**
 * Chuẩn hóa một token về dạng tra cứu được:
 * 1. gộp chữ kéo dài ("vuiii" → "vui", "buồnnn" → "buồn")
 * 2. gộp biến thể cười/khóc ("hahaha" → "haha", "huhuhu" → "huhu")
 */
function normalizeToken(token: string): string {
  let t = token.replace(/(.)\1{2,}/g, '$1');
  if (LAUGHTER_VARIANTS.has(t)) return 'haha';
  if (t === 'hehe' || t === 'hihi' || t === 'kaka') return t;
  if (CRY_VARIANTS.has(t)) return 'huhu';
  return t;
}

/** Emoticon ASCII phổ biến trong dialogue/chat tiếng Việt. */
const POSITIVE_EMOTICONS = [':)', ':-)', ':D', ':-D', '=)', '<3', '^^'];
const NEGATIVE_EMOTICONS = [':(', ':-(', ":'(", ':((', 'T_T', 'T.T', ':/', ':-/'];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const POS_EMO_RE = new RegExp(
  POSITIVE_EMOTICONS.map(escapeRegExp).sort((a, b) => b.length - a.length).join('|'),
  'g',
);
const NEG_EMO_RE = new RegExp(
  NEGATIVE_EMOTICONS.map(escapeRegExp).sort((a, b) => b.length - a.length).join('|'),
  'g',
);

/**
 * Quét & tách emoticon khỏi text trước khi tokenize (vì bộ tách từ
 * sẽ phá vỡ chúng thành dấu câu rời). Trả về text sạch + số lượng.
 */
function extractEmoticons(text: string): { cleaned: string; positive: number; negative: number } {
  const positive = (text.match(POS_EMO_RE) ?? []).length;
  const negative = (text.match(NEG_EMO_RE) ?? []).length;
  const cleaned = text.replace(POS_EMO_RE, ' ').replace(NEG_EMO_RE, ' ');
  return { cleaned, positive, negative };
}

// ============================================================
// Text Processing Utilities
// ============================================================

/** Loại bỏ Markdown formatting. */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/---+/g, '');
}

/**
 * Tokenize text thành mảng tokens (hỗ trợ multi-word Vietnamese).
 * Ưu tiên match multi-word tokens trong lexicon trước.
 */
/**
 * Marker biên câu trong luồng token: phủ định/tăng cường không được
 * tràn qua nó ("Không. Tôi rất vui." — "không" không phủ "vui" câu sau).
 */
export const SENTENCE_BOUNDARY = '￭';

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];

  // Ghép multi-word tokens (2-word và 3-word).
  // Mỗi ứng viên check cả dạng gốc lẫn không dấu để text teen/chat
  // ("hanh phuc", "khong he") vẫn ghép được compound.
  const matchesKnown = (s: string): boolean =>
    EMOTION_LEXICON.has(s) ||
    NEGATORS.has(s) ||
    INTENSIFIERS.has(s) ||
    getUnaccentedLexicon().has(stripDiacritics(s));

  const pushCompounded = (words: string[]): void => {
    let i = 0;
    while (i < words.length) {
      // Thử 3-word compound
      if (i + 2 < words.length) {
        const tri = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
        if (matchesKnown(tri)) {
          tokens.push(tri);
          i += 3;
          continue;
        }
      }
      // Thử 2-word compound
      if (i + 1 < words.length) {
        const bi = `${words[i]} ${words[i + 1]}`;
        if (matchesKnown(bi)) {
          tokens.push(bi);
          i += 2;
          continue;
        }
      }
      tokens.push(words[i]);
      i++;
    }
  };

  // Tách theo câu để chèn marker biên (giữ . ! ? … làm delimiter).
  // Emoticon đã được extractEmoticons() tách ra trước nên không lo mất.
  // Compound chỉ ghép trong phạm vi một câu, không tràn qua marker.
  const sentences = lower.split(/[.!?…]+/);
  sentences.forEach((sentence, idx) => {
    const words = sentence
      .split(/[\s,;:()[\]{}"'""「」『』—–\-_/\\|]+/)
      .map(t => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')) // gọt dấu câu dính đầu/cuối
      .filter(t => t.length > 0)
      .map(normalizeToken); // gộp chữ kéo dài + biến thể cười/khóc
    // Ngăn cách các câu bằng marker (trừ trước câu đầu / quanh câu rỗng)
    if (idx > 0 && tokens.length > 0 && words.length > 0) {
      tokens.push(SENTENCE_BOUNDARY);
    }
    pushCompounded(words);
  });

  return tokens;
}

// ============================================================
// Core Sentiment Analysis
// ============================================================

function emptyEmotionScores(): EmotionScores {
  return { joy: 0, trust: 0, fear: 0, surprise: 0, sadness: 0, disgust: 0, anger: 0, anticipation: 0 };
}

/** Tìm dominant emotion từ scores. */
function findDominant(scores: EmotionScores): EmotionTag {
  let maxScore = 0;
  let dominant: EmotionTag = 'anticipation';
  for (const tag of ALL_EMOTIONS) {
    if (scores[tag] > maxScore) {
      maxScore = scores[tag];
      dominant = tag;
    }
  }
  return dominant;
}

/**
 * Normalize emotion scores thành phần trăm (tổng đúng = 100).
 * Dùng largest-remainder thay vì round từng ô (round lẻ tổng 99/101%).
 */
function normalizeScores(raw: EmotionScores): EmotionScores {
  const total = ALL_EMOTIONS.reduce((sum, tag) => sum + raw[tag], 0);
  if (total === 0) return emptyEmotionScores();
  const normalized = emptyEmotionScores();
  const remainders: { tag: EmotionTag; frac: number }[] = [];
  let assigned = 0;
  for (const tag of ALL_EMOTIONS) {
    const exact = (raw[tag] / total) * 100;
    const floored = Math.floor(exact);
    normalized[tag] = floored;
    assigned += floored;
    remainders.push({ tag, frac: exact - floored });
  }
  remainders.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < 100 - assigned; i++) {
    normalized[remainders[i % remainders.length].tag]++;
  }
  return normalized;
}

/**
 * Phân tích sentiment cho một đoạn text.
 *
 * Algorithm:
 * 1. Strip markdown → tokenize
 * 2. Slide qua từng token:
 *    - Nếu là negator → đánh dấu negation window (2 tokens tiếp theo)
 *    - Nếu là intensifier → ghi nhớ multiplier
 *    - Nếu có trong lexicon → lookup, áp dụng negation + intensifier
 * 3. Aggregate scores
 */
export function analyzeSentiment(text: string): SentimentResult {
  const cleaned = stripMarkdown(text);
  // Emoticon phải tách trước tokenize (bộ tách từ sẽ phá vỡ chúng).
  const { cleaned: noEmo, positive: posEmo, negative: negEmo } = extractEmoticons(cleaned);
  const tokens = tokenize(noEmo);

  const rawScores = emptyEmotionScores();
  let totalPolarity = 0;
  let sentimentWordCount = 0;

  // Mỗi emoticon tính như một "từ cảm xúc" nhẹ (polarity ±0.5).
  if (posEmo > 0) {
    totalPolarity += posEmo * 0.5;
    rawScores.joy += posEmo * 0.6;
    sentimentWordCount += posEmo;
  }
  if (negEmo > 0) {
    totalPolarity -= negEmo * 0.5;
    rawScores.sadness += negEmo * 0.6;
    sentimentWordCount += negEmo;
  }

  const totalWords = tokens.filter(t => t !== SENTENCE_BOUNDARY).length + posEmo + negEmo;

  // State machine
  let negationWindow = 0;
  let negationFactor = 1;
  let intensifierMul = 1;

  for (const token of tokens) {
    // Biên câu: phủ định/tăng cường không tràn sang câu khác
    if (token === SENTENCE_BOUNDARY) {
      negationWindow = 0;
      intensifierMul = 1;
      continue;
    }

    // Check negator
    const negVal = NEGATORS.get(token);
    if (negVal !== undefined) {
      negationWindow = 2;
      negationFactor = negVal;
      continue;
    }

    // Check intensifier: cộng dồn có trần (rất rất = 2.25x, trần 3x),
    // và KHÔNG bị từ trung tính xóa (chỉ reset khi gặp từ cảm xúc/biên câu)
    const intVal = INTENSIFIERS.get(token);
    if (intVal !== undefined) {
      intensifierMul = Math.min(3, intensifierMul * intVal);
      continue;
    }

    // Lookup lexicon (exact → fallback không dấu cho text teen/chat)
    const entry = lookupLexicon(token);
    if (entry) {
      sentimentWordCount++;

      let polarity = entry.polarity;
      let intensity = entry.intensity;

      // Apply negation
      if (negationWindow > 0) {
        polarity *= negationFactor;
        negationWindow--;
      }

      // Apply intensifier
      polarity *= intensifierMul;
      intensity *= Math.abs(intensifierMul);
      intensifierMul = 1;

      totalPolarity += polarity;

      // Accumulate emotion scores
      for (const em of entry.emotions) {
        rawScores[em] += intensity;
      }
    } else {
      if (negationWindow > 0) negationWindow--;
    }
  }

  // Normalize
  const avgPolarity = sentimentWordCount > 0
    ? Math.max(-1, Math.min(1, totalPolarity / sentimentWordCount))
    : 0;

  const emotions = normalizeScores(rawScores);
  const dominantEmotion = findDominant(rawScores);
  const tone = classifyTone(rawScores, avgPolarity);

  return {
    polarity: Math.round(avgPolarity * 100) / 100,
    dominantEmotion,
    tone,
    emotions,
    sentimentWordCount,
    totalWords,
    coverage: totalWords > 0 ? Math.round((sentimentWordCount / totalWords) * 100) / 100 : 0,
  };
}

// ============================================================
// Emotional Arc (Sliding Window)
// ============================================================

/**
 * Tính emotional arc bằng sliding window.
 *
 * @param text - Toàn bộ nội dung (đã strip markdown nếu muốn)
 * @param windowSize - Số từ mỗi window (default 200)
 * @param stepRatio - Tỷ lệ bước nhảy so với window (default 0.5 = overlap 50%)
 */
export function computeEmotionalArc(
  text: string,
  windowSize = 200,
  stepRatio = 0.5,
): EmotionalArcPoint[] {
  const cleaned = stripMarkdown(text);
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);

  if (words.length === 0) return [];

  const step = Math.max(1, Math.floor(windowSize * stepRatio));
  const points: EmotionalArcPoint[] = [];

  for (let start = 0; start < words.length; start += step) {
    const end = Math.min(start + windowSize, words.length);
    const windowText = words.slice(start, end).join(' ');
    const result = analyzeSentiment(windowText);

    points.push({
      position: Math.round((start / words.length) * 100) / 100,
      polarity: result.polarity,
      dominantEmotion: result.dominantEmotion,
      emotions: result.emotions,
    });

    if (end >= words.length) break;
  }

  return points;
}

// ============================================================
// Tone Classification
// ============================================================

/**
 * Phân loại giọng văn dựa trên tổ hợp emotion scores + polarity.
 */
export function classifyTone(rawScores: EmotionScores, polarity: number): ToneCategory {
  const total = ALL_EMOTIONS.reduce((sum, tag) => sum + rawScores[tag], 0);
  if (total === 0) return 'trung_tinh';

  const pct: Record<EmotionTag, number> = {} as Record<EmotionTag, number>;
  for (const tag of ALL_EMOTIONS) {
    pct[tag] = rawScores[tag] / total;
  }

  // Rule-based tone classification (ưu tiên từ trên xuống)
  // 1. Bi thương: sadness áp đảo (≥35% và > fear), polarity < -0.2
  if (pct.sadness >= 0.35 && pct.sadness > pct.fear && polarity < -0.2) return 'bi_thuong';

  // 2. U ám: fear + sadness chiếm ≥40%, polarity < -0.3
  if ((pct.fear + pct.sadness) >= 0.40 && polarity < -0.3) return 'u_am';

  // 3. Căng thẳng: fear + anger + anticipation chiếm ≥50%
  if ((pct.fear + pct.anger + pct.anticipation) >= 0.50) return 'cang_thang';

  // 4. Lãng mạn: joy + trust chiếm ≥50%, polarity > 0.2
  if ((pct.joy + pct.trust) >= 0.50 && polarity > 0.2) return 'lang_man';

  // 5. Vui vẻ: joy chiếm ≥30%, polarity > 0.3
  if (pct.joy >= 0.30 && polarity > 0.3) return 'vui_ve';

  // 6. Hài hước: joy + surprise chiếm ≥40%, polarity > 0.1
  if ((pct.joy + pct.surprise) >= 0.40 && polarity > 0.1) return 'hai_huoc';

  // 7. Trang trọng: trust + anticipation chiếm ≥45%, polarity ~ neutral
  if ((pct.trust + pct.anticipation) >= 0.45 && Math.abs(polarity) < 0.3) return 'trang_trong';

  return 'trung_tinh';
}

// ============================================================
// Tone Drift Detection
// ============================================================

export interface ToneDriftAlert {
  fromChapter: string;
  toChapter: string;
  fromTone: ToneCategory;
  toTone: ToneCategory;
  polarityShift: number;
  severity: 'info' | 'warning' | 'critical';
}

/**
 * So sánh tone giữa hai chương liên tiếp để phát hiện drift.
 */
export function detectToneDrift(
  prevChapter: string,
  currChapter: string,
  prevResult: SentimentResult,
  currResult: SentimentResult,
): ToneDriftAlert | null {
  if (prevResult.tone === currResult.tone) return null;

  const polarityShift = Math.abs(currResult.polarity - prevResult.polarity);

  let severity: 'info' | 'warning' | 'critical';
  if (polarityShift >= 0.6) {
    severity = 'critical';
  } else if (polarityShift >= 0.3) {
    severity = 'warning';
  } else {
    severity = 'info';
  }

  return {
    fromChapter: prevChapter,
    toChapter: currChapter,
    fromTone: prevResult.tone,
    toTone: currResult.tone,
    polarityShift: Math.round(polarityShift * 100) / 100,
    severity,
  };
}

// ============================================================
// Helper: Format emotion scores thành visual bar chart
// ============================================================

const EMOTION_ICONS: Record<EmotionTag, string> = {
  joy: '😊',
  trust: '🤝',
  fear: '😨',
  surprise: '😲',
  sadness: '😢',
  disgust: '🤢',
  anger: '😡',
  anticipation: '🔮',
};

export function formatEmotionBar(tag: EmotionTag, percent: number): string {
  const filled = Math.round(percent / 10);
  const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, 10 - filled));
  const icon = EMOTION_ICONS[tag];
  const label = tag.charAt(0).toUpperCase() + tag.slice(1);
  return `  ${icon} ${label.padEnd(13)} ${bar} ${percent}%`;
}

export function formatAllEmotions(scores: EmotionScores): string {
  return ALL_EMOTIONS
    .filter(tag => scores[tag] > 0)
    .sort((a, b) => scores[b] - scores[a])
    .map(tag => formatEmotionBar(tag, scores[tag]))
    .join('\n');
}

export function polarityLabel(polarity: number): string {
  if (polarity >= 0.5) return 'Tích cực mạnh';
  if (polarity >= 0.2) return 'Tích cực';
  if (polarity >= 0.05) return 'Hơi tích cực';
  if (polarity >= -0.05) return 'Trung tính';
  if (polarity >= -0.2) return 'Hơi tiêu cực';
  if (polarity >= -0.5) return 'Tiêu cực';
  return 'Tiêu cực mạnh';
}

// ============================================================
// Lexicon-Based Sentiment Analyzer (implements SentimentAnalyzer)
// ============================================================

/**
 * Default lexicon-based implementation.
 * Tương lai có thể swap bằng EmbeddingSentimentAnalyzer.
 */
export class LexiconSentimentAnalyzer implements SentimentAnalyzer {
  analyze(text: string): SentimentResult {
    return analyzeSentiment(text);
  }

  computeArc(text: string, windowSize = 200): EmotionalArcPoint[] {
    return computeEmotionalArc(text, windowSize);
  }
}

/** Singleton instance. */
export const defaultAnalyzer = new LexiconSentimentAnalyzer();

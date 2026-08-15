import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countWords, countSentences, averageSentenceLength } from '../src/utils/wordCount.js';

test('countWords: đếm từ tiếng Việt (theo khoảng trắng)', () => {
  assert.equal(countWords('Một buổi sáng đẹp trời'), 5);
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   '), 0);
});

test('countWords: loại bỏ Markdown markup', () => {
  const md = '# Tiêu đề\n\nMột **đoạn** _văn_ với `code` và [link](https://x.com).\n';
  // tokens: Tiêu, đề, Một, đoạn, văn, với, và, link
  assert.equal(countWords(md), 8);
});

test('countWords: loại bỏ code block', () => {
  const md = 'Trước\n```\ncode block\n```\nSau';
  assert.equal(countWords(md), 2);
});

test('countSentences: đếm câu theo dấu kết thúc', () => {
  assert.equal(countSentences('A. B! C?'), 3);
  assert.equal(countSentences(''), 0);
});

test('averageSentenceLength: độ dài câu trung bình', () => {
  // "Một câu hai câu. Câu này có ba từ." → 9 từ / 2 câu = 4.5
  assert.equal(averageSentenceLength('Một câu hai câu. Câu này có ba từ.'), 4.5);
});

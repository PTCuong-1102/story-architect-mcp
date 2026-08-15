/**
 * Đếm số từ trong văn bản.
 * Hỗ trợ cả tiếng Anh (đếm theo khoảng trắng) và tiếng Việt (đếm theo khoảng trắng — mỗi tiếng = 1 từ).
 */
export function countWords(text: string): number {
  if (!text || text.trim().length === 0) return 0;

  // Loại bỏ Markdown headers, bold, italic, links, images
  // Lưu ý: xử lý code block TRƯỚC khi bỏ ký tự backtick (nếu không sẽ phá fence)
  let cleaned = text
    .replace(/```[\s\S]*?```/g, '')     // Code blocks
    .replace(/`[^`]*`/g, '')           // Inline code
    .replace(/^#{1,6}\s+/gm, '')        // Headers
    .replace(/!\[.*?\]\(.*?\)/g, '')     // Images
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1') // Links → keep text
    .replace(/[*_~`]/g, '')              // Bold, italic, strikethrough
    .replace(/^>\s+/gm, '')             // Blockquotes
    .replace(/^[-*+]\s+/gm, '')         // Unordered lists
    .replace(/^\d+\.\s+/gm, '')         // Ordered lists
    .replace(/---+/g, '');              // Horizontal rules

  // Split trên whitespace và lọc token rỗng
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  return words.length;
}

/**
 * Đếm số câu trong văn bản.
 */
export function countSentences(text: string): number {
  if (!text || text.trim().length === 0) return 0;
  // Đếm dấu kết thúc câu
  const sentences = text.split(/[.!?。]+/).filter(s => s.trim().length > 0);
  return sentences.length;
}

/**
 * Tính độ dài câu trung bình (số từ).
 */
export function averageSentenceLength(text: string): number {
  const words = countWords(text);
  const sentences = countSentences(text);
  if (sentences === 0) return 0;
  return Math.round((words / sentences) * 10) / 10;
}

import type { CallToolResult } from '@modelcontextprotocol/server';

/** Kết quả thành công dạng text. */
export function okResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

/**
 * Kết quả THẤT BẠI nghiệp vụ (validation sai, không tìm thấy, bị từ chối...).
 *
 * Bắt buộc đặt `isError: true` để MCP client biết tool call đã thất bại.
 * Nếu trả về ❌ mà không có isError, client (LLM agent) sẽ tưởng thành công
 * và tiếp tục chuỗi gọi tool sau đó trên dữ liệu sai.
 */
export function errResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

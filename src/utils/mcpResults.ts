import type { CallToolResult } from '@modelcontextprotocol/server';
import type { StoryProject } from '../server/StoryProject.js';

/** Kết quả thành công dạng text. */
export function okResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

/**
 * Thông điệp chuẩn khi server chưa được gắn dự án nào.
 * Dùng chung cho mọi tool để client/LLM nhận hướng dẫn nhất quán.
 * (Giữ nguyên nội dung throw trong src/index.ts để Resources/Prompts
 * vẫn có cùng thông điệp khi chuyển thành lỗi protocol.)
 */
export const NO_PROJECT_MESSAGE =
  '❌ Chưa thiết lập dự án. Hãy gọi tool `story_set_project` trước (hoặc khởi động server với đường dẫn dự án).';

/**
 * Lấy project hiện tại, bắt lỗi "chưa set project" và chuyển thành
 * CallToolResult lỗi chuẩn (isError: true) thay vì throw thô.
 *
 * Cách dùng trong mỗi tool handler:
 * ```ts
 * const project = requireProject(getProject);
 * if ('isError' in project) return project;
 * // ... project đã được narrow thành StoryProject
 * ```
 */
export function requireProject(
  getProject: () => StoryProject,
): StoryProject | CallToolResult {
  try {
    return getProject();
  } catch {
    return errResult(NO_PROJECT_MESSAGE);
  }
}

/**
 * Type predicate phân biệt CallToolResult lỗi với StoryProject.
 *
 * Không dùng `'isError' in project` trực tiếp vì CallToolResult của
 * MCP SDK mang index signature `[x: string]: unknown` khiến tsc
 * không narrow được union (lỗi TS18046/TS2345). Predicate này
 * sidestep vấn đề đó và narrow chính xác cả hai nhánh.
 */
export function isToolError(
  value: StoryProject | CallToolResult,
): value is CallToolResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'content' in value &&
    Array.isArray((value as CallToolResult).content)
  );
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

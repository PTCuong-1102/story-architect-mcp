import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Đọc file JSON an toàn, trả về null nếu file không tồn tại.
 */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Ghi file JSON với pretty-print.
 */
export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Đọc file text an toàn.
 */
export async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Kiểm tra file/thư mục có tồn tại không.
 */
export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Đệ quy liệt kê tất cả file trong thư mục.
 */
export async function walkDir(dir: string, extensions?: string[]): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden directories and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (extensions) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            results.push(fullPath);
          }
        } else {
          results.push(fullPath);
        }
      }
    }
  }

  await walk(dir);
  return results;
}

/**
 * Đọc tất cả file Markdown trong thư mục (đệ quy).
 */
export async function findMarkdownFiles(dir: string): Promise<string[]> {
  return walkDir(dir, ['.md', '.txt']);
}

/**
 * Tạo ID ngắn dựa trên timestamp.
 */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

/**
 * Lấy kích thước file (bytes).
 */
export async function getFileSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

/**
 * Copy đệ quy một thư mục.
 */
export async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

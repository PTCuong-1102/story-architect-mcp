import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { StoryProject } from '../server/StoryProject.js';
import { errResult } from '../utils/mcpResults.js';

// ─── Project Type Detection ───

/** File markers nhận diện dự án code (KHÔNG phải tiểu thuyết). */
const CODE_PROJECT_MARKERS = [
  // Node.js / JavaScript / TypeScript
  'package.json',
  // Python
  'pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile', 'requirements.txt',
  // Rust
  'Cargo.toml',
  // Go
  'go.mod',
  // Java / Kotlin / Gradle / Maven
  'pom.xml', 'build.gradle', 'build.gradle.kts',
  // .NET / C#
  '*.csproj', '*.sln',
  // Ruby
  'Gemfile',
  // PHP
  'composer.json',
  // Dart / Flutter
  'pubspec.yaml',
  // Swift / Xcode
  'Package.swift',
  // Docker / CI/CD
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  // Terraform / IaC
  'main.tf', 'terraform.tfvars',
];

/** Thư mục markers nhận diện dự án code. */
const CODE_DIR_MARKERS = [
  'src', 'lib', 'node_modules', '.git', '__pycache__', '.venv', 'venv',
  'target', 'build', 'dist', '.next', '.nuxt',
];

/** Thư mục markers nhận diện dự án tiểu thuyết (story-architect). */
const NOVEL_PROJECT_MARKERS = ['.story', 'manuscript', 'bible', 'outline', 'drafts_raw'];

type ProjectType = 'novel' | 'code' | 'empty' | 'unknown';

export type ProjectDetection = {
  type: ProjectType;
  confidence: number;
  novelSignals: string[];
  codeSignals: string[];
};

function emptyDetection(): ProjectDetection {
  return { type: 'empty', confidence: 1.0, novelSignals: [], codeSignals: [] };
}

/** Thu thập markers tiểu thuyết có trong thư mục. */
function collectNovelSignals(entries: string[]): string[] {
  return NOVEL_PROJECT_MARKERS.filter(marker => entries.includes(marker));
}

/** Thu thập code file markers (hỗ trợ glob đơn giản `*.ext`). */
function collectCodeFileSignals(entries: string[]): string[] {
  const signals: string[] = [];
  for (const marker of CODE_PROJECT_MARKERS) {
    if (marker.startsWith('*')) {
      const ext = marker.slice(1);
      if (entries.some(e => e.endsWith(ext))) signals.push(marker);
    } else if (entries.includes(marker.toLowerCase())) {
      signals.push(marker);
    }
  }
  return signals;
}

/**
 * Thu thập code dir markers thực sự là directory.
 * Bỏ qua '.git' vì novel project cũng có thể có.
 */
async function collectCodeDirSignals(dirPath: string, entries: string[]): Promise<string[]> {
  const signals: string[] = [];
  for (const marker of CODE_DIR_MARKERS.filter(d => d !== '.git')) {
    if (!entries.includes(marker)) continue;
    try {
      const stat = await fs.stat(path.join(dirPath, marker));
      if (stat.isDirectory()) signals.push(`${marker}/`);
    } catch {
      // Bỏ qua entry không stat được
    }
  }
  return signals;
}

/** Quyết định loại dự án từ hai tập tín hiệu (thuần, không I/O). */
function decideProjectType(novelSignals: string[], codeSignals: string[]): ProjectDetection {
  // Nếu có .story/ → chắc chắn là novel (đã init bởi story-architect)
  if (novelSignals.includes('.story')) {
    return { type: 'novel', confidence: 1.0, novelSignals, codeSignals };
  }

  const novelScore = novelSignals.length;
  const codeScore = codeSignals.length;

  // Nhiều novel markers → likely novel
  if (novelScore >= 2) {
    return { type: 'novel', confidence: 0.8, novelSignals, codeSignals };
  }

  // Code markers rõ ràng và không có novel markers → code project
  if (codeScore > 0 && novelScore === 0) {
    return { type: 'code', confidence: Math.min(0.95, 0.5 + codeScore * 0.15), novelSignals, codeSignals };
  }

  // Có cả hai → ưu tiên novel nếu có novel signals
  if (novelScore > 0 && codeScore > 0) {
    return { type: 'novel', confidence: 0.6, novelSignals, codeSignals };
  }

  return { type: 'unknown', confidence: 0.5, novelSignals, codeSignals };
}

/**
 * Phát hiện loại dự án: tiểu thuyết, code, trống, hay không rõ.
 */
export async function detectProjectType(dirPath: string): Promise<ProjectDetection> {
  let entries: string[];
  try {
    entries = (await fs.readdir(dirPath)).map(e => e.toLowerCase());
  } catch {
    return emptyDetection();
  }

  if (entries.length === 0) {
    return emptyDetection();
  }

  const novelSignals = collectNovelSignals(entries);
  const codeSignals = [
    ...collectCodeFileSignals(entries),
    ...(await collectCodeDirSignals(dirPath, entries)),
  ];

  return decideProjectType(novelSignals, codeSignals);
}

/**
 * Đăng ký tools quản lý dự án: set/get project path runtime.
 *
 * @param setProject - Hàm thay đổi dự án đích, trả về StoryProject mới
 * @param getProject - Hàm lấy dự án hiện tại (có thể throw nếu chưa thiết lập)
 * @param getCurrentPath - Hàm lấy đường dẫn hiện tại (null nếu chưa thiết lập)
 */
export function registerProjectManagerTools(
  server: McpServer,
  setProject: (projectPath: string) => StoryProject,
  getProject: () => StoryProject | null,
  getCurrentPath: () => string | null,
): void {

  // ─── story_set_project ───
  server.registerTool(
    'story_set_project',
    {
      title: 'Set Story Project Path',
      description: 'Thiết lập hoặc chuyển đổi dự án tiểu thuyết đích. Tự động phát hiện và từ chối dự án code (Node.js, Python, Rust, v.v.) để tránh lãng phí tài nguyên. Dùng force=true để bỏ qua kiểm tra.',
      inputSchema: z.object({
        projectPath: z.string().min(1).describe('Đường dẫn đến thư mục dự án tiểu thuyết (tuyệt đối hoặc tương đối so với cwd)'),
        force: z.boolean().default(false).describe('Bỏ qua kiểm tra loại dự án (dùng khi muốn khởi tạo dự án mới trong thư mục bất kỳ)'),
      }),
    },
    async (params) => {
      const resolvedPath = path.resolve(params.projectPath);

      // Validate thư mục tồn tại
      try {
        const stat = await fs.stat(resolvedPath);
        if (!stat.isDirectory()) {
          return errResult(`❌ Đường dẫn không phải là thư mục: ${resolvedPath}`);
        }
      } catch {
        return errResult(`❌ Không tìm thấy thư mục: ${resolvedPath}\n\n💡 Hãy kiểm tra lại đường dẫn hoặc tạo thư mục trước.`);
      }

      // ─── Phát hiện loại dự án ───
      const detection = await detectProjectType(resolvedPath);

      if (detection.type === 'code' && !params.force) {
        return errResult(`🚫 Đây không phải dự án tiểu thuyết — đã phát hiện dự án code.

📁 Đường dẫn: ${resolvedPath}
🔍 Phát hiện: ${detection.codeSignals.join(', ')}
📊 Confidence: ${Math.round(detection.confidence * 100)}%

⚡ Story-architect-mcp chỉ dùng cho dự án tiểu thuyết / sáng tác.
   Sử dụng trên dự án code sẽ lãng phí context window và gây nhầm lẫn cho AI.

💡 Nếu đây thực sự là dự án tiểu thuyết, hãy gọi lại với force: true:
   story_set_project({ projectPath: "${params.projectPath}", force: true })`);
      }

      const previousPath = getCurrentPath();
      const project = setProject(resolvedPath);
      const isInitialized = await project.isInitialized();

      let statusInfo = '';
      if (isInitialized) {
        try {
          const config = await project.getConfig();
          const status = await project.getStatus();
          statusInfo = `
📖 Tên truyện: ${config.name}
✍️  Tác giả: ${config.author || '_chưa thiết lập_'}
📚 Thể loại: ${config.genre.length > 0 ? config.genre.join(', ') : '_chưa thiết lập_'}
📝 Số từ: ${status.totalWordCount.toLocaleString()}
📊 Chương: ${status.chapterCount} | Arc: ${status.arcCount} | Nhân vật: ${status.characterCount}
🎯 Tiến độ: ${status.completionPercent}%`;
        } catch {
          statusInfo = '\n⚠️ Không thể đọc metadata dự án.';
        }
      }

      const switchInfo = previousPath
        ? `\n🔄 Đã chuyển từ: ${previousPath}`
        : '';

      // Cảnh báo nhẹ nếu force trên code project
      const forceWarning = (detection.type === 'code' && params.force)
        ? `\n\n⚠️ Đã bỏ qua kiểm tra: phát hiện markers code (${detection.codeSignals.join(', ')}). Hãy chắc chắn đây là dự án tiểu thuyết.`
        : '';

      // Thông tin detection cho unknown/empty
      let detectionInfo = '';
      if (detection.type === 'empty') {
        detectionInfo = '\n📂 Thư mục trống — sẵn sàng khởi tạo dự án mới.';
      } else if (detection.type === 'unknown') {
        detectionInfo = '\n🔍 Không phát hiện markers rõ ràng. Đảm bảo đây là dự án tiểu thuyết.';
      } else if (detection.type === 'novel' && detection.novelSignals.length > 0) {
        detectionInfo = `\n✅ Phát hiện dự án tiểu thuyết: ${detection.novelSignals.join(', ')}`;
      }

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Đã thiết lập dự án: ${resolvedPath}
${switchInfo}${detectionInfo}

📁 Trạng thái: ${isInitialized ? '✅ Đã khởi tạo' : '⚠️ Chưa khởi tạo — hãy gọi `story_init` để thiết lập'}
${statusInfo}${forceWarning}`,
        }],
      };
    }
  );

  // ─── story_get_project_info ───
  server.registerTool(
    'story_get_project_info',
    {
      title: 'Get Current Project Info',
      description: 'Xem thông tin dự án tiểu thuyết hiện tại đang được trỏ đến.',
      inputSchema: z.object({}),
    },
    async () => {
      const currentPath = getCurrentPath();

      if (!currentPath) {
        return {
          content: [{
            type: 'text' as const,
            text: `⚠️ Chưa thiết lập dự án nào.

💡 Hãy gọi \`story_set_project\` với đường dẫn đến thư mục dự án tiểu thuyết.

Ví dụ:
  story_set_project({ projectPath: "/path/to/my-novel" })`,
          }],
        };
      }

      const project = getProject();
      if (!project) {
        return errResult(`❌ Lỗi nội bộ: project path đã set nhưng không tạo được instance.`);
      }

      const isInitialized = await project.isInitialized();

      if (!isInitialized) {
        return {
          content: [{
            type: 'text' as const,
            text: `📁 Dự án hiện tại: ${currentPath}
📋 Trạng thái: ⚠️ Chưa khởi tạo

💡 Gọi \`story_init\` để thiết lập cấu trúc dự án chuẩn.`,
          }],
        };
      }

      try {
        const config = await project.getConfig();
        const status = await project.getStatus();
        const holes = await project.getPlotHoles();
        const foreshadowing = await project.getForeshadowing();

        const openHoles = holes.holes.filter(h => h.status === 'open').length;
        const unfiredSetups = foreshadowing.items.filter(i => i.status === 'planted').length;

        return {
          content: [{
            type: 'text' as const,
            text: `📁 Dự án hiện tại: ${currentPath}
📋 Trạng thái: ✅ Đã khởi tạo

📖 Tên truyện: ${config.name}
✍️  Tác giả: ${config.author || '_chưa thiết lập_'}
📚 Thể loại: ${config.genre.length > 0 ? config.genre.join(', ') : '_chưa thiết lập_'}
🗣️  POV: ${config.pov} | Thì: ${config.tense === 'past' ? 'Quá khứ' : 'Hiện tại'}
🌐 Ngôn ngữ: ${config.language}

📝 Số từ: ${status.totalWordCount.toLocaleString()} / ${config.targetWordCount.toLocaleString()}
📊 Chương: ${status.chapterCount} | Arc: ${status.arcCount} | Nhân vật: ${status.characterCount}
🎯 Tiến độ: ${status.completionPercent}%

🐛 Plot holes mở: ${openHoles}
🔫 Chekhov's guns chưa bắn: ${unfiredSetups}`,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `📁 Dự án hiện tại: ${currentPath}
⚠️ Đã khởi tạo nhưng không thể đọc metadata: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }
    }
  );
}

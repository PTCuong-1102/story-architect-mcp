# Triển khai Dự án `story-architect-mcp`

## Bối cảnh

Xây dựng MCP Server TypeScript cho phép AI Agent hỗ trợ viết tiểu thuyết dài: quản lý cấu trúc dự án, nhân vật, cốt truyện, timeline, và xây dựng Knowledge Graph nội bộ (`.cbm/index.json`) phục vụ truy vấn ngữ cảnh.

Dự án hiện chỉ có file `plan.md`. Cần xây dựng toàn bộ từ đầu.

> [!IMPORTANT]
> **Scope**: Triển khai **Phase 1 + Phase 2** (Core Infra, MCP Resources, Safety, Rescue Tools). Các phase sau sẽ được triển khai tuần tự sau khi Phase 1+2 ổn định.

## Proposed Changes

### Component 1: Project Bootstrap & Build System

#### [NEW] [package.json](file:///home/ptcuong/Projects/story-architect-mcp/package.json)
- TypeScript project với `@modelcontextprotocol/server` v2
- Dependencies: `zod` (schema validation), `glob` (file scanning), `diff` (snapshot), `gray-matter` (YAML frontmatter)
- Scripts: `build`, `dev`, `start`, `test`

#### [NEW] [tsconfig.json](file:///home/ptcuong/Projects/story-architect-mcp/tsconfig.json)
- Target ES2022, module NodeNext
- Strict mode, outDir `dist/`

#### [NEW] [.gitignore](file:///home/ptcuong/Projects/story-architect-mcp/.gitignore)

---

### Component 2: MCP Server Core (`src/server/`)

#### [NEW] [src/index.ts](file:///home/ptcuong/Projects/story-architect-mcp/src/index.ts)
- Entry point: tạo `McpServer`, đăng ký tất cả tools/resources/prompts, khởi động stdio transport

#### [NEW] [src/server/StoryProject.ts](file:///home/ptcuong/Projects/story-architect-mcp/src/server/StoryProject.ts)
- Class chính quản lý trạng thái dự án tiểu thuyết
- Đọc/ghi `.story/config.json`, `status.json`, `timeline.json`...
- Cung cấp phương thức: `getConfig()`, `getStatus()`, `getWordCount()`, `ensureStructure()`
- Phát hiện và validate cấu trúc thư mục chuẩn

#### [NEW] [src/server/types.ts](file:///home/ptcuong/Projects/story-architect-mcp/src/server/types.ts)
- Zod schemas cho toàn bộ data model: `StoryConfig`, `StoryStatus`, `TimelineEvent`, `PlotHole`, `Foreshadowing`, `Relationship`, `StyleGuide`, `CharacterProfile`, `WorldEntry`

---

### Component 3: MCP Resources (`src/resources/`)

Expose dữ liệu read-only qua MCP Resource protocol:

#### [NEW] [src/resources/index.ts](file:///home/ptcuong/Projects/story-architect-mcp/src/resources/index.ts)
- Đăng ký tất cả resources vào McpServer
- Resources cố định: `story://status`, `story://config`, `story://timeline`, `story://holes`, `story://foreshadowing`, `story://relationships`
- Resource templates (dynamic): `story://bible/characters/{name}`, `story://bible/world/{location}`, `story://manuscript/{arc}/{chapter}`

---

### Component 4: MCP Prompts (`src/prompts/`)

#### [NEW] [src/prompts/index.ts](file:///home/ptcuong/Projects/story-architect-mcp/src/prompts/index.ts)
- `write-next-chapter`: Gom Lore + Chương trước + Dàn ý + Style Guide → System Prompt
- `character-deep-dive`: Tổng hợp hồ sơ nhân vật + cảnh xuất hiện
- `continuity-audit`: Quét Arc phát hiện mâu thuẫn
- `rescue-project`: Workflow giải cứu dự án lộn xộn
- `brainstorm-scene`: Gợi ý hướng triển khai cảnh

---

### Component 5: Tools - Nhóm 1: Rescue & Restructure (`src/tools/`)

#### [NEW] [src/tools/rescue/scanMessyProject.ts](file:///home/ptcuong/Projects/story-architect-mcp/src/tools/rescue/scanMessyProject.ts)
- **`story_scan_messy_project`**: Quét tệp, phát hiện trùng lặp, encoding, phân loại (Manuscript/Notes/Lore/Outline) với confidence score

#### [NEW] [src/tools/rescue/autoRefactorStructure.ts](file:///home/ptcuong/Projects/story-architect-mcp/src/tools/rescue/autoRefactorStructure.ts)
- **`story_auto_refactor_structure`**: Chuẩn hóa thư mục theo layout. Dry-run mode (`confirm: false` → preview only)

#### [NEW] [src/tools/rescue/snapshot.ts](file:///home/ptcuong/Projects/story-architect-mcp/src/tools/rescue/snapshot.ts)
- **`story_snapshot`**: Lưu snapshot trạng thái vào `.story/snapshots/`
- **`story_rollback`**: Khôi phục từ snapshot

---

### Component 6: Tools - Nhóm 4: Management (`src/tools/management/`)

#### [NEW] [src/tools/management/plotHoles.ts](file:///home/ptcuong/Projects/story-architect-mcp/src/tools/management/plotHoles.ts)
- **`story_log_plot_hole`**: Ghi nhận điểm mâu thuẫn mới
- **`story_resolve_plot_hole`**: Đánh dấu đã giải quyết

#### [NEW] [src/tools/management/stats.ts](file:///home/ptcuong/Projects/story-architect-mcp/src/tools/management/stats.ts)
- **`story_stats`**: Thống kê word count, tiến độ, tốc độ viết

#### [NEW] [src/tools/management/foreshadowing.ts](file:///home/ptcuong/Projects/story-architect-mcp/src/tools/management/foreshadowing.ts)
- **`story_log_setup` / `story_log_payoff` / `story_list_unfired`**: Log setup/payoff, cảnh báo Chekhov's gun chưa bắn

---

### Component 7: Tools - Init & Export

#### [NEW] [src/tools/init.ts](file:///home/ptcuong/Projects/story-architect-mcp/src/tools/init.ts)
- **`story_init`**: Khởi tạo dự án tiểu thuyết mới với cấu trúc thư mục chuẩn

#### [NEW] [src/tools/export.ts](file:///home/ptcuong/Projects/story-architect-mcp/src/tools/export.ts)
- **`story_export`**: Xuất bản thảo thành markdown đơn / HTML / EPUB / DOCX (có mục lục); PDF qua gợi ý print-to-PDF

---

### Component 8: Utilities

#### [NEW] [src/utils/fileUtils.ts](file:///home/ptcuong/Projects/story-architect-mcp/src/utils/fileUtils.ts)
- Hàm helper: đọc/ghi JSON, đếm từ, quét thư mục, phát hiện encoding

#### [NEW] [src/utils/wordCount.ts](file:///home/ptcuong/Projects/story-architect-mcp/src/utils/wordCount.ts)
- Đếm từ cho tiếng Anh và tiếng Việt

---

## Cấu trúc thư mục dự kiến

```
story-architect-mcp/
├── package.json
├── tsconfig.json
├── .gitignore
├── plan.md
├── src/
│   ├── index.ts                          # Entry point
│   ├── server/
│   │   ├── StoryProject.ts              # Core project management
│   │   └── types.ts                     # Zod schemas & types
│   ├── resources/
│   │   └── index.ts                     # MCP Resources registration
│   ├── prompts/
│   │   └── index.ts                     # MCP Prompts registration
│   ├── tools/
│   │   ├── init.ts                      # story_init
│   │   ├── export.ts                    # story_export
│   │   ├── rescue/
│   │   │   ├── scanMessyProject.ts      # story_scan_messy_project
│   │   │   ├── autoRefactorStructure.ts # story_auto_refactor_structure
│   │   │   └── snapshot.ts             # story_snapshot / story_rollback
│   │   └── management/
│   │       ├── plotHoles.ts             # story_log_plot_hole / story_resolve_plot_hole
│   │       ├── stats.ts                # story_stats
│   │       └── foreshadowing.ts        # story_log_setup / payoff / list_unfired
│   └── utils/
│       ├── fileUtils.ts                 # File I/O helpers
│       ├── wordCount.ts                # Word counting
│       ├── zip.ts                      # ZIP packaging (EPUB/DOCX)
│       ├── markdownToHtml.ts           # Markdown → HTML rendering
│       └── knowledgeGraph.ts           # Knowledge Graph index & search
├── test/                                # Unit tests (tsx --test)
│   ├── wordCount.test.ts
│   ├── fileUtils.test.ts
│   ├── markdownHtml.test.ts
│   ├── zip.test.ts
│   ├── storyProject.test.ts
│   └── knowledgeGraph.test.ts
```

## Verification Plan

### Automated Tests
```bash
npm run build    # TypeScript compilation
npm test         # Unit tests (node:test via tsx)
npx mcp-inspector # Test tools/resources interactively (nếu có)
```

### Manual Verification
- Khởi tạo dự án mẫu bằng `story_init`
- Verify các resources trả về JSON đúng schema
- Test dry-run mode cho `story_auto_refactor_structure`
- Test snapshot/rollback cycle

# Changelog

Tất cả thay đổi đáng chú ý của `story-architect-mcp` được ghi lại ở đây.
Format theo [Keep a Changelog](https://keepachangelog.com/), version theo [SemVer](https://semver.org/).

## [0.3.0] — 2026-10-25

Nâng cấp dựa trên audit v0.2.0: khắc phục 6 điểm hạn chế đã ghi nhận (xem `UPGRADE_PLAN_v0.3.0.md`).

### Added
- **Khoá ghi & ghi nguyên tử** (`src/utils/fileUtils.ts`):
  - `writeTextFileAtomic` / `writeJsonFile` ghi qua file tạm + `rename()` → reader không bao giờ thấy file nửa chừng; file tạm luôn được dọn sạch kể cả khi lỗi.
  - `withFileLock(lockPath, fn)` — advisory lock 2 tầng: in-process mutex (Map theo path) + on-disk lock dir (`mkdir` nguyên tử, cross-process) với stale-TTL 15s (mượn khoá của process đã sập) và timeout 10s (fail-fast).
  - Áp dụng cho mọi read-modify-write của `StoryProject`: `saveConfig`, `saveStatus`, `recordWritingProgress`, `saveTimeline`, `saveCharacterStates`, `savePlotHoles`, `saveForeshadowing`, `saveRelationships`, `saveStyleGuide`, `saveSentimentCache` — an toàn khi nhiều MCP client ghi cùng một dự án.
- **Tool `story_list_projects`** — liệt kê mọi dự án đã mở trong phiên server (kèm trạng thái khởi tạo + active). Tăng tổng số tools 28 → **29**.
- **Project registry** trong `src/index.ts`: tái sử dụng instance `StoryProject` theo path khi quay lại dự án đã mở (không dựng lại index/cache).
- **Fuzzy graph matching** (`src/utils/knowledgeGraph.ts`):
  - `normalizeKey` — chuẩn hoá không dấu (NFD-strip + `đ`→`d`): "Trăng" ≡ "trang", "Linh Hồn" ≡ "linh hon", áp dụng cho chính khoá adjacency/relate/god-nodes để thống nhất alias dối dấu.
  - `levenshtein` + `fuzzyMatches` — khớp sai chính tả nhẹ (±1–2 ký tự tuỳ độ dài) cho `searchEntities` lẫn `resolveNodeName`.
- **Cảnh báo minh bạch lexical** — `story_analyze_sentiment` ghi rõ phương pháp (`lexicon-v2`) và in ⚠️ khi coverage < 5% (văn ẩn dụ/nghị đảo dễ bị đọc lệch).
- **Test mới**: `test/atomicLock.test.ts` (6 test — atomic, 30 ghi song song không mất dữ liệu, stale-lock mượn, timeout), `test/graphFuzzy.test.ts` (7 test — fuzzy/alias/không dấu).

### Changed
- **EPUB3 export** : thêm `dcterms:modified` (chuẩn epubcheck), CSS nâng cấp (justify + hyphenation + ngắt trang giữa section).
- **DOCX export**: ngắt trang giữa các chương, style `Normal` justify + first-line indent + Times New Roman, `docProps/core.xml` đầy đủ (creator/language/modified) + `docProps/app.xml` mới (Application/AppVersion/Words).
- Version banner CLI & server v0.2.0 → v0.3.0; cập nhật README (bảng tools, mục "What's New"), skills (`v0.2.0` → `v0.3.0`).

### Notes
- Sentiment/pacing vẫn chủ ý dùng engine thuần lexicon zero-dependency (tradeoff đã đánh giá trong plan); hướng nâng cấp LLM-backbone nằm ở roadmap.
- `story_query_context` vẫn BFS + token-overlap; embedding là mục tiêu tương lai (optional provider), không chặn v0.3.0.
- Full test pass: 139 unit + 3 smoke suite (stdio 20, all-tools 48, edge-cases 41) — 0 FAIL.

## [0.2.0] — trước 2026-10-25

- Bản "Novels as Codebases" đầy đủ: 28 tools, 8 resources + 4 templates, 5 prompts, skills suite, snapshot/rollback, timeline đa tuyến, Chekhov's gun tracker, dashboard HTML, export EPUB/DOCX thuần TS (see README).

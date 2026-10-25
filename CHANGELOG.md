# Changelog

Tất cả thay đổi đáng chú ý của `story-architect-mcp` được ghi lại ở đây.
Format theo [Keep a Changelog](https://keepachangelog.com/), version theo [SemVer](https://semver.org/).

## [0.5.0] — 2026-10-25

Đợt P3: timeline theo ngày tuyệt đối, xếp hạng tìm kiếm BM25, và dọn snapshot (không thay đổi format `.story/*.json`, không thêm dependency).

### Added
- **Timeline absolute dates** (`story_detect_timeline_conflicts`):
  - Omnipresence qua parsed date: `"2025-01-01"` ≡ `"2025-01-01 00:00"` khi phát hiện phân thân cùng lúc (không còn sót conflict vì format khác).
  - Conflict #4 "Mâu thuẫn ngày/chương": cùng thread hoặc cùng nhân vật, hai sự kiện có cả ngày lẫn chương nhưng thứ tự ngày ngược thứ tự chương (LLM hay ghi event "sau" ở chương trước) — nhắc kiểm tra flashback chủ ý.
  - Mermaid sort thông minh: relativeOrder → parsed date → chương tự nhiên (trước giờ chỉ có relativeOrder).
  - Feedback `addEvent`: ISO date được báo "tham gia phát hiện mâu thuẫn ngày"; in-world date (vd "Năm 340 Huyết Nhung") được báo "chỉ lưu hiển thị".
- **BM25 ranking** (`story_query_context` / tìm kiếm theo terms): `bm25Rank` zero-dep (idf log(1+(N-df+0.5)/(df+0.5)), k1=1.2, b=0.75) thay đếm trùng tuyến tính ở bậc 4 của `searchEntities` — từ hiếm ("phượng hoàng", "thiên tài thuần khiết") quyết định nhiều hơn từ phổ thông ("nhân vật", "cô gái"). Bậc 1–3 (tên/alias/fuzzy) vẫn ưu tiên hơn, score terms cap 0.4.
- **`story_prune_snapshots`** (tool thứ 30): dọn snapshot cũ an toàn — `keepLast` (mặc định 10) + `olderThanDays` optional, preview trước khi `confirm: true`; keepLast < 3 không confirm → từ chối (fail-safe); orphan entry (thư mục bị xóa tay) tự dọn khỏi index; đo dung lượng trước xóa, báo cáo MB/KB giải phóng; RMW `index.json` trong file lock (an toàn khi song song với `story_snapshot`).
- **Test mới**: `test/p3Features.test.ts` (9 test P3) — 157 unit tests tổng cộng (từ 148).

### Changed
- `story_snapshot` khi ≥20 snapshots: khuyến nghị gọi `story_prune_snapshots` thay vì cảnh báo chung chung.

### Fixed
- **`parseAbsoluteDate` nghiêm ngặt + frame local thống nhất**: chỉ chấp nhận format có thành phần ISO date (`2025-06-15...`) — văn xuôi kiểu tiếng Anh ("March 5") và năm thuần ("2025") không còn "hào phóng" lọt vào conflict detection; mốc có `Z`/offset chuẩn hóa về giờ lịch địa phương nên 2 cách ghi offset khác nhau cùng 1 instant khớp nhau (không còn lệch dấu ±7h nếu trộn mốc UTC với date-only gần midnight).
- **Prune race thu hẹp**: nhánh confirmed tính lại plan trên index vừa đọc TRONG 1 khoá (đọc → tính → xóa dir → RMW index) — prune song song với `story_snapshot` không còn đọc topology cũ; báo cáo "Còn lại N" khớp thực tế, có nhánh "không còn gì để xóa".
- **Đai an toàn `keepLast`**: schema `min(1)` + guard runtime "≥ 1" kể cả khi `confirm: true` — không cho phép xóa toàn bộ snapshot.
- **Đếm snapshot cảnh báo ≥20** đọc từ `index.json` thay vì liệt kê thư mục (orphan bị xóa tay không còn tính nhầm).
- Dọn dead code `termOverlap` (bị BM25 thay thế từ v0.5.0).

## [0.4.0] — 2026-10-25

Đợt ổn định + tiện nghi: phát hiện thay đổi từ ngoài, bảo vệ regression chủ chốt, và nâng trải nghiệm xuất bản (không thay đổi format `.story/*.json`, không thêm dependency).

### Added
- **Auto-stale Knowledge Graph cache** (`src/utils/knowledgeGraph.ts`):
  - `computeSourceFingerprint` — fingerprint stat (mtime+size) của bible/characters/world/subplots + relationships.json + timeline.json.
  - `loadOrBuildIndex` so khớp fingerprint trước khi tin `hit .cbm/index.json`: file bị sửa từ ngoài editor (thêm nhân vật tay, sửa hồ sơ) tự được nhận — không cần gọi `rebuildIndex` thủ công nữa. Cache bản cũ (thiếu fingerprint) luôn được rebuild một lần.
- **Diff biến động trong `action: "history"`** (`story_track_character_state`): mỗi mốc kèm dòng "Biến động so với mốc trước" — vật phẩm mất/thu (`− 🎒 / + 🎒`), bí mật mới học (`+ 🗝️`), đổi status/tình trạng/vị trí. Read-only, không đổi format file.
- **Auto-scan cache theo fingerprint** (`story_map_relationships` chế độ tự quét): `computeAllCooccurrences` cache kết quả per-projectPath, invalidate tự động khi manuscript hoặc bible/characters đổi — gọi liên tục (preview → xác nhận, nhiều tool call) chỉ đọc đĩa một lần.
- **EPUB cover SVG** (`story_export`): bìa vẽ SVG inline (title/author/genre từ metadata, khung viền vàng, khung 1000×1600), entry `OEBPS/cover.xhtml` với `properties="svg"` ở đầu spine + landmark Cover trong nav. Zero-dep — không cần thư viện render ảnh.
- **DOCX TOC field thật + Navigation pane**: mục lục là Word field (F9 → sinh tự động từ Heading1, `w:dirty="true"`); thêm `w:outlineLvl` (0/1/2) cho Heading1–3 để chương hiện đúng Navigation Pane.
- **Test mới**: `test/indexStaleness.test.ts` (auto-stale index + scan cache), `test/lockCrossProcess.test.ts` (4 process × 10 RMW → đúng 40 — tầng on-disk lock lần đầu có phòng chống regression), 148 unit tests tổng cộng (từ 143).

### Changed
- **Sentiment engine `lexicon-v2` → `lexicon-v3`**: phủ định/tăng cường dạng không dấu giờ khớp đúng (`"khong vui"`, `"rat"`, `"vo cung"`, `"cuc ky"`, `"that su"`...) — trước giờ chỉ lexicon ENTRY có fallback không dấu, còn negator/intensifier thì không, khiến văn viết muột bị suy giảm polarity. "chua" (canh chua) chủ ý KHÔNG thêm vào negator để tránh false positive. Method label minh bạch nâng `lexicon-v2` → `lexicon-v3`.
- Skills docs đồng bộ: nhãn `lexicon-v3`, mọi tính năng v0.4.0; README "What's New" bổ sung.

### Notes
- Zero-dependency giữ nguyên; format `.story/*.json` and `.cbm/index.json` additive (thêm field optional).

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

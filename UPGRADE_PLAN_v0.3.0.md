# Kế hoạch Nâng cấp v0.3.0 — Khắc phục 6 Hạn chế của v0.2.0

> Ngày lập: 2026-10-25 · Cơ sở: Phân tích audit v0.2.0 (6 điểm hạn chế theo ưu tiên)
> Nguyên tắc: giữ kỷ luật **zero-dependency runtime** (chỉ 3 deps: MCP SDK, gray-matter, zod),
> mọi nâng cấp đều có unit test + smoke test, không breaking API dữ liệu (`.story/` giữ nguyên format, chỉ thêm field optional).

## H1 · Khoá ghi & Ghi nguyên tử (limitation #1 — Ưu tiên CAO)

**Vấn đề:** không khóa ghi; nhiều MCP client ghi cùng dự án → race trên `.story/*.json`;
write trực tiếp (`fs.writeFile`) có thể để lại file cắt nửa chừng khi sập giữa chừng.

**Giải pháp (2 tầng):**

1. **Atomic write** (`fileUtils.ts`): `writeJsonFile`/`writeTextFileAtomic` ghi ra file
   tạm `.tmp.<pid>.<ts>` cùng thư mục rồi `rename()` — rename trên POSIX/Windows đều nguyên tử,
   reader luôn thấy file cũ hoặc mới, không bao giờ file rotten. Không để lại .tmp khi lỗi.
2. **Advisory lock 2 tầng** (`withFileLock`):
   - Tầng 1 — *in-process mutex* (Map khoá theo path): serialize ngay các tool call
     cùng server instance chạy song song;
 - Tầng 2 — *on-disk lock* bằng `mkdir` (nguyên tử cross-process) trong `.story/locks/`,
     có stale-TTL 15s (mượn khoá) + timeout 10s (fail → báo lỗi, không treo server).
3. **Áp dụng:** mọi method read-modify-write của `StoryProject`
   (`saveConfig`, `saveStatus`, `recordWritingProgress`, `saveTimeline`, `saveCharacterStates`,
   `savePlotHoles`, `saveForeshadowing`, `saveRelationships`, `saveStyleGuide`, `saveSentimentCache`).
   Read không cần lock nhờ tên nguyên tử.

## H2 · Multi-project registry (limitation #2)

**Vấn đề:** chỉ giữ 1 `currentProject` mutable → chuyển dự án là mất tham chiếu cũ mỗi lần
tạo mới `StoryProject`; không liệt kê được các dự án đã mở trong phiên.

**Giải pháp:** `ProjectRegistry` (Map path→StoryProject) trong `index.ts` — reusing instance
khi quay lại dự án đã mở; thêm tool **`story_list_projects`** (liệt kê dự án đã mở trong phiên,
đánh dấu active). Mỗi server instance vẫn phục vụ 1 dự án active tại một thời điểm bằng thiết kế
(đúng hợp đồng MCP) — song song nhiều tác phẩm = chạy nhiều instance `npx story-architect-mcp`,
tài liệu hoá rõ trong README.

## H3 · Graph matching: chuẩn hoá dấu + fuzzy (limitation #4)

**Vấn đề:** `normalize` chỉ lowercase — alias chênh dấu ("Lin NHồn" vs "Linh Hồn",
"Trang" vs "Trăng") không khớp; query sai chính tả là miss.

**Giải pháp:** `normalizeKey` (NFD-strip dấu + đ→d) làm khoá adjacency/search/resolve;
thêm **Levenshtein fuzzy** (cận trên: dist ≤ floor(len/4), cap 2) cho cả `searchEntities` lẫn
`resolveNodeName` với score giảm dần (exact 1.0 > contain 0.8 > alias 0.6 > fuzzy 0.5 > term 0.4).
Embedding vẫn là hướng tương lai (đe optional provider) — không đè bupenen hiện tại.

## H4 · Sentiment: minh bạch hoá giới hạn lexical (limitation #3)

**Vấn đề:** lexicon-based sai với ẩn dụ/nghị đảo; không report được "đo this text lexical đo không đủ".

**Giải pháp:** giữ engine (zero-dep, đã có negation+intensifier+teencode);
thêm **cảnh báo low-coverage** vào output `story_analyze_sentiment`/`story_track_emotion` khi
coverage < 5% (gợi ý mô tả trực tiếp nếu cần) và ghi tag `method: lexicon-v2` (traceability).
Đánh giá nâng cấp LLM-backbone: cần callback API, giữ roadmap không chặn.

## H5 · EPUB/DOCX giàu hoá (limitation #6)

**Giải pháp:**
- **EPUB3**: thêm `dc:description`, `dcterms:modified` (epubcheck), nh page-break
  giữa các chương trong CSS (`section { page-break-before: always; }`, `text-align: justify`,
  hyphens auto theo ngôn ngữ).
- **DOCX**: ngắt trang giữa chapters (field `<w:br w:type="page"/>`);
  `docProps/core.xml` đầy đủ (dc:creator, dc:language, dc:modified); thêm `docProps/app.xml`;
  style chỉnh `Normal` justify + first-line indent, `rFonts` Times New Roman.

## H6 · Release hygiene (limitation #5)

- `CHANGELOG.md` theo Keep a Changelog.
- Bump `0.3.0` (package.json + `index.ts` banner + skills docstring).
- Git tag `v0.3.0` (anotated), hướng dẫn `git push --tags`.
- README: cập nhật 29 tools, luồng multi-project, mục locking/snapshot.

## Kiểm định (Definition of Done)

- ✅ `npm run build` sạch (typecheck tsc)
- ✅ 125 test cũ + test mới (atomic/lock, graph fuzzy) pass
- ✅ Smoke: `smoke-stdio` thấy **29 tools**; `smoke-all-tools` pass với tool mới
- ✅ Không thêm dependency runtime mới
- ✅ Commit + tag `v0.3.0`

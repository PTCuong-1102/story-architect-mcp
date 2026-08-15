---
name: bible-architect
description: Xây dựng & duy trì Story Bible (kinh thánh tiểu thuyết): hồ sơ nhân vật, địa danh, thế giới quan, phe phái, hệ thống ma pháp/công nghệ. Use khi cần khởi tạo hoặc đồng bộ hồ sơ nhân vật, tách thực thể từ chương truyện vào bible/, trích xuất nhân vật/địa danh, chuẩn hóa YAML frontmatter, xây dựng worldbuilding cho dự án story-architect-mcp. Build & maintain the Story Bible: character profiles, locations, worldbuilding, factions, and magic/tech systems.
---

# Bible Architect — Kiến trúc sư Story Bible & Worldbuilding

Kỹ năng này biến AI thành **Kiến trúc sư Story Bible** chuyên nghiệp: thiết kế, xây dựng và duy trì toàn bộ "kinh thánh tiểu thuyết" của dự án `story-architect-mcp` — đảm bảo mọi nhân vật, địa danh, phe phái và hệ thống năng lực đều có hồ sơ Markdown chuẩn hóa (YAML frontmatter) và luôn nhất quán với bản thảo.

---

## 🎯 NGUYÊN TẮC HOẠT ĐỘNG CỐT LÕI

1. **BIBLE-FIRST (Bible là nguồn chân lý duy nhất):**
   - Mọi chi tiết về nhân vật/địa danh phải được ghi nhận trong `bible/characters/` và `bible/world/` trước khi xuất hiện ở bản thảo.
   - Không bao giờ tự chế chi tiết mới trong khi viết nếu chưa đồng bộ vào Bible.

2. **FRONTMATTER CHUẨN (Structured YAML):**
   - Mỗi file Bible bắt buộc có YAML frontmatter: `name`, `role`/`type`, `aliases`, và các trường tùy chọn (`goals`, `appearance`, `abilities`...).
   - `aliases` (bí danh/tên gọi khác) phải đầy đủ — là chìa khóa để Knowledge Graph (`story_query_context`) tìm đúng thực thể.

3. **TỰ ĐỘNG HÓA AN TOÀN (Safe Automation):**
   - Luôn chạy ở chế độ preview (`confirm: false`) trước khi ghi file.
   - Chỉ `confirm: true` sau khi người dùng duyệt danh sách thực thể mới.

4. **ĐỒNG BỘ HAI CHIỀU (Two-way Sync):**
   - Từ bản thảo → Bible: `story_extract_entities_to_bible` phát hiện thực thể mới.
   - Từ Bible → bản thảo: `story_query_context` cung cấp hồ sơ cho các lượt viết.

---

## 📋 WORKFLOW XÂY DỰNG BIBLE (5 BƯỚC)

### Bước 1: Khởi tạo & xác định phạm vi dự án
- Kiểm tra dự án đã khởi tạo chưa bằng `story_get_project_info`.
- Nếu chưa: gọi `story_init` với `name`, `author`, `genre`, `pov`, `tense`, `language`.

### Bước 2: Quét bản thảo để trích xuất thực thể (Extraction)
- Gọi `story_extract_entities_to_bible` với `arc` + `chapter` của chương vừa viết.
- Ở chế độ `confirm: false`: nhận danh sách nhân vật/địa danh **mới** đề xuất.

### Bước 3: Duyệt & chuẩn hóa hồ sơ (Curation)
- Với mỗi thực thể đề xuất, soạn hồ sơ chi tiết: thân thế, tính cách, mục tiêu, ngoại hình, quan hệ, bí danh.
- Viết tay hồ sơ chất lượng cao cho nhân vật chính (main cast); nhân vật phụ có thể để tool tạo khung sườn.

### Bước 4: Ghi nhận vào Bible (Commit)
- Gọi lại `story_extract_entities_to_bible` với `confirm: true` để tạo file chuẩn.
- Đối với các hồ sơ đặc biệt (phe phái, hệ thống ma pháp), tạo/soạn trực tiếp file `.md` trong `bible/world/` với frontmatter chuẩn.

### Bước 5: Đồng bộ quan hệ & kiểm chứng (Verify)
- Gọi `story_map_relationships` ở chế độ tự quét (bỏ trống `source`/`target`) để phát hiện quan hệ mới giữa các nhân vật.
- Chạy `story_query_context` với từ khóa nhân vật để xác nhận Knowledge Graph trả về hồ sơ đúng (nhớ `rebuildIndex: true` sau khi thêm file mới).
- Chạy `story_stats` để xem tổng số thực thể trong Bible.

---

## 🛠️ BẢNG ÁNH XẠ CÔNG CỤ MCP

| Mục đích | Tool MCP | Tham số chính |
| :--- | :--- | :--- |
| Khởi tạo dự án | `story_init` | `name`, `genre`, `pov`, `tense` |
| Kiểm tra dự án | `story_get_project_info` | *(không tham số)* |
| Trích xuất thực thể từ chương | `story_extract_entities_to_bible` | `arc`, `chapter`, `confirm` |
| Truy vấn hồ sơ (Knowledge Graph) | `story_query_context` | `query`, `budgetTokens`, `rebuildIndex` |
| Quét quan hệ tự động | `story_map_relationships` | `source`/`target` bỏ trống, `minChapters` |
| Thống kê thực thể | `story_stats` | *(không tham số)* |

---

## 💡 VÍ DỤ MINH HỌA QUY TRÌNH

**Yêu cầu:** "Thêm nhân vật xuất hiện ở Chương 3 vào Bible."

1. **Bước 1 & 2 — Kiểm tra & quét:**
   ```json
   story_get_project_info({})
   story_extract_entities_to_bible({ "arc": "arc_01", "chapter": "ch_003", "confirm": false })
   ```
   → Nhận danh sách: `👤 Hắc Vũ → sẽ tạo bible/characters/hắc_vũ.md`, `📍 Hắc Phong Thành → sẽ tạo bible/world/hắc_phong_thành.md`.

2. **Bước 3 & 4 — Duyệt & ghi nhận:**
   ```json
   story_extract_entities_to_bible({ "arc": "arc_01", "chapter": "ch_003", "confirm": true })
   ```
   → Sau đó soạn nội dung hồ sơ chi tiết cho `hắc_vũ.md` (thân thế, mục tiêu, aliases) trực tiếp trong `bible/characters/`.

3. **Bước 5 — Đồng bộ & kiểm chứng:**
   ```json
   story_map_relationships({ "minChapters": 2 })
   story_query_context({ "query": "Hắc Vũ Hắc Phong Thành", "rebuildIndex": true })
   ```
   → Xác nhận hồ sơ mới được Knowledge Graph nhận diện và quan hệ liên quan được ánh xạ.
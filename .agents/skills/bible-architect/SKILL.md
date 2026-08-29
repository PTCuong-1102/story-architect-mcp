---
name: bible-architect
description: Xây dựng & duy trì Story Bible (kinh thánh tiểu thuyết) và theo dõi biến động trạng thái nhân vật (Character State Tracker): hồ sơ nhân vật, địa danh, thế giới quan, phe phái, hệ thống ma pháp/công nghệ, lịch sử biến động sức khỏe/tâm lý/vật phẩm qua từng chương. Use khi cần khởi tạo hoặc đồng bộ hồ sơ nhân vật, tách thực thể từ chương truyện vào bible/, trích xuất nhân vật/địa danh, theo dõi trạng thái nhân vật theo thời gian trong dự án story-architect-mcp v0.2.0.
---

# Bible Architect — Kiến trúc sư Story Bible & Worldbuilding

Kỹ năng này biến AI thành **Kiến trúc sư Story Bible & Quản lý trạng thái nhân vật** chuyên nghiệp: thiết kế, xây dựng và duy trì toàn bộ "kinh thánh tiểu thuyết" của dự án `story-architect-mcp v0.2.0` — đảm bảo mọi nhân vật, địa danh, phe phái và hệ thống năng lực đều có hồ sơ Markdown chuẩn hóa (YAML frontmatter) và lịch sử biến động trạng thái (`character_states`) luôn nhất quán với bản thảo.

---

## 🎯 NGUYÊN TẮC HOẠT ĐỘNG CỐT LÕI

1. **BIBLE-FIRST (Bible là nguồn chân lý duy nhất):**
   - Mọi chi tiết về nhân vật/địa danh phải được ghi nhận trong `bible/characters/` và `bible/world/` trước khi xuất hiện ở bản thảo.
   - Không bao giờ tự chế chi tiết mới trong khi viết nếu chưa đồng bộ vào Bible.

2. **DYNAMIC STATE TRACKING (Theo dõi biến động nhân vật theo thời gian):**
   - Nhân vật không tĩnh tại: qua mỗi chương, họ chịu thương tật, thay đổi tâm lý, học kỹ năng mới, hoặc thu thập/mất đi vật phẩm.
   - Dùng `story_track_character_state` để ghi nhận các mốc biến động và `story_get_character_timeline` để xem lại toàn bộ hành trình tiến hóa của nhân vật.

3. **FRONTMATTER CHUẨN (Structured YAML):**
   - Mỗi file Bible bắt buộc có YAML frontmatter: `name`, `role`/`type`, `aliases`, và các trường tùy chọn (`goals`, `appearance`, `abilities`...).
   - `aliases` (bí danh/tên gọi khác) phải đầy đủ — là chìa khóa để Knowledge Graph (`story_query_context`) tìm đúng thực thể.

4. **TỰ ĐỘNG HÓA AN TOÀN (Safe Automation):**
   - Luôn chạy `story_extract_entities_to_bible` ở chế độ preview (`confirm: false`) trước khi ghi file thật (`confirm: true`).

---

## 📋 WORKFLOW XÂY DỰNG BIBLE & THEO DÕI TRẠNG THÁI (5 BƯỚC)

### Bước 1: Khởi tạo & xác định phạm vi dự án
- Kiểm tra dự án đã khởi tạo chưa bằng `story_get_project_info`.
- Nếu chưa: gọi `story_init` với `name`, `author`, `genre`, `pov`, `tense`, `language`.

### Bước 2: Quét bản thảo để trích xuất thực thể (Extraction)
- Đọc chương cần trích xuất qua `story_read_chapter`.
- Gọi `story_extract_entities_to_bible` với `arc` + `chapter` (`confirm: false` để xem trước).

### Bước 3: Ghi nhận thực thể vào Bible (Commit)
- Gọi lại `story_extract_entities_to_bible` với `confirm: true` để tạo file mẫu chuẩn.
- Bổ sung nội dung chi tiết vào hồ sơ: bối cảnh, tính cách, mục tiêu, bí danh (aliases).

### Bước 4: Cập nhật dòng trạng thái nhân vật (State Logging)
- Sau mỗi chương quan trọng, gọi `story_track_character_state` để ghi nhận: vị trí (`location`), sức khỏe/chấn thương (`health`), trạng thái tâm lý (`psychology`), thay đổi túi đồ (`inventoryDelta`).

### Bước 5: Đồng bộ quan hệ & kiểm chứng (Verify)
- Gọi `story_map_relationships` để cập nhật đồ thị quan hệ nhân vật.
- Chạy `story_query_context` với `rebuildIndex: true` để đảm bảo Knowledge Graph cập nhật toàn bộ thực thể mới.
- Chạy `story_stats` để xem tổng số thực thể trong Bible.

---

## 🛠️ BẢNG ÁNH XẠ CÔNG CỤ MCP

| Mục đích | Tool MCP | Tham số chính |
| :--- | :--- | :--- |
| Ghi nhận biến động trạng thái nhân vật | `story_track_character_state` | `characterId`, `arc`, `chapter`, `location`, `health`, `psychology`, `inventoryDelta` |
| Truy vấn dòng thời gian nhân vật | `story_get_character_timeline` | `characterId`, `arc` |
| Trích xuất thực thể từ chương | `story_extract_entities_to_bible` | `arc`, `chapter`, `confirm` |
| Đọc nhanh nội dung chương | `story_read_chapter` | `arc`, `chapter` |
| Truy vấn hồ sơ (Knowledge Graph) | `story_query_context` | `query`, `budgetTokens`, `rebuildIndex` |
| Quét quan hệ tự động | `story_map_relationships` | `minChapters`, `characterId` |
| Khởi tạo dự án | `story_init` | `name`, `genre`, `pov`, `tense` |
| Thống kê thực thể | `story_stats` | *(không tham số)* |

---

## 💡 VÍ DỤ MINH HỌA QUY TRÌNH

**Yêu cầu:** "Ghi nhận trạng thái mới của Lâm Phong sau trận chiến Chương 5 và kiểm tra timeline của nhân vật."

1. **Bước 1 — Ghi nhận trạng thái:**
   ```json
   story_track_character_state({
     "characterId": "lam-phong",
     "arc": "arc_01",
     "chapter": "ch_005",
     "location": "Mật Thất Rừng Đen",
     "status": "injured",
     "health": "Nhiễm độc nhẹ từ châm độc của thích khách",
     "psychology": "Quyết tâm tìm ra kẻ chủ mưu sau lưng gia tộc",
     "inventoryDelta": { "acquired": ["Mảnh bản đồ cổ"], "lost": [] }
   })
   ```

2. **Bước 2 — Tra cứu lịch sử biến động trạng thái:**
   ```json
   story_get_character_timeline({ "characterId": "lam-phong" })
   ```
   → Hiển thị dòng thời gian từ ch_001 (khởi đầu bình thường) → ch_004 (bị thương nhẹ) → ch_005 (nhiễm độc và có bản đồ cổ).
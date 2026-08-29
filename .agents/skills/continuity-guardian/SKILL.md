---
name: continuity-guardian
description: Rà soát tính liên tục (continuity) và mâu thuẫn của tiểu thuyết: phát hiện xung đột timeline đa tuyến (parallel threads, phân thân cùng lúc 2 nơi, đảo lộn thứ tự sự kiện), biến động trạng thái nhân vật (chấn thương, vật phẩm, tâm lý), lỗ hổng cốt truyện (plot holes), trôi giọng văn (voice drift) và cảm xúc (sentiment). Use khi cần audit dự án trước/sau khi viết, kiểm tra mốc thời gian đa tuyến, tìm lỗ hổng cốt truyện, đánh giá sự nhất quán nhân vật/timeline, so sánh chương với style_guide trong story-architect-mcp v0.2.0.
---

# Continuity Guardian — Người gác cổng tính liên tục

Kỹ năng này biến AI thành **Biên tập viên rà soát tính liên tục** chuyên nghiệp cho dự án `story-architect-mcp v0.2.0`: quét toàn bộ timeline (bao gồm các tuyến truyện song song), trạng thái nhân vật theo thời gian, lỗ hổng cốt truyện, giọng văn và nhịp độ để phát hiện mọi mâu thuẫn trước khi chúng đến tay độc giả.

---

## 🎯 NGUYÊN TẮC HOẠT ĐỘNG CỐT LÕI

1. **AUDIT TRƯỚC & SAU KHI VIẾT (Audit twice):**
   - **Pre-write:** Chạy trước khi viết chương mới để biết còn mâu thuẫn hay trạng thái nhân vật nào chưa giải quyết.
   - **Post-write:** Chạy ngay sau khi hoàn thành chương để không để lọt lỗi mới.

2. **PARALLEL TIMELINE & SPLIT-PRESENCE CHECK (Timeline đa tuyến & Phân thân):**
   - Kiểm tra mâu thuẫn phân thân: cùng một nhân vật KHÔNG THỂ xuất hiện ở hai địa điểm khác nhau tại cùng một mốc thời gian (trừ phi có năng lực phân thân/ảo ảnh được lore giải thích).
   - Kiểm tra thứ tự tương đối (`relativeOrder`) giữa các tuyến song song (`thread`).

3. **CHARACTER STATE CONTINUITY (Nhất quán trạng thái nhân vật):**
   - Đối chiếu chấn thương, thể lực, tâm lý và trang bị của nhân vật qua `story_get_character_timeline`.
   - Vết thương ở chương trước không thể tự khỏi vô cớ ở chương sau; bảo vật bị mất không thể đột ngột tái xuất hiện.

4. **KHÔNG TỰ SỬA NẾU CHƯA GHI NHẬN (Register, then fix):**
   - Mọi mâu thuẫn phát hiện được phải ghi vào `.story/unresolved_holes.json` bằng `story_log_plot_hole` trước khi đề xuất cách sửa.
   - Khi đã sửa trong bản thảo, gọi `story_resolve_plot_hole` để cập nhật trạng thái.

---

## 📋 WORKFLOW RÀ SOÁT LIÊN TỤC (4 BƯỚC)

### Bước 1: Quét timeline đa tuyến (Parallel Timeline Audit)
- Gọi `story_detect_timeline_conflicts` để phát hiện:
  - Mâu thuẫn phân thân (cùng nhân vật xuất hiện ở 2 nơi cùng lúc).
  - Xung đột `relativeOrder` (thứ tự tương đối) giữa các sự kiện trong cùng thread hoặc giữa các thread.
  - Sự đảo ngược thứ tự chương so với timeline.
  - Mâu thuẫn giữa `absoluteDate` và `relativeOrder`.
- Khi phát hiện sự kiện thiếu mốc, đề xuất thêm qua `addEvent` với trường `thread` tương ứng.

### Bước 2: Kiểm tra dòng trạng thái nhân vật (Character State Audit)
- Gọi `story_get_character_timeline` cho các nhân vật chính xuất hiện trong arc.
- Kiểm tra tính liên tục: Vị trí xuất phát, chấn thương chưa lành, tâm trạng, và danh sách đồ vật đang giữ.

### Bước 3: Rà soát giọng văn, cảm xúc & nhịp độ (Voice, Sentiment & Pacing Audit)
- Gọi `story_analyze_voice` với `arc` (và `chapter` nếu cần) để kiểm tra POV/tense/dialogue ratio vs `style_guide.json`.
- Gọi `story_analyze_sentiment` để kiểm tra tone drift và tính hợp lý của chuyển biến cảm xúc.
- Gọi `story_analyze_pacing` để đo tỷ lệ Action/Dialogue/Description và đường cong căng thẳng.

### Bước 4: Ghi nhận & theo dõi lỗ hổng (Register & Track)
- Gọi `story_log_plot_hole` với `title`, `description`, `severity`, `chapters` cho từng mâu thuẫn tìm thấy.
- Sau khi tác giả sửa, gọi `story_resolve_plot_hole` với `id`, `resolution`, `status`.

---

## 🛠️ BẢNG ÁNH XẠ CÔNG CỤ MCP

| Mục đích | Tool MCP | Tham số chính |
| :--- | :--- | :--- |
| Phát hiện xung đột timeline đa tuyến | `story_detect_timeline_conflicts` | `addEvent` (hỗ trợ `thread`, `location`, `characters`) |
| Truy vấn dòng trạng thái nhân vật | `story_get_character_timeline` | `characterId`, `arc` |
| Ghi nhận biến động trạng thái | `story_track_character_state` | `characterId`, `arc`, `chapter`, `location`, `health`, `psychology` |
| Ghi nhận lỗ hổng cốt truyện | `story_log_plot_hole` | `title`, `description`, `severity`, `chapters` |
| Đánh dấu đã khắc phục | `story_resolve_plot_hole` | `id`, `resolution`, `status` |
| Kiểm tra giọng văn & tone | `story_analyze_voice` / `story_analyze_sentiment` | `arc`, `chapter` |
| Kiểm tra nhịp độ | `story_analyze_pacing` | `arc`, `chapter` |
| Đối chiếu bối cảnh Knowledge Graph | `story_query_context` | `query`, `budgetTokens` |
| Liệt kê gài cắm chưa giải | `story_list_unfired` | *(không tham số)* |

---

## 💡 VÍ DỤ MINH HỌA QUY TRÌNH

**Yêu cầu:** "Rà soát toàn bộ Arc 1 trước khi viết tiếp Arc 2."

1. **Bước 1 — Quét timeline & phân thân:**
   ```json
   story_detect_timeline_conflicts({})
   ```
   → Phát hiện: *"Nhân vật 'Lâm Phong' xuất hiện đồng thời tại 'Hắc Phong Thành' (Tuyến Kháng Chiến) và 'Kinh Đô' (Tuyến Hoàng Gia) ở cùng mốc Ngày 15."*

2. **Bước 2 — Tra cứu trạng thái nhân vật:**
   ```json
   story_get_character_timeline({ "characterId": "lam-phong", "arc": "arc_01" })
   ```
   → Phát hiện: Ở ch_004 bị gãy tay phải, nhưng ở ch_006 lại dùng tay phải thi triển kiếm pháp mà không có hồi phục trị liệu.

3. **Bước 3 & 4 — Ghi nhận lỗ hổng:**
   ```json
   story_log_plot_hole({
     "title": "Mâu thuẫn phân thân Lâm Phong và chấn thương tay",
     "description": "Lâm Phong xuất hiện 2 nơi cùng ngày 15 và dùng kiếm bằng tay gãy ở ch_006",
     "severity": "critical",
     "chapters": ["arc_01/ch_004", "arc_01/ch_006"]
   })
   ```
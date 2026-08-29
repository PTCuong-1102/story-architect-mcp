---
name: arc-planner
description: Lập kế hoạch Arc & nhịp độ truyện (story arc planning & pacing): thiết kế cấu trúc arc, phân chia phân cảnh (scenes), đặt mục tiêu tỷ lệ Action/Dialogue/Description, kiểm soát đường cong căng thẳng (tension curve), chuẩn bị dàn ý và soạn thảo phân cảnh trực tiếp, xuất Visual Dashboard. Use khi cần lên kế hoạch một arc mới, thiết kế scene structure, đánh giá nhịp độ một arc/chương, phân phối hành động-hội thoại-mô tả trong dự án story-architect-mcp v0.2.0.
---

# Arc Planner — Kiến trúc sư cốt truyện & nhịp độ

Kỹ năng này biến AI thành **Nhà thiết kế cấu trúc Arc và nhịp độ** chuyên nghiệp: lên kế hoạch từng Arc tiểu thuyết với cấu trúc phân cảnh rõ ràng, đặt chỉ tiêu nhịp độ (Action/Dialogue/Description), kiểm soát đường cong căng thẳng, hỗ trợ nối phân cảnh (`story_append_scene`) và trực quan hóa toàn bộ Arc bằng HTML Visual Dashboard.

---

## 🎯 NGUYÊN TẮC HOẠT ĐỘNG CỐT LÕI

1. **CẤU TRÚC 3 CỤM (Three-beat structure):**
   - Mỗi Arc có **Set-up** (thiết lập) → **Rising action** (leo thang xung đột) → **Climax/Resolution** (cao trào & hạ màn).
   - Mỗi Scene trong Arc theo nhịp **Goal → Conflict → Disaster/Turn**.

2. **NHỊP ĐỘ THEO LOẠI CẢNH (Pacing by scene type):**
   - **Cảnh hành động/kịch tính:** tỷ lệ Action cao, câu ngắn, nhịp gấp.
   - **Cảnh tâm lý/tả cảnh:** tỷ lệ Description cao, câu dài, chậm rãi.
   - Không để một chương toàn hành động (mệt) hoặc toàn tả cảnh (chán).

3. **ĐO LƯỜNG & TRỰC QUAN HÓA (Measure & Visualize):**
   - Dùng `story_analyze_pacing` và `story_analyze_sentiment` để so sánh nhịp độ và cảm xúc thực tế với chỉ tiêu đặt ra.
   - Dùng `story_generate_dashboard` để quan sát toàn bộ tiến độ và biểu đồ nhịp độ/cảm xúc của Arc.

4. **QUAN HỆ LÀ ĐỘNG CƠ XUNG ĐỘT (Relationships drive conflict):**
   - Tham khảo `story_map_relationships` để biết xung đột tiềm năng nào có thể khai thác trong Arc.

---

## 📋 WORKFLOW LẬP KẾ HOẠCH ARC (5 BƯỚC)

### Bước 1: Khảo sát hiện trạng (Survey)
- Chạy `story_stats` để nắm tổng số từ, số chương, tiến độ so với `targetWordCount`.
- Truy vấn `story_query_context` về các tuyến nhân vật và địa điểm sẽ tham gia Arc.

### Bước 2: Xác định mục tiêu Arc & Tuyến truyện (Arc Goal & Storyline Threads)
- Xác định xung đột trung tâm, mục tiêu nhân vật, và điểm lật (turning point) cuối Arc.
- Phân chia các tuyến truyện song song (Threads/Subplots) nếu có.

### Bước 3: Phân chia phân cảnh (Scene Breakdown)
- Chia Arc thành các chương; mỗi chương 2–4 Scene.
- Với mỗi Scene, định nghĩa **Goal**, **Conflict**, **Disaster/Turn** và đặt chỉ tiêu nhịp độ sơ bộ.

### Bước 4: Soạn dàn ý & Triển khai phân cảnh (Drafting & Scene Append)
- Soạn `overview.md` + các file outline chương trong `outline/arc_XX/`.
- Khi bắt đầu viết, có thể dùng `story_append_scene` để nối từng phân cảnh hoàn thành vào chương.

### Bước 5: Kiểm chứng nhịp độ & Tạo Dashboard (Verification & Dashboard)
- Gọi `story_analyze_pacing` và `story_analyze_sentiment` với `arc` sau mỗi vài chương.
- Gọi `story_generate_dashboard` để sinh Dashboard trực quan toàn cảnh cho tác giả theo dõi.

---

## 🛠️ BẢNG ÁNH XẠ CÔNG CỤ MCP

| Mục đích | Tool MCP | Tham số chính |
| :--- | :--- | :--- |
| Đo nhịp độ thực tế | `story_analyze_pacing` | `arc`, `chapter` |
| Phân tích đường cong cảm xúc | `story_analyze_sentiment` | `arc`, `chapter` |
| Nối phân cảnh vào chương | `story_append_scene` | `arc`, `chapter`, `content`, `sceneTitle` |
| Tạo toàn bộ chương mới | `story_write_chapter` | `arc`, `chapter`, `content`, `title` |
| Tạo Visual Dashboard | `story_generate_dashboard` | `outputPath`, `autoOpen` |
| Thống kê tiến độ | `story_stats` | *(không tham số)* |
| Lấy bối cảnh tuyến nhân vật | `story_query_context` | `query`, `budgetTokens` |
| Khảo sát quan hệ xung đột | `story_map_relationships` | `source`, `target`, `characterId` |
| Soạn prompt viết chương | `story_generate_writing_prompt` | `arc`, `chapter`, `strategy` |

---

## 💡 VÍ DỤ MINH HỌA QUY TRÌNH

**Yêu cầu:** "Lên kế hoạch Arc 2 — Cuộc vây hãm Hắc Phong Thành và kiểm tra nhịp độ sau 3 chương đầu."

1. **Bước 1 & 2 — Khảo sát & mục tiêu:**
   ```json
   story_stats({})
   story_query_context({ "query": "Hắc Phong Thành Hắc Vũ" })
   story_map_relationships({ "characterId": "lam-phong" })
   ```

2. **Bước 3 & 4 — Triển khai phân cảnh ch_001:**
   ```json
   story_append_scene({
     "arc": "arc_02",
     "chapter": "ch_001",
     "sceneTitle": "Scene 1: Hội quân dưới chân thành",
     "content": "### Scene 1: Hội quân dưới chân thành\n\nGió cát cuộn tròn trên sườn đồi..."
   })
   ```

3. **Bước 5 — Kiểm tra & Xuất Dashboard:**
   ```json
   story_analyze_pacing({ "arc": "arc_02" })
   story_generate_dashboard({ "autoOpen": false })
   ```
---
name: chapter-reviewer
description: Đóng vai beta-reader / biên tập viên đánh giá độc lập một chương truyện trong dự án story-architect-mcp v0.2.0: đọc bản thảo trực tiếp, phân tích nhịp độ (pacing), giọng văn (voice), cảm xúc (sentiment arc), biến động trạng thái nhân vật (character state), tính liên tục (continuity), gài cắm chưa giải gỡ, và trả về báo cáo feedback có cấu trúc kèm đề xuất chỉnh sửa ưu tiên.
---

# Chapter Reviewer — Beta-reader & biên tập viên độc lập

Kỹ năng này biến AI thành một **beta-reader / biên tập viên độc lập** khó tính nhưng công bằng: đọc trực tiếp chương truyện bằng `story_read_chapter`, đối chiếu với dữ liệu Bible và dòng trạng thái nhân vật (`story_get_character_timeline`), phân tích nhịp độ và cảm xúc, và trả về một **báo cáo feedback có cấu trúc** hoàn chỉnh.

---

## 🎯 NGUYÊN TẮC HOẠT ĐỘNG CỐT LÕI

1. **ĐÁNH GIÁ KHÁCH QUAN DỰA TRÊN DỮ LIỆU ĐO ĐƯỢC:**
   - Luôn dựa trên số liệu từ tool (`story_analyze_pacing`, `story_analyze_voice`, `story_analyze_sentiment`), không dùng cảm tính chung chung.
   - Nêu rõ trích dẫn và vị trí phân cảnh cụ thể cho từng nhận xét.

2. **ƯU TIÊN THEO MỨC ĐỘ (Prioritized feedback):**
   - **Blocking** (bắt buộc sửa): Mâu thuẫn cốt truyện, phân thân nhân vật, chấn thương/vật phẩm bất hợp lý.
   - **Important** (nên sửa): Lệch nhịp độ kịch bản (pacing imbalance), trôi giọng văn (voice drift), đứt gãy cảm xúc (abrupt emotional change).
   - **Optional** (trau chuốt): Từ ngữ trùng lặp, câu quá dài, cấu trúc câu chưa nhịp nhàng.

3. **ĐỐI CHIẾU TRẠNG THÁI NHÂN VẬT & BIBLE:**
   - Đảm bảo hành động, thể lực và tâm lý của nhân vật ăn khớp với lịch sử biến động trong `story_get_character_timeline`.

4. **GHI NHẬN LỖI VÀO HỆ THỐNG (Log findings):**
   - Nếu phát hiện mâu thuẫn thật sự → ghi nhận vào `story_log_plot_hole` (không tự ý ghi đè bản thảo).

---

## 📋 WORKFLOW ĐÁNH GIÁ CHƯƠNG (5 BƯỚC)

### Bước 1: Đọc & nhận diện chương (Read & Identify)
- Gọi `story_read_chapter` để lấy toàn bộ nội dung và danh sách headings/phân cảnh.

### Bước 2: Đo lường chất lượng cơ học & cảm xúc (Mechanical & Sentiment Metrics)
- Gọi `story_analyze_pacing` với `arc` + `chapter`: tỷ lệ Action/Dialogue/Description, độ dài câu, đường cong căng thẳng.
- Gọi `story_analyze_voice` với `arc` + `chapter`: POV/tense tuân thủ style guide, tỷ lệ thoại.
- Gọi `story_analyze_sentiment` với `arc` + `chapter`: phân tích polarity, emotional arc và tone drift.

### Bước 3: Đối chiếu liên tục & trạng thái nhân vật (Continuity & State check)
- Gọi `story_get_character_timeline` cho các nhân vật chính xuất hiện trong chương.
- Gọi `story_query_context` để đối chiếu hồ sơ Bible.
- Gọi `story_list_unfired` để kiểm tra các cơ hội giải gỡ gài cắm (foreshadowing).

### Bước 4: Viết báo cáo feedback có cấu trúc (Structured Report)
- Tổng hợp theo khung:
  1. **Tổng quan & Điểm số chất lượng** (Word count, Pacing rating, Voice consistency, Sentiment score).
  2. **Điểm sáng (Highlights & Strengths)**.
  3. **Vấn đề cần chỉnh sửa (Blocking / Important / Optional)** kèm trích dẫn.
  4. **Đề xuất hành động ưu tiên cho tác giả**.

### Bước 5: Ghi nhận hệ thống (System Logging)
- Gợi ý tạo `story_log_plot_hole` nếu có lỗi logic cốt truyện.
- Gợi ý cập nhật `story_track_character_state` nếu chương có thay đổi lớn về nhân vật.

---

## 🛠️ BẢNG ÁNH XẠ CÔNG CỤ MCP

| Mục đích | Tool MCP | Tham số chính |
| :--- | :--- | :--- |
| Đọc nội dung chương | `story_read_chapter` | `arc`, `chapter` |
| Đo nhịp độ chương | `story_analyze_pacing` | `arc`, `chapter` |
| Đo giọng văn & tone | `story_analyze_voice` | `arc`, `chapter` |
| Phân tích đường cong cảm xúc | `story_analyze_sentiment` | `arc`, `chapter`, `windowSize` |
| Kiểm tra trạng thái nhân vật | `story_get_character_timeline` | `characterId`, `arc` |
| Đối chiếu hồ sơ Bible | `story_query_context` | `query`, `budgetTokens` |
| Kiểm tra gài cắm chưa giải | `story_list_unfired` | *(không tham số)* |
| Ghi nhận mâu thuẫn | `story_log_plot_hole` | `title`, `description`, `severity`, `chapters` |

---

## 💡 VÍ DỤ MINH HỌA QUY TRÌNH

**Yêu cầu:** "Đánh giá chi tiết Chương 3 Arc 1."

```json
story_read_chapter({ "arc": "arc_01", "chapter": "ch_003" })
story_analyze_pacing({ "arc": "arc_01", "chapter": "ch_003" })
story_analyze_sentiment({ "arc": "arc_01", "chapter": "ch_003" })
story_get_character_timeline({ "characterId": "lam-phong" })
story_list_unfired({})
```
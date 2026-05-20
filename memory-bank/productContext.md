# Product Context

## Vấn đề người chơi gặp
- Phải bấm Accept thủ công mỗi lần tìm trận, dễ miss khi đang Alt-Tab
- Khi cần counter pick phải Alt-Tab sang web (op.gg, u.gg, mobalytics) → mất thời gian, đôi khi bị tab phụ chiếm focus
- Build và rune thay đổi theo patch nhưng không phải ai cũng cập nhật, gõ rune thủ công lâu
- Muốn xem winrate/lịch sử thì mở web, đăng nhập, search → nhiều bước

## Helper này giải quyết
- 1 app desktop chạy nền, kết nối LCU, làm hết các việc trên ở 1 chỗ
- Không cần Alt-Tab khi đang champion select: thông tin counter và build hiện trong app
- Auto-accept giảm rủi ro mất trận do delay
- Build importer: 1 click, item set + rune set vào client xong

## User Flow chính
1. Mở LoL client → mở lol-helper. App tự detect và hiển thị "Đã kết nối, summoner: X"
2. Bật Auto-Accept (toggle) → từ giờ tìm trận sẽ tự accept
3. Vào champion select → app tự nhảy sang tab Champion Picker, hiển thị counter cho lane đang chọn
4. Chọn build mong muốn → bấm Import → item set và rune đã sẵn trong client
5. Sau trận → tab Match History tự refresh

## UX Goals
- **Im lặng khi không cần**: app chỉ "lên tiếng" khi user cần (ready-check, post-game). Không spam notification.
- **Trạng thái rõ ràng**: luôn thấy được "Có kết nối LCU không?" và "Auto-accept đang bật/tắt?"
- **Phản hồi tức thì**: mọi thao tác trong UI phải có feedback dưới 200ms (loading state, toast).
- **An toàn là số một**: hiển thị disclaimer ToS lần đầu chạy, không làm gì có thể khiến user bị ban (no auto pick/ban ở v1).
- **Đẹp vừa đủ**: dark theme, gọn gàng, không cố làm "gaming RGB". Để user nhìn lâu không mỏi.

## Tone
- Tiếng Việt thân thiện, không quá teen. Có English fallback cho text kỹ thuật.
- Tránh từ ngữ tiêu cực kiểu "hack", "cheat". Dùng "trợ lý", "công cụ".
# Project Brief: lol-helper

## Overview
lol-helper là một desktop app all-in-one hỗ trợ người chơi League of Legends, chạy song song với LoL client trên máy người dùng. App tích hợp nhiều tiện ích thường ngày để tiết kiệm thời gian và đưa ra quyết định pick/build tốt hơn.

## Core Goals
- Tự động hoá các thao tác lặp đi lặp lại trong client (accept trận)
- Cung cấp thông tin counter / build / rune ngay trong app, không cần Alt-Tab
- Cho phép import build và rune vào client với 1 click
- Tra cứu match history và thống kê người chơi

## MVP Modules
1. **Auto-Accept** — tự động bấm Accept khi tìm được trận
2. **In-Game Overlay (CORE)** — transparent always-on-top BrowserWindow hiển thị: enemy spell tracker, counter tips, build suggestion, minimap/jungle timers. Data từ Riot Live Client API (`127.0.0.1:2999`). Không inject vào game process.
3. **Champion Picker** — gợi ý counter / pick theo lane và tướng địch (Data Dragon + nguồn ngoài)
4. **Match History** — xem lịch sử đấu, win rate theo tướng (Riot Web API)
5. **Build/Rune Importer** — chọn build từ list rồi push vào client qua LCU

## Out of Scope (v1)
- In-game overlay **đọc memory** hoặc inject DLL vào game process (rủi ro ToS). Overlay dùng transparent window bên ngoài thì OK.
- Auto pick/ban tướng (vùng xám ToS, để sau khi MVP ổn)
- Mobile / web version
- Đa ngôn ngữ (chỉ tiếng Việt + English ở v1)

## Target Users
- Người chơi LoL từ tầm trung trở lên muốn tối ưu thời gian client
- Người hay đổi tướng/role và cần build nhanh

## Success Criteria
- Cài đặt và chạy được trên Windows + macOS
- Auto-accept hoạt động ổn định trong 10 trận liên tiếp
- Import build vào client thành công không lỗi
- Match history load dưới 3 giây cho 20 trận gần nhất

## Status
Đang khởi tạo. Stack đã chốt: Electron + Vite + React + TypeScript. Chuẩn bị bootstrap repo.
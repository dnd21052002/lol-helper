# lol-helper

Desktop helper all-in-one cho League of Legends. Chạy song song với LoL client để tự động accept trận, gợi ý counter pick, import build/rune và xem match history.

## Trạng thái

Đang ở Phase 0 - Bootstrap. Chưa có tính năng nào hoàn thiện.

## Tính năng dự kiến (MVP)

- **Auto-Accept**: tự bấm Accept khi tìm được trận
- **Champion Picker**: gợi ý counter / build theo lane và tướng địch
- **Match History**: xem lịch sử đấu, win rate theo tướng
- **Build/Rune Importer**: import item set + rune page vào client với 1 click

## Stack

- Electron 30 + electron-vite
- React 18 + TypeScript
- Zustand (state)
- league-connect (LCU API)
- axios (Riot Web API)
- electron-builder (đóng gói)

## Yêu cầu

- Node.js >= 18 LTS
- npm hoặc pnpm
- LoL client (để test các module liên quan LCU; trên macOS dev sẽ stub)

## Cài đặt

```bash
npm install
```

## Phát triển

```bash
npm run dev
```

## Build

```bash
npm run build       # type-check + bundle
npm run dist        # tạo installer cho OS hiện tại
```

## Cấu trúc thư mục

```
electron/
  main/         # Electron main process (LCU, Riot API, IPC)
  preload/      # contextBridge expose window.api
src/            # Renderer React app
memory-bank/    # Tài liệu thiết kế nội bộ
```

## Disclaimer

Công cụ này dùng LCU API công khai của Riot, không inject vào tiến trình game cũng không đọc bộ nhớ. Mặc dù vậy, việc dùng tool bên thứ ba vẫn có thể vi phạm Terms of Service của Riot Games. Bạn tự chịu trách nhiệm khi sử dụng. Project này không liên kết với Riot Games.

## License

MIT (sẽ thêm file LICENSE sau).
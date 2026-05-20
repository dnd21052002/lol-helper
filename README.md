# lol-helper

Desktop helper all-in-one cho League of Legends. Chạy song song với LoL client để tự động accept trận, xem match history, gợi ý counter pick và import build/rune.

## Trạng thái

**Phase 1 - Core Features** đang hoàn thiện.

### Tính năng đã hoạt động

| Tính năng | Backend | UI | Ghi chú |
|-----------|---------|-----|---------|
| Auto-Accept | ✅ | ✅ | Tự bấm Accept khi tìm được trận |
| Match History | ✅ | ⚠️ | Dữ liệu đúng, UI đang cần chỉnh sửa |

### Tính năng đang phát triển

- **Champion Picker**: gợi ý counter / build theo lane và tướng địch
- **Build/Rune Importer**: import item set + rune page vào client với 1 click
- **Overlay**: hiển thị thông tin realtime trong game

## Stack

- Electron 32 + electron-vite
- React 18 + TypeScript
- Zustand (state management)
- WebSocket (LCU API)
- axios (Riot Web API)
- electron-builder (đóng gói)

## Yêu cầu

- Node.js >= 18 LTS
- npm hoặc pnpm
- LoL client đang chạy (để kết nối LCU API)

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
npm run dist:mac    # build cho macOS
npm run dist:win    # build cho Windows
```

## Cấu trúc thư mục

```
electron/
  main/           # Electron main process
    lcu/          # LCU client, lockfile, live client
    modules/      # Auto-accept, match history, overlay
  preload/        # contextBridge expose window.api
src/              # Renderer React app
  app/            # App root component
  components/     # Shared components (Sidebar, StatusBar)
  features/       # Feature modules (autoAccept, matchHistory, ...)
  styles/         # Global CSS
shared/           # Shared types (IPC channels)
scripts/          # Dev/test scripts
```

## Disclaimer

Công cụ này dùng LCU API công khai của Riot, không inject vào tiến trình game cũng không đọc bộ nhớ. Mặc dù vậy, việc dùng tool bên thứ ba vẫn có thể vi phạm Terms of Service của Riot Games. Bạn tự chịu trách nhiệm khi sử dụng. Project này không liên kết với Riot Games.

## License

MIT

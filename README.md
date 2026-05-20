# lol-helper

Desktop helper all-in-one cho League of Legends. Chạy song song với LoL client để tự động accept trận, xem match history, gợi ý counter pick và import build/rune.

## Trạng thái

**Auto Ranked hoàn thành** — Full automation từ tạo lobby đến lock champion + apply runes.

### Tính năng đã hoạt động

| Tính năng | Backend | UI | Ghi chú |
|-----------|---------|-----|---------|
| Auto Ranked | ✅ | ✅ | Tạo lobby, chọn role, queue, ban, pick, lock, apply runes — full automation |
| Auto-Accept | ✅ | ✅ | Tự bấm Accept khi tìm được trận, configurable delay |
| Match History | ✅ | ✅ | 20 trận gần nhất, filter theo champion/queue, champion name từ DDragon |
| Champion Picker | ✅ | ✅ | Grid champion, role filter, detail panel (stats/difficulty/lore), counter badge |
| LCU Connection | ✅ | ✅ | Tự viết, cross-platform, auto-reconnect, status bar realtime |

### Tính năng đang phát triển

- **Build/Rune Importer** (Phase 5): import item set + rune page vào client với 1 click (standalone)
- **In-Game Overlay** (Phase 2): spell tracker, counter tips, build suggestion realtime
- **Persist settings**: lưu cấu hình auto-accept + auto-ranked sang disk

## Stack

- Electron 32 + electron-vite
- React 18 + TypeScript
- Zustand (state management)
- WebSocket (LCU WAMP protocol)
- axios (HTTP requests)
- CSS thuần (no framework)
- electron-builder (đóng gói)

## Yêu cầu

- Node.js >= 18 LTS
- npm
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
npm run dist:mac    # build cho macOS (.dmg)
npm run dist:win    # build cho Windows (.exe)
```

## Cấu trúc thư mục

```
electron/
  main/              # Electron main process
    lcu/             # LCU client tự viết (lockfile, HTTPS, WebSocket WAMP)
    modules/         # Feature modules (autoAccept, championPicker, matchHistory, overlay)
    data/            # Static data (counter data cho main process)
  preload/           # contextBridge — expose window.api
src/                 # Renderer (React app)
  app/               # App root component
  components/        # Shared components (Sidebar, LcuStatusBar)
  features/          # Feature pages (autoAccept, championPicker, matchHistory, overlay, buildImporter)
  styles/            # Global CSS
shared/              # Shared types & data (IPC channels, counter data)
scripts/             # Dev/test scripts (smoke-lcu)
```

## Kiến trúc

- **Main process** xử lý toàn bộ LCU/Riot API calls. Renderer chỉ giao tiếp qua IPC.
- **LCU client tự viết** — không dùng `league-connect`. Scan process, đọc lockfile, HTTPS với self-signed cert, WebSocket WAMP auto-reconnect.
- **HashRouter** cho renderer (Electron load `file://`).
- **Counter data** ở `shared/` folder — pure data, importable từ cả main và renderer.

## Disclaimer

Công cụ này dùng LCU API công khai của Riot, không inject vào tiến trình game cũng không đọc bộ nhớ. Mặc dù vậy, việc dùng tool bên thứ ba vẫn có thể vi phạm Terms of Service của Riot Games. Bạn tự chịu trách nhiệm khi sử dụng. Project này không liên kết với Riot Games.

## License

MIT

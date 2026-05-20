# Active Context

## Current Focus
Sidebar UI + 4 routes đã xong. Bước tiếp theo là `npm run dev` smoke test UI, sau đó cleanup Phase 1 (persist settings + log UI).

## Recent Changes
- Bootstrap Electron + Vite + React + TS, sidebar 4 module + trang Auto-Accept.
- **Sidebar + HashRouter**: thêm `Sidebar` component (NavLink 4 items), `HashRouter` với nested routes, 3 placeholder pages (Champion Picker, Match History, Build Importer). Layout: header → status bar → sidebar | content.
- **Bỏ `league-connect`** (chỉ hỗ trợ Windows / scan `LeagueClientUx.exe`) → tự viết LCU client thuần Node:
  - `electron/main/lcu/lockfile.ts`: discover credentials qua lockfile mặc định theo OS, fallback `ps -A` (mac/linux) hoặc `wmic` (Windows). Trên macOS lockfile thật ở `/Applications/League of Legends.app/Contents/LoL/lockfile`.
  - `electron/main/lcu/client.ts`: dùng `https` Node + `ws` (WAMP subprotocol) để subscribe `OnJsonApiEvent`, bỏ qua self-signed cert.
- Smoke test `scripts/smoke-lcu.mjs` chạy thật trên Mac: parse lockfile, gọi `/lol-summoner/v1/current-summoner` (lấy Butterfly#DND lv168), `/lol-gameflow/v1/gameflow-phase` = `None`, WS open OK.
- `npm run typecheck` và `npm run build` đều xanh.

## Next Steps (theo thứ tự)
1. `npm run dev` xác nhận UI hiển thị status `connected` + summoner name.
2. Test thực tế: bật Auto-Accept, vào Quick Play để xem có auto-accept ReadyCheck không.
3. Sau đó mới sang module #2 (Champion Picker / Counter suggestions).

## Active Decisions
- Bỏ qua in-game overlay và auto pick/ban ở v1 vì rủi ro ToS.
- Dùng CSS thuần thay vì Tailwind ở v1, có thể migrate sau.
- HashRouter (không phải BrowserRouter) vì Electron load file://.
- Tất cả LCU/Riot calls ở main process; renderer chỉ gọi qua IPC.
- LCU client tự viết, không dùng `league-connect` → kiểm soát được cross-platform discovery và dễ debug.

## Open Questions
- App icon và branding: tạm dùng placeholder, sau làm sau.
- Có cần auto-update (electron-updater) ngay v1 không? → Để post-MVP.
- Champion Picker lấy data counter từ đâu? → Tạm thời dùng Data Dragon cho danh sách tướng + một file JSON tĩnh do mình curate; sau scrape từ u.gg/op.gg (cần kiểm tra ToS của họ).
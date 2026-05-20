# Progress

## What Works
- Memory bank scaffolded với scope chi tiết
- Repo skeleton hoàn chỉnh: package.json, tsconfig, electron.vite.config.ts
- Electron main process: window bootstrap, IPC handlers, secure preload
- **LCU client tự viết** (`electron/main/lcu/lockfile.ts` + `client.ts`), thay cho `league-connect`:
  - Discover credentials qua lockfile mặc định theo OS + fallback `ps`/`wmic`
  - HTTPS request bỏ qua self-signed cert
  - WebSocket WAMP, subscribe `OnJsonApiEvent`, auto-reconnect
- Auto-Accept module: subscribe `/lol-matchmaking/v1/ready-check` và POST `/lol-matchmaking/v1/ready-check/accept`
- React renderer với LcuStatusBar + AutoAcceptPanel
- `npm install` + `npm run build` pass cả 3 stage (main / preload / renderer)
- `npm run typecheck` pass
- **Smoke test trên Mac thật** (`scripts/smoke-lcu.mjs`) chạy OK: lockfile parsed, summoner fetched (Butterfly#DND lv168), gameflow phase = `None`, WS open

## What's In Progress
- Persist settings auto-accept và bổ sung log UI (Phase 1 cleanup)

## What's Left (MVP roadmap)
### Phase 0 - Bootstrap
- [x] Memory bank
- [x] Repo skeleton (package.json, tsconfig, electron.vite.config.ts, main entry)
- [x] LCU connection wrapper (cross-platform, không phụ thuộc league-connect)
- [x] `npm run build` pass
- [x] LCU smoke test trên macOS thật
- [x] Sidebar UI + 4 routes placeholder (HashRouter + Sidebar + 4 pages)
- [ ] `npm run dev` smoke test với UI

### Phase 1 - Auto-Accept (MVP1)
- [x] Detect ready-check qua WebSocket LCU
- [x] POST accept tự động (có configurable delay)
- [x] Toggle bật/tắt + delay setting (in-memory, chưa persist)
- [x] Stats counter (số trận đã accept, lần cuối)
- [x] Test thực tế với LoL client trên macOS — đã auto-accept thành công
- [ ] Persist settings sang disk (electron-store hoặc tự ghi JSON)
- [ ] Hiển thị log chi tiết các lần accept (hiện chỉ có counter)

### Phase 2 - In-Game Overlay (CORE)
- [x] Initialize overlay module structure (transparent BrowserWindow + Live Client API)
- [x] Live Client API client (`electron/main/lcu/liveClient.ts`)
- [x] Overlay BrowserWindow manager (`electron/main/modules/overlay.ts`)
- [x] Overlay renderer page placeholder with 4 panels layout
- [ ] Enemy spell tracker (summoner spell cooldown timers)
- [ ] Counter tips panel (show tips based on matchup)
- [ ] Build suggestion panel (real-time item path)
- [ ] Minimap info panel (jungle timers, objective countdown)
- [ ] Overlay toggle hotkey (global shortcut)
- [ ] Overlay position/size persistence

### Phase 3 - Match History
- [x] Lấy summoner hiện tại từ LCU
- [x] Gọi LCU `/lol-match-history/v1/products/lol/{puuid}/matches` cho 20 trận gần nhất
- [x] UI list trận + detail panel (split view)
- [x] Filter theo champion (client-side text) / queue (server-side param)
- [x] Champion name mapping từ Data Dragon (auto-fetch latest version)
- [x] IPC contract + preload binding + typecheck pass

### Phase 4 - Champion Picker
- [ ] Cache Data Dragon (champions, items, runes) theo version
- [ ] UI grid champion + ô nhập tướng địch
- [ ] Hiển thị counter (data tĩnh ban đầu, scrape sau)
- [ ] Sync với champion select hiện tại (tự nhảy tab)

### Phase 5 - Build/Rune Importer
- [ ] Định nghĩa format build JSON nội bộ
- [ ] UI list build theo champion
- [ ] PUT item set vào LCU `/lol-item-sets/v1/item-sets/{summonerId}/sets`
- [ ] POST rune page vào LCU `/lol-perks/v1/pages`

### Phase 6 - Polish
- [ ] Settings page (autostart, theme, language)
- [ ] Disclaimer ToS lần đầu chạy
- [ ] Auto-update (electron-updater)
- [ ] Installer Windows (.exe) + macOS (.dmg)

## Current Status Summary
- [x] Memory bank
- [x] Repo skeleton + build pass
- [x] Cross-platform LCU connection (verified trên Mac)
- [x] Phase 1 core (auto-accept) hoạt động về mặt code, đã test trên LoL thật
- [ ] Phase 1 done (cần test + persist settings + log UI)
- [ ] Phase 2 done
- [x] Phase 3 done
- [ ] Phase 4 done
- [ ] Phase 5 done

## Known Issues
- Settings auto-accept hiện chỉ giữ in-memory, mất khi tắt app. Cần persist ở Phase 1 cleanup.
- Riot Web API key: chưa apply, sẽ làm khi vào Phase 2.
- 21 npm vulnerabilities từ transitive deps của electron-builder (4 low / 3 mod / 14 high). Phần lớn nằm ở build-time, chưa fix vội.

## Resolved Issues
- ~~Dev trên macOS: league-connect không tìm được LoL client process~~ → Đã thay bằng LCU client tự viết, scan đúng process `LeagueClient` trên macOS và đọc lockfile ở `/Applications/League of Legends.app/Contents/LoL/lockfile`.
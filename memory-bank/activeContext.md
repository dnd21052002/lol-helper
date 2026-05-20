# Active Context

## Current Focus
Auto Ranked feature hoàn thành. Full automation flow từ tạo lobby → chọn role → queue → ban → pick → lock → apply runes.

## Recent Changes
- **Auto Ranked** (new feature):
  - `electron/main/modules/autoRanked.ts` — AutoRankedModule class (~450 lines): lobby creation, queue start, ban/pick automation with timing delays and retry logic, rune application
  - `shared/ipc.ts` — Added AutoRankedSettings, AutoRankedState, RunePageConfig interfaces and IpcChannels.autoRanked entries
  - `electron/preload/index.ts` — Added autoRanked API bindings
  - `electron/main/index.ts` — Added autoRanked module import, IPC handlers, broadcast wiring, lifecycle
  - `src/features/autoRanked/AutoRankedPage.tsx` — React UI with searchable champion select, role selectors, enable toggle, start queue button, live state display
  - `src/components/Sidebar.tsx` — Added Auto Ranked nav entry (🏆)
  - `src/main.tsx` — Added route `/auto-ranked`
  - `src/styles/global.css` — ~200 lines CSS for auto-ranked page and champion select component
  - Bug fix: ban phase timing — added 800ms delay before ban execution + retry logic khi ban fail do chưa đến phase

## Next Steps (theo thứ tự ưu tiên)
1. Test Auto Ranked trên LoL client thật (Windows)
2. Phase 1 cleanup: persist settings (auto-accept + auto-ranked) sang disk
3. Mở rộng counter data (thêm nhiều champion hơn)
4. Phase 5: Build/Rune Importer (standalone, ngoài auto-ranked flow)
5. Phase 2: In-Game Overlay

## Active Decisions
- Auto Ranked dùng polling LCU champ-select session (500ms interval) thay vì WebSocket event vì cần state machine phức tạp.
- Ban delay 800ms + retry để handle race condition khi vào champ select.
- Champion select dropdown reuse DDragon data từ championPicker module.
- Dùng CSS thuần thay vì Tailwind ở v1.
- HashRouter cho Electron file:// protocol.
- Tất cả LCU/Riot calls ở main process; renderer chỉ gọi qua IPC.
- LCU client tự viết, không dùng `league-connect`.

## Open Questions
- Auto Ranked cần test thực tế trên Windows với LoL client.
- Rune page apply: cần xác nhận flow PUT vs DELETE+POST khi đã có page tồn tại.
- Counter data chỉ cover 18 champs. Cần scrape từ u.gg/op.gg hoặc dùng community API?
- App icon và branding: tạm dùng placeholder.

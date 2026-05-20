# Active Context

## Current Focus
Champion Picker đã được nâng cấp xong. Tiếp theo có thể: mở rộng counter data, hoặc chuyển sang Phase 5 (Build/Rune Importer), hoặc cleanup Phase 1 (persist settings).

## Recent Changes
- **Champion Picker enhanced** (Phase 4.5):
  - Thêm role filter tabs (All/Fighter/Tank/Mage/Assassin/Marksman/Support)
  - Champion detail panel khi click: avatar 64px, title italic, tag chips, stat bars (ATK/DEF/MAG với màu), difficulty dots (10 chấm), lore blurb
  - Counter badge ⚔️ trên champion tiles có counter data
  - `ChampionInfo` interface mở rộng: thêm `info` (attack/defense/magic/difficulty) và `blurb` từ DDragon
  - `shared/counterData.ts` — move counter data sang shared folder để renderer import sạch
  - CSS mới: `.role-tabs`, `.champion-detail-panel`, `.stat-bar-*`, `.difficulty-dots`, `.tag-chip`, `.counter-badge`
  - Build pass clean (tsc + electron-vite build cả 3 bundles)

## Next Steps (theo thứ tự ưu tiên)
1. Mở rộng counter data (thêm nhiều champion hơn) hoặc tìm cách scrape từ u.gg
2. Phase 1 cleanup: persist auto-accept settings + log UI
3. Phase 5: Build/Rune Importer
4. Phase 2: In-Game Overlay (spell tracker, counter tips live)

## Active Decisions
- Bỏ qua in-game overlay và auto pick/ban ở v1 vì rủi ro ToS.
- Dùng CSS thuần thay vì Tailwind ở v1, có thể migrate sau.
- HashRouter (không phải BrowserRouter) vì Electron load file://.
- Tất cả LCU/Riot calls ở main process; renderer chỉ gọi qua IPC.
- LCU client tự viết, không dùng `league-connect`.
- Counter data ở `shared/` folder — pure data, importable từ cả main và renderer bundles.
- `ChampionInfo` giờ chứa đủ data để hiển thị rich detail mà không cần thêm API call.

## Open Questions
- Counter data chỉ cover 18 champs. Cần scrape từ u.gg/op.gg hoặc dùng community API?
- App icon và branding: tạm dùng placeholder.
- Có cần auto-update (electron-updater) ngay v1 không? → Để post-MVP.

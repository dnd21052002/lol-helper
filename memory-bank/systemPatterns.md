# System Patterns

## High-level Architecture
```
┌──────────────────────────────────────────────────────────────┐
│ Renderer (React, sandboxed)                                  │
│  - UI cho 4 module                                           │
│  - Gọi qua window.api.* (contextBridge)                      │
└──────────────────┬───────────────────────────────────────────┘
                   │ IPC (invoke / on)
┌──────────────────▼───────────────────────────────────────────┐
│ Preload                                                       │
│  - Expose `window.api` an toàn (typed)                       │
└──────────────────┬───────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────┐
│ Main process (Node.js)                                        │
│  - LCU client (league-connect)                               │
│  - WebSocket listener cho events                             │
│  - Modules: autoAccept, matchHistory, buildImporter          │
│  - Riot Web API client (axios)                               │
│  - Data Dragon cache                                         │
└──────────────────┬───────────────────────────────────────────┘
                   │
       ┌───────────┴────────────┐
       ▼                        ▼
  LoL Client (LCU)         Riot Web API / Data Dragon
  (localhost HTTPS)        (internet)
```

## Key Decisions
- **Tách trách nhiệm**: tất cả I/O (LCU, network, fs) ở main process. Renderer chỉ render và gọi IPC.
- **contextIsolation = true, nodeIntegration = false**: bảo mật. Mọi API expose qua preload với type chặt.
- **IPC channel naming**: `domain:action` ví dụ `lcu:status`, `autoAccept:toggle`, `matchHistory:fetch`.
- **LCU connection là singleton** trong main, share state qua event emitter; khi client off thì broadcast `lcu:disconnected`.
- **Module pattern**: mỗi feature là một module có `start()`, `stop()`, expose IPC handlers riêng. Dễ bật/tắt độc lập.
- **Renderer state**: Zustand store mirror trạng thái LCU và settings; sync qua IPC events.

## Patterns sẽ dùng
- **Polling + WebSocket**: poll lockfile mỗi 3s khi chưa connect, sau đó dùng WebSocket của LCU cho events realtime.
- **Event-driven auto-accept**: subscribe `/lol-matchmaking/v1/ready-check`, khi state = `InProgress` thì POST accept.
- **Cache version-aware cho Data Dragon**: lưu vào `app.getPath('userData')/ddragon/<version>/`.
- **Settings persistence**: JSON file ở `userData/settings.json`, schema versioned.
- **Logging**: `electron-log` với file rotate, level `info` ở prod, `debug` ở dev.

## Error Handling
- LCU disconnect → state về `disconnected`, UI hiển thị banner "Đang chờ LoL client...", auto-retry.
- Riot API 429 → exponential backoff, hiển thị toast cho user.
- IPC handler luôn return `{ ok: true, data }` hoặc `{ ok: false, error }` để renderer xử lý đồng nhất.

## Component Relationships (renderer)
- `App` → `Sidebar` + `<Outlet />`
- Mỗi route component đọc store + gọi `window.api`
- `lcuStore` chứa `connectionState`, `summoner`, `gameflowPhase`
- Provider tự subscribe IPC events khi App mount, unsubscribe khi unmount
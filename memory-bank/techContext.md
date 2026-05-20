# Tech Context

## Stack
- **Runtime/shell**: Electron 30+
- **Bundler**: electron-vite (Vite 5 cho cả main, preload, renderer)
- **UI**: React 18 + TypeScript
- **Styling**: CSS Modules + một file design tokens (chưa dùng Tailwind ở v1 để giữ bundle gọn)
- **Routing renderer**: React Router (hashRouter cho Electron)
- **State**: Zustand (đơn giản, đủ cho MVP)
- **LCU client**: `league-connect` (đọc lockfile, WebSocket events, fetch HTTPS)
- **Riot Web API**: gọi qua axios trong main process (giữ API key tách khỏi renderer)
- **Data Dragon**: fetch JSON tĩnh, cache local theo version
- **Logger**: `electron-log`
- **Packager**: `electron-builder`

## Dependencies dự kiến
```
dependencies:
  - electron-log
  - league-connect
  - axios
  - react, react-dom, react-router-dom
  - zustand

devDependencies:
  - electron
  - electron-vite
  - electron-builder
  - vite
  - typescript
  - @types/react, @types/react-dom, @types/node
  - @vitejs/plugin-react
```

## Cấu trúc thư mục
```
lol-helper/
├── memory-bank/              # tài liệu nội bộ
├── electron/
│   ├── main/
│   │   ├── index.ts          # entry main process
│   │   ├── ipc.ts            # đăng ký IPC handlers
│   │   ├── lcu/
│   │   │   ├── client.ts     # kết nối LCU
│   │   │   └── events.ts     # subscribe WebSocket events
│   │   ├── modules/
│   │   │   ├── autoAccept.ts
│   │   │   ├── matchHistory.ts
│   │   │   └── buildImporter.ts
│   │   └── riot/
│   │       └── api.ts        # Riot Web API client
│   └── preload/
│       └── index.ts          # expose contextBridge API
├── src/                      # renderer (React)
│   ├── main.tsx
│   ├── App.tsx
│   ├── routes/
│   │   ├── AutoAccept.tsx
│   │   ├── ChampionPicker.tsx
│   │   ├── MatchHistory.tsx
│   │   └── BuildImporter.tsx
│   ├── components/
│   │   └── Sidebar.tsx
│   ├── store/
│   │   └── lcuStore.ts
│   ├── styles/
│   │   └── global.css
│   └── types/
│       └── ipc.d.ts
├── resources/                # icon, splash
├── electron.vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── package.json
├── .gitignore
└── README.md
```

## Development Setup
- **OS hỗ trợ**: macOS (dev hiện tại), Windows (target chính cho người dùng LoL VN)
- **Node**: >= 18 LTS
- **Lệnh dev**: `npm run dev` (electron-vite dev với HMR)
- **Build**: `npm run build` rồi `npm run dist` để tạo installer

## Technical Constraints
- LCU API yêu cầu LoL client đang chạy. App phải xử lý gracefully khi client offline (poll lại mỗi 3-5s).
- LCU dùng HTTPS với self-signed cert → bypass cert verification trong `client.ts` (`rejectUnauthorized: false`).
- Riot Web API key dev chỉ tồn tại 24h, rate limit thấp. Production cần xin Personal/Production key.
- macOS không có LoL client chính thức cho Apple Silicon native → một số module (auto-accept, build importer) chỉ test được trên Windows hoặc qua Boot Camp/Parallels. Dev trên macOS thì stub LCU.

## Open Risks
- ToS Riot: ngay cả auto-accept cũng có rủi ro nhỏ. Sẽ có disclaimer trong README và UI.
- LCU schema thay đổi giữa các patch. Cần test lại sau mỗi major patch.
# Online Form Collaborate

A minimal real-time collaborative grid using Node.js + SQLite + React. Supports nickname join (optional password), sheet creation, deletion, and real-time cell updates with locks via WebSocket.

UI: React with Material UI (MUI) components.

Note: If you intended Element UI, that library targets Vue. This project uses React with MUI. We can migrate to an Element-style React library on request.

## Run the app

From the repository root:

1) Install dependencies once in both subfolders
- server/: `npm install`
- client/: `npm install`

2) Start both server and client together
- `node start`

This starts:
- Backend API on http://localhost:4000
- Frontend on http://localhost:5173

Optional (run separately):
- server/: `npm start`
- client/: `npm run dev`

## Project structure

- `server/` Node.js Express backend with SQLite (better-sqlite3) and WebSocket
  - `src/index.js` app entry
  - `src/lib/db.js` SQLite init and schema
  - `src/routes/auth.js` nickname join + session auth
  - `src/routes/sheets.js` sheet CRUD, cells, locks, logs, delete
  - `src/ws.js` WebSocket broadcast for updates/locks
- `client/` React (Vite) frontend with Material UI
  - `src/App.jsx` Join -> Sheet list/create/delete -> Grid editor
  - `src/styles.css` minor custom styles
  - `vite.config.js` dev proxy to backend

## Database design

Tables:
- users(id, nickname UNIQUE, password, created_at)
- sessions(token, user_id, created_at)
- sheets(id, name, rows, cols, created_by, created_at)
- cells(sheet_id, r, c, value, updated_by, updated_at) PK(sheet_id,r,c)
- locks(sheet_id, r, c, user_id, locked_at) PK(sheet_id,r,c)
- logs(id, sheet_id, user_id, r, c, action, value, created_at)

Indexes on cells.sheet_id, locks.sheet_id, logs.sheet_id.

## API brief

Headers: `x-session-token: <token>` required for non-auth endpoints.

- POST /api/auth/join { nickname, password? } -> { token, user }
- GET  /api/auth/me -> { user }
- POST /api/sheets { name, rows?, cols? } -> { id, name, rows, cols }
- GET  /api/sheets -> { sheets: [...] }
- GET  /api/sheets/:id -> { sheet, cells, locks }
- POST /api/sheets/:id/cells { r, c, value } -> { ok, r, c, value }
- POST /api/sheets/:id/lock { r, c, lock:true|false } -> { ok }
- GET  /api/sheets/:id/logs -> { logs }
- DELETE /api/sheets/:id -> { ok } (creator only)

## Realtime

WebSocket: ws://localhost:4000/ws?token=...&sheet=<sheetId>

Messages from client:
- { type: 'update_cell', r, c, value }
- { type: 'lock', r, c }
- { type: 'unlock', r, c }

Events from server:
- { type: 'hello', user, sheet }
- { type: 'cell_updated', r, c, value, updated_by, updated_at }
- { type: 'locked', r, c, user_id, locked_at }
- { type: 'unlocked', r, c }
- { type: 'bulk_unlock', cells: [{r,c}] }

## Notes
- Passwords are stored in plain text for simplicity (demo only). For production: hash passwords and add auth hardening.
- Locking is optimistic; server prevents updates when locked by others. Locks are auto-released on disconnect.

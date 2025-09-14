import db from './lib/db.js';

const clients = new Map(); // token -> ws

export function wsInit(wss) {
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const sheetId = url.searchParams.get('sheet');
    if (!token || !sheetId) {
      ws.close(1008, 'Unauthorized');
      return;
    }
    const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!session) {
      ws.close(1008, 'Unauthorized');
      return;
    }
    const user = db.prepare('SELECT id, nickname FROM users WHERE id = ?').get(session.user_id);
    if (!user) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    ws.user = user;
    ws.sheetId = sheetId;

    const key = `${token}`;
    clients.set(key, ws);

    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === 'update_cell') {
          const { r, c, value } = data;
          const now = Date.now();
          const lock = db.prepare('SELECT * FROM locks WHERE sheet_id = ? AND r = ? AND c = ?').get(sheetId, r, c);
          if (lock && lock.user_id !== user.id) return; // ignore
          db.prepare('INSERT INTO cells (sheet_id, r, c, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)\n                    ON CONFLICT(sheet_id, r, c) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at')
            .run(sheetId, r, c, value ?? '', user.id, now);
          db.prepare('INSERT INTO logs (sheet_id, user_id, r, c, action, value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(sheetId, user.id, r, c, 'update_cell', String(value ?? ''), now);
          broadcast(sheetId, {
            type: 'cell_updated',
            r, c, value, updated_by: user.id, updated_at: now
          });
        }
        if (data.type === 'lock') {
          const { r, c } = data;
          const now = Date.now();
          const existing = db.prepare('SELECT * FROM locks WHERE sheet_id = ? AND r = ? AND c = ?').get(sheetId, r, c);
          if (existing && existing.user_id !== user.id) return; // already locked by other
          db.prepare('INSERT INTO locks (sheet_id, r, c, user_id, locked_at) VALUES (?, ?, ?, ?, ?)\n                    ON CONFLICT(sheet_id, r, c) DO UPDATE SET user_id=excluded.user_id, locked_at=excluded.locked_at')
            .run(sheetId, r, c, user.id, now);
          db.prepare('INSERT INTO logs (sheet_id, user_id, r, c, action, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(sheetId, user.id, r, c, 'lock', now);
          broadcast(sheetId, { type: 'locked', r, c, user_id: user.id, locked_at: now });
        }
        if (data.type === 'unlock') {
          const { r, c } = data;
          const existing = db.prepare('SELECT * FROM locks WHERE sheet_id = ? AND r = ? AND c = ?').get(sheetId, r, c);
          if (existing && existing.user_id !== user.id) return; // cannot unlock others
          if (existing) db.prepare('DELETE FROM locks WHERE sheet_id = ? AND r = ? AND c = ?').run(sheetId, r, c);
          db.prepare('INSERT INTO logs (sheet_id, user_id, r, c, action, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(sheetId, user.id, r, c, 'unlock', Date.now());
          broadcast(sheetId, { type: 'unlocked', r, c });
        }
      } catch (e) {
        // ignore
      }
    });

    ws.on('close', () => {
      clients.delete(key);
      // optional: release locks held by this user on this sheet
      const locks = db.prepare('SELECT r, c FROM locks WHERE sheet_id = ? AND user_id = ?').all(sheetId, user.id);
      for (const L of locks) {
        db.prepare('DELETE FROM locks WHERE sheet_id = ? AND r = ? AND c = ?').run(sheetId, L.r, L.c);
      }
      if (locks.length) {
        broadcast(sheetId, { type: 'bulk_unlock', cells: locks.map(l => ({ r: l.r, c: l.c })) });
      }
    });

    ws.send(JSON.stringify({ type: 'hello', user, sheet: sheetId }));
  });
}

function broadcast(sheetId, payload) {
  for (const ws of clients.values()) {
    if (ws.sheetId === sheetId && ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
    }
  }
}

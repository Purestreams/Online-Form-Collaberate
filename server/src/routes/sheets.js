import express from 'express';
import db from '../lib/db.js';
import { nanoid } from 'nanoid';

export const sheetsRouter = express.Router();

// Create sheet
sheetsRouter.post('/', (req, res) => {
  const { name, rows = 5, cols = 5 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = nanoid(10);
  const now = Date.now();
  db.prepare('INSERT INTO sheets (id, name, rows, cols, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, rows, cols, req.user.id, now);
  db.prepare('INSERT INTO logs (sheet_id, user_id, action, created_at) VALUES (?, ?, ?, ?)')
    .run(id, req.user.id, 'create_sheet', now);
  res.json({ id, name, rows, cols });
});

// List sheets
sheetsRouter.get('/', (_req, res) => {
  const sheets = db.prepare('SELECT id, name, rows, cols, created_at FROM sheets ORDER BY created_at DESC').all();
  res.json({ sheets });
});

// Get sheet detail (with current cells and locks)
sheetsRouter.get('/:id', (req, res) => {
  const { id } = req.params;
  const sheet = db.prepare('SELECT * FROM sheets WHERE id = ?').get(id);
  if (!sheet) return res.status(404).json({ error: 'not found' });
  const cells = db.prepare('SELECT r, c, value, updated_by, updated_at FROM cells WHERE sheet_id = ?').all(id);
  const locks = db.prepare('SELECT r, c, user_id, locked_at FROM locks WHERE sheet_id = ?').all(id);
  res.json({ sheet, cells, locks });
});

// Update a cell
sheetsRouter.post('/:id/cells', (req, res) => {
  const { id } = req.params;
  const { r, c, value } = req.body || {};
  if (r == null || c == null) return res.status(400).json({ error: 'r,c required' });
  const now = Date.now();
  const sheet = db.prepare('SELECT id, rows, cols FROM sheets WHERE id = ?').get(id);
  if (!sheet) return res.status(404).json({ error: 'not found' });
  if (r < 0 || r >= sheet.rows || c < 0 || c >= sheet.cols) {
    return res.status(400).json({ error: 'out of range' });
  }
  // optional lock enforcement: allow update if unlocked or locked by self
  const lock = db.prepare('SELECT * FROM locks WHERE sheet_id = ? AND r = ? AND c = ?').get(id, r, c);
  if (lock && lock.user_id !== req.user.id) {
    return res.status(423).json({ error: 'cell locked by other user' });
  }
  db.prepare('INSERT INTO cells (sheet_id, r, c, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)\n            ON CONFLICT(sheet_id, r, c) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at')
    .run(id, r, c, value ?? '', req.user.id, now);
  db.prepare('INSERT INTO logs (sheet_id, user_id, r, c, action, value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.user.id, r, c, 'update_cell', String(value ?? ''), now);
  res.json({ ok: true, r, c, value, updated_by: req.user.id, updated_at: now });
});

// Lock / Unlock a cell
sheetsRouter.post('/:id/lock', (req, res) => {
  const { id } = req.params;
  const { r, c, lock } = req.body || {};
  if (r == null || c == null) return res.status(400).json({ error: 'r,c required' });
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM locks WHERE sheet_id = ? AND r = ? AND c = ?').get(id, r, c);
  if (lock === false) {
    if (existing && existing.user_id !== req.user.id) {
      return res.status(423).json({ error: 'locked by other user' });
    }
    if (existing) db.prepare('DELETE FROM locks WHERE sheet_id = ? AND r = ? AND c = ?').run(id, r, c);
    db.prepare('INSERT INTO logs (sheet_id, user_id, r, c, action, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, req.user.id, r, c, 'unlock', now);
    return res.json({ ok: true, r, c, lock: false });
  }
  // acquire lock
  if (existing && existing.user_id !== req.user.id) {
    return res.status(423).json({ error: 'already locked' });
  }
  db.prepare('INSERT INTO locks (sheet_id, r, c, user_id, locked_at) VALUES (?, ?, ?, ?, ?)\n            ON CONFLICT(sheet_id, r, c) DO UPDATE SET user_id=excluded.user_id, locked_at=excluded.locked_at')
    .run(id, r, c, req.user.id, now);
  db.prepare('INSERT INTO logs (sheet_id, user_id, r, c, action, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.user.id, r, c, 'lock', now);
  res.json({ ok: true, r, c, lock: true, user_id: req.user.id, locked_at: now });
});

// Logs
sheetsRouter.get('/:id/logs', (req, res) => {
  const { id } = req.params;
  const logs = db.prepare('SELECT * FROM logs WHERE sheet_id = ? ORDER BY created_at DESC LIMIT 200').all(id);
  res.json({ logs });
});

import express from 'express';
import db from '../lib/db.js';
import { nanoid } from 'nanoid';

export const authRouter = express.Router();

export function authMiddleware(req, res, next) {
  const token = req.headers['x-session-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'No token' });
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'Invalid token' });
  const user = db.prepare('SELECT id, nickname FROM users WHERE id = ?').get(session.user_id);
  if (!user) return res.status(401).json({ error: 'Invalid user' });
  req.user = user;
  req.token = token;
  next();
}

// Join by nickname (+ optional password)
authRouter.post('/join', (req, res) => {
  const { nickname, password } = req.body || {};
  if (!nickname || typeof nickname !== 'string') {
    return res.status(400).json({ error: 'nickname required' });
  }
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM users WHERE nickname = ?').get(nickname);
  let userId;
  if (!existing) {
    userId = nanoid(12);
    db.prepare('INSERT INTO users (id, nickname, password, created_at) VALUES (?, ?, ?, ?)')
      .run(userId, nickname, password || null, now);
  } else {
    if (existing.password && existing.password !== (password || '')) {
      return res.status(403).json({ error: 'password incorrect' });
    }
    userId = existing.id;
  }
  // Enforce nickname uniqueness: if other user with same nickname exists, we already handled by unique index
  const token = nanoid(21);
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, now);
  res.json({ token, user: { id: userId, nickname } });
});

// Whoami
authRouter.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

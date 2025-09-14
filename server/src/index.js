import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import db from './lib/db.js';
import { authRouter, authMiddleware } from './routes/auth.js';
import { sheetsRouter } from './routes/sheets.js';
import { wsInit } from './ws.js';

const app = express();
app.use(cors());
app.use(express.json());

// health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// routes
app.use('/api/auth', authRouter);
app.use('/api/sheets', authMiddleware, sheetsRouter);

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wsInit(wss);

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

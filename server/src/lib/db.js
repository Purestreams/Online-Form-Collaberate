import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'app.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// schema
const init = () => {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    nickname TEXT UNIQUE NOT NULL,
    password TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sheets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    rows INTEGER NOT NULL,
    cols INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS cells (
    sheet_id TEXT NOT NULL,
    r INTEGER NOT NULL,
    c INTEGER NOT NULL,
    value TEXT,
    updated_by TEXT,
    updated_at INTEGER,
    PRIMARY KEY(sheet_id, r, c),
    FOREIGN KEY(sheet_id) REFERENCES sheets(id),
    FOREIGN KEY(updated_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS locks (
    sheet_id TEXT NOT NULL,
    r INTEGER NOT NULL,
    c INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    locked_at INTEGER NOT NULL,
    PRIMARY KEY(sheet_id, r, c),
    FOREIGN KEY(sheet_id) REFERENCES sheets(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sheet_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    r INTEGER,
    c INTEGER,
    action TEXT NOT NULL, -- update_cell|lock|unlock|create_sheet
    value TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(sheet_id) REFERENCES sheets(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_cells_sheet ON cells(sheet_id);
  CREATE INDEX IF NOT EXISTS idx_locks_sheet ON locks(sheet_id);
  CREATE INDEX IF NOT EXISTS idx_logs_sheet ON logs(sheet_id);
  `);
};

init();
export default db;

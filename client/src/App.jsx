import React, { useEffect, useMemo, useRef, useState } from 'react';

const API = '/api';

function useToken() {
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const save = (t) => { localStorage.setItem('token', t); setToken(t); };
  const clear = () => { localStorage.removeItem('token'); setToken(''); };
  return { token, save, clear };
}

function Join({ onJoined }) {
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const res = await fetch(`${API}/auth/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, password: password || undefined })
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || 'Failed');
    onJoined(data);
  };
  return (
    <form onSubmit={submit} className="card">
      <h2>加入协作</h2>
      <input placeholder="昵称 (唯一)" value={nickname} onChange={e=>setNickname(e.target.value)} required />
      <input placeholder="密码(可选)" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
      <button type="submit">进入</button>
      {error && <div className="error">{error}</div>}
    </form>
  );
}

function Sheets({ token, onOpen }) {
  const [sheets, setSheets] = useState([]);
  const [name, setName] = useState('我的表格');
  const [rows, setRows] = useState(5);
  const [cols, setCols] = useState(5);

  const load = async () => {
    const res = await fetch(`${API}/sheets`, { headers: { 'x-session-token': token } });
    const data = await res.json();
    setSheets(data.sheets || []);
  };
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API}/sheets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': token },
      body: JSON.stringify({ name, rows: Number(rows), cols: Number(cols) })
    });
    const data = await res.json();
    if (data.id) { setName('我的表格'); load(); }
  };

  return (
    <div className="wrap">
      <form onSubmit={create} className="card">
        <h3>新建表格</h3>
        <input value={name} onChange={e=>setName(e.target.value)} />
        <div className="row">
          <label>行</label><input type="number" value={rows} min={1} onChange={e=>setRows(e.target.value)} />
          <label>列</label><input type="number" value={cols} min={1} onChange={e=>setCols(e.target.value)} />
        </div>
        <button type="submit">创建</button>
      </form>
      <div className="card">
        <h3>选择表格</h3>
        <ul>
          {sheets.map(s => (
            <li key={s.id}>
              <button onClick={() => onOpen(s.id)}>{s.name} ({s.rows}x{s.cols})</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Grid({ token, sheetId, onBack, me }) {
  const [sheet, setSheet] = useState(null);
  const [cells, setCells] = useState({}); // key: r,c
  const [locks, setLocks] = useState({}); // key: r,c -> { user_id }
  const [log, setLog] = useState([]);
  const wsRef = useRef(null);

  // helpers
  const key = (r,c) => `${r},${c}`;
  const load = async () => {
    const res = await fetch(`${API}/sheets/${sheetId}`, { headers: { 'x-session-token': token } });
    const data = await res.json();
    setSheet(data.sheet);
    const map = {}; for (const cell of (data.cells||[])) map[key(cell.r, cell.c)] = cell;
    setCells(map);
    const lmap = {}; for (const l of (data.locks||[])) lmap[key(l.r,l.c)] = l;
    setLocks(lmap);
  };
  const loadLogs = async () => {
    const res = await fetch(`${API}/sheets/${sheetId}/logs`, { headers: { 'x-session-token': token } });
    const data = await res.json();
    setLog(data.logs || []);
  };

  useEffect(() => { load(); loadLogs(); }, [sheetId]);

  // websocket
  useEffect(() => {
    const url = new URL('/ws', window.location.origin.replace('http', 'ws'));
    url.searchParams.set('token', token);
    url.searchParams.set('sheet', sheetId);
    const ws = new WebSocket(url.toString());
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'cell_updated') {
        setCells(prev => ({ ...prev, [key(msg.r, msg.c)]: msg }));
      }
      if (msg.type === 'locked') {
        setLocks(prev => ({ ...prev, [key(msg.r, msg.c)]: msg }));
      }
      if (msg.type === 'unlocked') {
        setLocks(prev => { const cp = { ...prev }; delete cp[key(msg.r,msg.c)]; return cp; });
      }
      if (msg.type === 'bulk_unlock') {
        setLocks(prev => { const cp = { ...prev }; for (const cell of msg.cells) delete cp[key(cell.r,cell.c)]; return cp; });
      }
    };
    return () => ws.close();
  }, [token, sheetId]);

  const onFocus = (r,c) => wsRef.current?.send(JSON.stringify({ type: 'lock', r, c }));
  const onBlur = (r,c) => wsRef.current?.send(JSON.stringify({ type: 'unlock', r, c }));
  const onChange = async (r,c,value) => {
    // optimistic
    setCells(prev => ({ ...prev, [key(r,c)]: { r, c, value } }));
    wsRef.current?.send(JSON.stringify({ type: 'update_cell', r, c, value }));
  };

  if (!sheet) return <div className="card">加载中...</div>;

  const rows = Array.from({ length: sheet.rows });
  const cols = Array.from({ length: sheet.cols });

  return (
    <div>
      <div className="toolbar">
        <button onClick={onBack}>返回</button>
        <span>{sheet.name} ({sheet.rows}x{sheet.cols})</span>
        <button onClick={load}>刷新</button>
        <button onClick={loadLogs}>查看日志</button>
      </div>
      <div className="grid">
        <table>
          <thead>
            <tr>
              <th></th>
              {cols.map((_, ci) => <th key={ci}>{String.fromCharCode(65+ci)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((_, ri) => (
              <tr key={ri}>
                <th>{ri+1}</th>
                {cols.map((_, ci) => {
                  const k = key(ri,ci);
                  const lock = locks[k];
                  const cell = cells[k] || { r: ri, c: ci, value: '' };
      const disabled = !!(lock && lock.user_id && me && lock.user_id !== me.id);
                  return (
                    <td key={ci} className={lock? 'locked': ''} title={lock? `Editing by ${lock.user_id}`: ''}>
                      <input
                        value={cell.value || ''}
                        onChange={e=>onChange(ri,ci,e.target.value)}
                        onFocus={()=>onFocus(ri,ci)}
                        onBlur={()=>onBlur(ri,ci)}
        disabled={disabled}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {log.length>0 && (
        <div className="card logs">
          <h3>操作日志</h3>
          <ul>
            {log.map((l)=> (
              <li key={l.id}>[{new Date(l.created_at).toLocaleTimeString()}] {l.user_id} {l.action} ({l.r},{l.c}) {l.value? '-> '+l.value: ''}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { token, save } = useToken();
  const [sheetId, setSheetId] = useState('');
  const [me, setMe] = useState(null);

  const onJoined = (data) => { save(data.token); };

  useEffect(() => {
    let stop = false;
    const loadMe = async () => {
      if (!token) return setMe(null);
      try {
        const res = await fetch(`${API}/auth/me`, { headers: { 'x-session-token': token } });
        const data = await res.json();
        if (!stop) setMe(data.user || null);
      } catch {}
    };
    loadMe();
    return () => { stop = true; };
  }, [token]);

  if (!token) return <Join onJoined={onJoined} />;
  if (!sheetId) return <Sheets token={token} onOpen={setSheetId} />;
  return <Grid token={token} sheetId={sheetId} onBack={() => setSheetId('')} me={me} />;
}

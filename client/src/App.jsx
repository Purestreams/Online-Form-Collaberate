import React, { useEffect, useRef, useState } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import {
  Box, Button, Card, CardContent, CardHeader, Container, Grid as MuiGrid,
  IconButton, List, ListItem, ListItemButton, ListItemText, Stack, TextField, Toolbar, Typography,
  AppBar
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';

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
    <Container maxWidth="sm" sx={{ mt: 8 }}>
      <Card component="form" onSubmit={submit}>
        <CardHeader title="加入协作" />
        <CardContent>
          <Stack spacing={2}>
            <TextField label="昵称 (唯一)" value={nickname} onChange={e=>setNickname(e.target.value)} required />
            <TextField label="密码(可选)" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
            {error && <Typography color="error">{error}</Typography>}
            <Button type="submit" variant="contained">进入</Button>
          </Stack>
        </CardContent>
      </Card>
    </Container>
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

  const remove = async (id) => {
    if (!confirm('确定删除该表格吗？此操作不可恢复')) return;
    const res = await fetch(`${API}/sheets/${id}`, { method: 'DELETE', headers: { 'x-session-token': token } });
    if (res.ok) load();
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4 }}>
      <MuiGrid container spacing={2}>
        <MuiGrid item xs={12} md={4}>
          <Card component="form" onSubmit={create}>
            <CardHeader title="新建表格" />
            <CardContent>
              <Stack spacing={2}>
                <TextField label="名称" value={name} onChange={e=>setName(e.target.value)} />
                <Stack direction="row" spacing={2}>
                  <TextField label="行" type="number" value={rows} inputProps={{ min: 1 }} onChange={e=>setRows(e.target.value)} />
                  <TextField label="列" type="number" value={cols} inputProps={{ min: 1 }} onChange={e=>setCols(e.target.value)} />
                </Stack>
                <Button type="submit" variant="contained">创建</Button>
              </Stack>
            </CardContent>
          </Card>
        </MuiGrid>
        <MuiGrid item xs={12} md={8}>
          <Card>
            <CardHeader title="选择表格" />
            <CardContent>
              <List>
                {sheets.map(s => (
                  <ListItem key={s.id}
                    secondaryAction={
                      <IconButton edge="end" aria-label="delete" onClick={() => remove(s.id)} title="删除">
                        <DeleteIcon />
                      </IconButton>
                    }
                  >
                    <ListItemButton onClick={() => onOpen(s.id)}>
                      <ListItemText primary={`${s.name} (${s.rows}x${s.cols})`} secondary={new Date(s.created_at).toLocaleString()} />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </MuiGrid>
      </MuiGrid>
    </Container>
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

  if (!sheet) return (
    <Container maxWidth="lg" sx={{ mt: 4 }}>
      <Card><CardContent>加载中...</CardContent></Card>
    </Container>
  );

  const rows = Array.from({ length: sheet.rows });
  const cols = Array.from({ length: sheet.cols });

  return (
    <Box>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar>
          <Button onClick={onBack}>返回</Button>
          <Typography sx={{ ml: 2, flexGrow: 1 }}>
            {sheet.name} ({sheet.rows}x{sheet.cols})
          </Typography>
          <IconButton onClick={load} title="刷新" size="large"><RefreshIcon /></IconButton>
          <Button onClick={loadLogs}>查看日志</Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ mt: 2 }}>
        <Card>
          <CardContent>
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th></th>
                    {cols.map((_, ci) => <th key={ci} style={{ border: '1px solid #ddd', padding: 4 }}>{String.fromCharCode(65+ci)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((_, ri) => (
                    <tr key={ri}>
                      <th style={{ border: '1px solid #ddd', padding: 4 }}>{ri+1}</th>
                      {cols.map((_, ci) => {
                        const k = key(ri,ci);
                        const lock = locks[k];
                        const cell = cells[k] || { r: ri, c: ci, value: '' };
                        const disabled = !!(lock && lock.user_id && me && lock.user_id !== me.id);
                        return (
                          <td key={ci} style={{ border: '1px solid #ddd', padding: 0, background: lock ? '#fff5f5' : 'white' }} title={lock? `Editing by ${lock.user_id}`: ''}>
                            <TextField
                              variant="standard"
                              value={cell.value || ''}
                              onChange={e=>onChange(ri,ci,e.target.value)}
                              onFocus={()=>onFocus(ri,ci)}
                              onBlur={()=>onBlur(ri,ci)}
                              disabled={disabled}
                              fullWidth
                              InputProps={{ disableUnderline: true, sx: { px: 1, py: 0.5 } }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </CardContent>
        </Card>

        {log.length>0 && (
          <Card sx={{ mt: 2 }}>
            <CardHeader title="操作日志" />
            <CardContent>
              <List>
                {log.map((l)=> (
                  <ListItem key={l.id}>
                    <ListItemText primary={`[${new Date(l.created_at).toLocaleTimeString()}] ${l.user_id} ${l.action} (${l.r},${l.c}) ${l.value? '-> '+l.value: ''}`} />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        )}
      </Container>
    </Box>
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

  const theme = createTheme({ palette: { mode: 'light' } });
  return (
    <ThemeProvider theme={theme}>
      {!token ? (
        <Join onJoined={onJoined} />
      ) : !sheetId ? (
        <Sheets token={token} onOpen={setSheetId} />
      ) : (
        <Grid token={token} sheetId={sheetId} onBack={() => setSheetId('')} me={me} />
      )}
    </ThemeProvider>
  );
}

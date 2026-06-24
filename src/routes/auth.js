// Auth routes: register, login, logout, me.
// Tokens are secure random UUIDs stored server-side. No bcrypt dep — uses
// Node's built-in crypto (SHA-256). Use bcrypt in production.
import { Router } from 'express';
import { createHash, randomUUID } from 'crypto';

const sessions = new Map(); // token → userId
const router = Router();

function hash(pw) { return createHash('sha256').update(pw + 'gemline_salt_v1').digest('hex'); }

function wrap(fn) {
  return async (req, res) => {
    try { res.json(await fn(req, res)); }
    catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  };
}

function err(msg, status = 400) { const e = new Error(msg); e.status = status; throw e; }

export function authRouter(repo) {
  const r = Router();

  r.post('/register', wrap(async (req) => {
    const { email, password, handle } = req.body;
    if (!email || !password || !handle) err('email, password and handle are required');
    if (password.length < 6) err('password must be at least 6 characters');
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(handle)) err('handle must be 3-20 alphanumeric characters');

    const existing = (await repo.users.list({ email }));
    if (existing.length) err('email already registered');
    const handleTaken = (await repo.users.list({ handle }));
    if (handleTaken.length) err('handle already taken');

    const user = await repo.users.insert({
      handle, email, password_hash: hash(password), role: 'member',
      created_at: new Date().toISOString(),
    });
    const token = randomUUID();
    sessions.set(token, user.id);
    return { token, user: { id: user.id, handle: user.handle, email: user.email } };
  }));

  r.post('/login', wrap(async (req) => {
    const { email, password } = req.body;
    if (!email || !password) err('email and password required');

    const users = await repo.users.list({ email });
    const user = users[0];
    if (!user || user.password_hash !== hash(password)) err('invalid email or password', 401);

    const token = randomUUID();
    sessions.set(token, user.id);
    return { token, user: { id: user.id, handle: user.handle, email: user.email } };
  }));

  r.post('/logout', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) sessions.delete(token);
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const userId = token ? sessions.get(token) : null;
    if (!userId) return res.status(401).json({ error: 'not authenticated' });
    repo.users.get(userId).then(user => {
      if (!user) return res.status(401).json({ error: 'user not found' });
      res.json({ user: { id: user.id, handle: user.handle, email: user.email } });
    });
  });

  return r;
}

// Middleware: attaches req.userId if a valid token is present.
export function optionalAuth(req, _res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) req.userId = sessions.get(token) || null;
  next();
}

export function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const userId = token ? sessions.get(token) : null;
  if (!userId) return res.status(401).json({ error: 'Login required', code: 'UNAUTHENTICATED' });
  req.userId = userId;
  next();
}

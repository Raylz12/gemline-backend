// Authentication — stateless JWT-style tokens via HMAC-SHA256.
// No session Map = works across multiple Vercel instances / cold starts.
// Token format: base64url(payload):base64url(signature)
// Payload: { uid, iat, exp }
import { Router } from 'express';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';

const SECRET = process.env.JWT_SECRET || 'gemline_jwt_secret_v1_change_in_prod';
const TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

function b64url(s) {
  return Buffer.from(s).toString('base64url');
}
function fromB64url(s) {
  return Buffer.from(s, 'base64url').toString('utf8');
}

function signToken(userId) {
  const payload = b64url(JSON.stringify({ uid: userId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + TOKEN_TTL }));
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = createHmac('sha256', SECRET).update(payload).digest('base64url');
    // Constant-time compare
    const expBuf = Buffer.from(expected);
    const sigBuf = Buffer.from(sig);
    if (expBuf.length !== sigBuf.length) return null;
    if (!timingSafeEqual(expBuf, sigBuf)) return null;
    const data = JSON.parse(fromB64url(payload));
    if (data.exp < Math.floor(Date.now() / 1000)) return null; // expired
    return data.uid;
  } catch { return null; }
}

const hashPw = (pw) => createHash('sha256').update(pw + 'gemline_salt_v1').digest('hex');

function validate(body, fields) {
  for (const f of fields) if (!body[f]) throw Object.assign(new Error(`${f} is required`), { status: 400 });
}

export function authRouter(repo) {
  const r = Router();

  r.post('/register', async (req, res) => {
    try {
      const { email, password, handle } = req.body || {};
      if (!email || !password || !handle) return res.status(400).json({ error: 'email, password, and handle are required' });
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      if (!/^[a-zA-Z0-9]{3,20}$/.test(handle)) return res.status(400).json({ error: 'handle must be 3-20 alphanumeric characters' });

      const existing = (await repo.users.list({ email: email.toLowerCase() }))[0];
      if (existing) return res.status(409).json({ error: 'Email already registered' });

      const handleTaken = (await repo.users.list({ handle }))[0];
      if (handleTaken) return res.status(409).json({ error: 'Handle already taken' });

      const user = await repo.users.insert({
        handle,
        email: email.toLowerCase(),
        password_hash: hashPw(password),
        role: 'member',
        created_at: new Date().toISOString(),
      });

      const token = signToken(user.id);
      res.json({ token, user: { id: user.id, handle: user.handle, email: user.email } });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  r.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

      const user = (await repo.users.list({ email: email.toLowerCase() }))[0];
      if (!user || user.password_hash !== hashPw(password)) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = signToken(user.id);
      res.json({ token, user: { id: user.id, handle: user.handle, email: user.email } });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  r.post('/logout', (req, res) => {
    // Stateless tokens — client just discards. Could add a revocation list if needed.
    res.json({ ok: true });
  });

  r.get('/me', requireAuth, async (req, res) => {
    try {
      const user = await repo.users.get(req.userId);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json({ id: user.id, handle: user.handle, email: user.email });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return r;
}

// ── Middleware ────────────────────────────────────────────────────────────────
export function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Login required', code: 'UNAUTHENTICATED' });
  const userId = verifyToken(token);
  if (!userId) return res.status(401).json({ error: 'Invalid or expired token', code: 'UNAUTHENTICATED' });
  req.userId = userId;
  next();
}

export function optionalAuth(req, _res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (token) req.userId = verifyToken(token) || null;
  next();
}

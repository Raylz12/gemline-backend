// Authentication — stateless JWT-style tokens via HMAC-SHA256.
// No session Map = works across multiple Vercel instances / cold starts.
// Token format: base64url(payload):base64url(signature)
// Payload: { uid, iat, exp }
//
// Passwords: bcrypt (cost 11) for all new registrations. Legacy accounts
// (single SHA-256 + static salt) are verified against the old scheme and
// transparently rehashed to bcrypt on their next successful login.
// Scheme detection: bcrypt hashes start with "$2".
import { Router } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { pgRateCheck, pgRateClear, logBreach, getIp } from '../middleware/rateLimit.js';

const SECRET = process.env.JWT_SECRET || 'gemline_jwt_secret_v1_change_in_prod';
const TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days in seconds
const BCRYPT_COST = 11;

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

// ── Password hashing ──────────────────────────────────────────────────────────
const legacyHash = (pw) => createHash('sha256').update(pw + 'gemline_salt_v1').digest('hex');

async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith('$2')) return bcrypt.compare(password, stored);
  // Legacy sha256 — constant-time compare
  const a = Buffer.from(legacyHash(password));
  const b = Buffer.from(String(stored));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Signup hygiene ────────────────────────────────────────────────────────────
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamailblock.com', 'sharklasers.com', 'grr.la', 'spam4.me', 'pokemail.net',
  '10minutemail.com', '10minutemail.net', '10minemail.com', 'yopmail.com', 'yopmail.fr',
  'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmail.dev', 'tempmailo.com',
  'throwawaymail.com', 'trashmail.com', 'trashmail.de', 'getnada.com', 'nada.email',
  'mailnesia.com', 'maildrop.cc', 'dispostable.com', 'mintemail.com', 'mytemp.email',
  'fakeinbox.com', 'spamgourmet.com', 'mailcatch.com', 'emailondeck.com', 'moakt.com',
  'tmpmail.org', 'tmpmail.net', 'burnermail.io', 'mohmal.com', 'inboxkitten.com',
]);

const RESERVED_HANDLES = new Set([
  'admin', 'administrator', 'gemline', 'support', 'mod', 'moderator', 'staff',
  'official', 'help', 'root', 'system', 'api', 'security', 'billing', 'payments',
  'null', 'undefined', 'anonymous', 'deleted', 'owner', 'team', 'info', 'contact',
]);

// Normalize an email for duplicate detection: lowercase; for gmail, strip dots
// and +suffix in the local part (a.b+c@gmail.com === ab@gmail.com).
export function normalizeEmail(email) {
  const e = String(email).trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 0) return e;
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.split('+')[0].replace(/\./g, '');
    return `${local}@gmail.com`;
  }
  local = local.split('+')[0];
  return `${local}@${domain}`;
}

function emailDomain(email) {
  const at = String(email).lastIndexOf('@');
  return at >= 0 ? String(email).slice(at + 1).toLowerCase() : '';
}

// ── Cloudflare Turnstile (bot protection) ─────────────────────────────────────
// Fully gated on TURNSTILE_SECRET_KEY: when the env var is unset this is a
// no-op so nothing breaks before the keys exist. When set, server-side
// siteverify is enforced on register (and login when the client sends a token).
async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, error: 'Verification required — please complete the challenge' };
  try {
    const body = new URLSearchParams({ secret, response: String(token) });
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json();
    return data.success ? { ok: true } : { ok: false, error: 'Verification failed — please try again' };
  } catch (e) {
    console.error('turnstile siteverify error:', e.message);
    return { ok: true, degraded: true }; // fail open — Cloudflare outage must not block signups
  }
}

// ── DB-backed rate limits (cross-instance) ────────────────────────────────────
async function checkLimit(repo, opts) {
  if (!repo.pool) return { blocked: false };
  try {
    const r = await pgRateCheck(repo.pool, opts);
    // Audit visibility: log the first breach of each window (not every retry)
    if (r.blocked && r.count === opts.max + 1) {
      await logBreach(repo.pool, opts.bucket, opts.identifier, r.count, `/api/auth/${opts.bucket}`);
    }
    return r;
  }
  catch (e) { console.error('auth rate limit error (failing open):', e.message); return { blocked: false }; }
}

export function authRouter(repo) {
  const r = Router();

  r.post('/register', async (req, res) => {
    try {
      const { email, password, handle, turnstileToken } = req.body || {};
      if (!email || !password || !handle) return res.status(400).json({ error: 'email, password, and handle are required' });

      // Register: ≤3/hour per IP (DB-backed, holds across serverless instances)
      const ip = getIp(req);
      const lim = await checkLimit(repo, { bucket: 'register_ip', identifier: ip, max: 3, windowSec: 3600 });
      if (lim.blocked) {
        res.setHeader('Retry-After', lim.retryAfter);
        return res.status(429).json({ error: 'Too many accounts created from this network — try again later', retryAfter: lim.retryAfter });
      }

      const ts = await verifyTurnstile(turnstileToken, ip);
      if (!ts.ok) return res.status(400).json({ error: ts.error });

      if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      if (password.length > 128) return res.status(400).json({ error: 'Password too long' });
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(handle)) return res.status(400).json({ error: 'Handle must be 3-20 characters — letters, numbers, and underscores' });
      if (RESERVED_HANDLES.has(handle.toLowerCase())) return res.status(400).json({ error: 'That handle is reserved' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
      if (DISPOSABLE_DOMAINS.has(emailDomain(email))) return res.status(400).json({ error: 'Disposable email addresses are not allowed — use a real inbox' });

      const emailLower = String(email).trim().toLowerCase();
      const existing = (await repo.users.list({ email: emailLower }))[0];
      if (existing) return res.status(409).json({ error: 'Email already registered' });

      // Duplicate detection on the normalized form (gmail dots / +aliases)
      if (repo.pool) {
        const norm = normalizeEmail(emailLower);
        const { rows: [dupe] } = await repo.pool.query(
          `SELECT id FROM users
           WHERE lower(regexp_replace(split_part(split_part(email, '@', 1), '+', 1),
                       CASE WHEN split_part(email, '@', 2) IN ('gmail.com','googlemail.com') THEN '\\.' ELSE '(?!)' END,
                       '', 'g'))
                 || '@' || CASE WHEN split_part(email, '@', 2) = 'googlemail.com' THEN 'gmail.com' ELSE lower(split_part(email, '@', 2)) END
                 = $1
           LIMIT 1`, [norm]).catch(() => ({ rows: [] }));
        if (dupe) return res.status(409).json({ error: 'Email already registered' });
      }

      const handleTaken = repo.pool
        ? (await repo.pool.query('SELECT id FROM users WHERE LOWER(handle) = LOWER($1) LIMIT 1', [handle])).rows[0]
        : (await repo.users.list({ handle }))[0];
      if (handleTaken) return res.status(409).json({ error: 'Handle already taken' });

      const user = await repo.users.insert({
        handle,
        email: emailLower,
        password_hash: await bcrypt.hash(password, BCRYPT_COST),
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
      const { email, password, turnstileToken } = req.body || {};
      if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

      // Login: ≤5/15min per IP+email combo, progressive lockout on hammering.
      // Bucket clears on successful login so legit users never feel it.
      const ip = getIp(req);
      const loginKey = `${ip}|${String(email).trim().toLowerCase()}`;
      const lim = await checkLimit(repo, { bucket: 'login', identifier: loginKey, max: 5, windowSec: 900 });
      if (lim.blocked) {
        res.setHeader('Retry-After', lim.retryAfter);
        return res.status(429).json({ error: 'Too many login attempts — try again later', retryAfter: lim.retryAfter });
      }

      // Turnstile on login: only enforced when the server has keys AND the
      // client sent a token (older cached clients without the widget still work).
      if (process.env.TURNSTILE_SECRET_KEY && turnstileToken !== undefined) {
        const ts = await verifyTurnstile(turnstileToken, ip);
        if (!ts.ok) return res.status(400).json({ error: ts.error });
      }

      const user = (await repo.users.list({ email: String(email).trim().toLowerCase() }))[0];
      const valid = user ? await verifyPassword(password, user.password_hash) : false;
      if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

      // Lazy upgrade: legacy sha256 hash verified — rehash with bcrypt and store.
      if (!String(user.password_hash).startsWith('$2')) {
        try {
          const newHash = await bcrypt.hash(password, BCRYPT_COST);
          if (repo.pool) await repo.pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
          else await repo.users.update({ ...user, password_hash: newHash });
        } catch (e) { console.error('bcrypt lazy-upgrade failed (login still ok):', e.message); }
      }

      if (repo.pool) await pgRateClear(repo.pool, 'login', loginKey);

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

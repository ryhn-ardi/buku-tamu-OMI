import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';

const PORT = 3000;
const HOST = '0.0.0.0';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD_SHA256 =
  '7629ff54a4bbabf905969b66b172a8fe7b777327adbc532615f5cf728610d988';
const SESSION_COOKIE_NAME = 'tamukita_admin';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const VALID_CATEGORIES = new Set([
  'Instansi / Kantor',
  'Sekolah / Universitas',
  'Umum / Daerah',
  'Mitra / Tamu VIP',
]);

const VALID_STATUSES = new Set(['hadir', 'terverifikasi']);
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

// Initialize data directory & SQLite database
const dataDir = path.resolve(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const secretPath = path.join(dataDir, '.session-secret');
let sessionSecret: string;
if (fs.existsSync(secretPath)) {
  sessionSecret = fs.readFileSync(secretPath, 'utf8').trim();
} else {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretPath, sessionSecret, { mode: 0o600 });
}

const db = new DatabaseSync(path.join(dataDir, 'guestbook.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    heading_name TEXT NOT NULL,
    banner_image TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL,
    location TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guests (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    nama TEXT NOT NULL,
    asal TEXT NOT NULL,
    kategori_asal TEXT NOT NULL,
    pesan TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'hadir',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_guests_created_at ON guests(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_guests_event_id ON guests(event_id);
`);

// Seed default event if none exists
const existingMain = db
  .prepare('SELECT id FROM events WHERE id = ?')
  .get('main-guestbook') as { id: string } | undefined;

if (!existingMain) {
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO events (id, heading_name, banner_image, title, subtitle, location, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'main-guestbook',
    'TamuKita',
    '/src/assets/images/venue_reception_banner_1794970857392.jpg',
    'Buku Tamu Digital',
    'Silakan pindai QR Code atau lengkapi formulir di samping untuk mencatat kehadiran Anda.',
    'Lobi Utama Resepsionis',
    1,
    nowIso,
    nowIso
  );
}

interface EventRow {
  id: string;
  heading_name: string;
  banner_image: string;
  title: string;
  subtitle: string;
  location: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface GuestRow {
  id: string;
  event_id: string;
  nama: string;
  asal: string;
  kategori_asal: string;
  pesan: string;
  status: string;
  created_at: string;
}

function serializeEvent(row: EventRow) {
  return {
    id: row.id,
    headingName: row.heading_name,
    bannerImage: row.banner_image,
    title: row.title,
    subtitle: row.subtitle,
    location: row.location,
    isActive: row.is_active === 1,
    createdBy: 'admin',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeGuest(row: GuestRow) {
  return {
    id: row.id,
    eventId: row.event_id,
    nama: row.nama,
    asal: row.asal,
    kategoriAsal: row.kategori_asal,
    pesan: row.pesan,
    status: row.status,
    createdAt: row.created_at,
  };
}

// HMAC token helpers
function createAdminToken(): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: ADMIN_USERNAME,
      exp: Date.now() + TOKEN_TTL_MS,
    })
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', sessionSecret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function verifyAdminToken(token: string | undefined): boolean {
  if (!token || !token.includes('.')) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', sessionSecret)
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as { sub?: string; exp?: number };
    return (
      decoded.sub === ADMIN_USERNAME &&
      typeof decoded.exp === 'number' &&
      decoded.exp > Date.now()
    );
  } catch {
    return false;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    result[key] = decodeURIComponent(val);
  }
  return result;
}

function extractToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (typeof req.query.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME];
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!verifyAdminToken(token)) {
    res.status(401).json({ error: 'Sesi admin tidak valid atau telah berakhir.' });
    return;
  }
  next();
}

function verifyPassword(password: string): boolean {
  const inputHash = crypto.createHash('sha256').update(password).digest();
  const expectedHash = Buffer.from(ADMIN_PASSWORD_SHA256, 'hex');
  if (inputHash.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(inputHash, expectedHash);
}

// SSE client registries
const adminStreamClients = new Set<Response>();
const eventStreamClients = new Map<string, Set<Response>>();

function broadcastAdminEvent(type: string, payload: unknown) {
  const message = `data: ${JSON.stringify({ type, payload })}\n\n`;
  for (const client of adminStreamClients) {
    try {
      client.write(message);
    } catch {
      adminStreamClients.delete(client);
    }
  }
}

function broadcastPublicEventUpdate(eventId: string, payload: unknown) {
  const clients = eventStreamClients.get(eventId);
  if (!clients) return;
  const message = `data: ${JSON.stringify({ type: 'event-updated', payload })}\n\n`;
  for (const client of clients) {
    try {
      client.write(message);
    } catch {
      clients.delete(client);
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Admin Login
  app.post('/api/admin/login', (req, res) => {
    const username =
      typeof req.body?.username === 'string'
        ? req.body.username.trim().toLowerCase()
        : '';
    const password =
      typeof req.body?.password === 'string' ? req.body.password : '';

    if (username !== ADMIN_USERNAME || !verifyPassword(password)) {
      res.status(401).json({ error: 'Username atau password salah.' });
      return;
    }

    const token = createAdminToken();
    const isHttps =
      req.secure || req.headers['x-forwarded-proto'] === 'https';

    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      maxAge: TOKEN_TTL_MS,
      path: '/',
    });

    res.json({ ok: true, token, username: ADMIN_USERNAME });
  });

  app.get('/api/admin/session', (req, res) => {
    const token = extractToken(req);
    if (!verifyAdminToken(token)) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, username: ADMIN_USERNAME });
  });

  app.post('/api/admin/logout', (req, res) => {
    const isHttps =
      req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      path: '/',
    });
    res.json({ ok: true });
  });

  // Public: Fetch single event info for QR Check-In / Kiosk
  app.get('/api/events/:id', (req, res) => {
    const eventId = req.params.id;
    if (!ID_PATTERN.test(eventId)) {
      res.status(400).json({ error: 'ID acara tidak valid.' });
      return;
    }

    const row = db
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(eventId) as EventRow | undefined;

    if (!row) {
      res.status(404).json({ error: 'Acara tidak ditemukan.' });
      return;
    }

    res.json(serializeEvent(row));
  });

  // Public SSE: Live event heading / banner / active status updates
  app.get('/api/events/:id/stream', (req, res) => {
    const eventId = req.params.id;
    if (!ID_PATTERN.test(eventId)) {
      res.status(400).end();
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let set = eventStreamClients.get(eventId);
    if (!set) {
      set = new Set();
      eventStreamClients.set(eventId, set);
    }
    set.add(res);

    const row = db
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(eventId) as EventRow | undefined;
    if (row) {
      res.write(
        `data: ${JSON.stringify({
          type: 'event-updated',
          payload: serializeEvent(row),
        })}\n\n`
      );
    }

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      set?.delete(res);
      if (set && set.size === 0) {
        eventStreamClients.delete(eventId);
      }
    });
  });

  // Public: Submit guestbook entry via QR Code or Check-In form
  app.post('/api/guests', (req, res) => {
    const eventId =
      typeof req.body?.eventId === 'string' ? req.body.eventId.trim() : '';
    const nama = typeof req.body?.nama === 'string' ? req.body.nama.trim() : '';
    const asal = typeof req.body?.asal === 'string' ? req.body.asal.trim() : '';
    const kategoriAsal =
      typeof req.body?.kategoriAsal === 'string'
        ? req.body.kategoriAsal.trim()
        : '';
    const pesan =
      typeof req.body?.pesan === 'string' ? req.body.pesan.trim() : '';

    if (!ID_PATTERN.test(eventId)) {
      res.status(400).json({ error: 'ID acara tidak valid.' });
      return;
    }
    if (nama.length < 2 || nama.length > 100) {
      res.status(400).json({ error: 'Nama lengkap harus 2–100 karakter.' });
      return;
    }
    if (asal.length < 2 || asal.length > 150) {
      res.status(400).json({ error: 'Asal instansi/daerah harus 2–150 karakter.' });
      return;
    }
    if (!VALID_CATEGORIES.has(kategoriAsal)) {
      res.status(400).json({ error: 'Kategori asal tidak valid.' });
      return;
    }
    if (pesan.length < 2 || pesan.length > 1000) {
      res.status(400).json({ error: 'Pesan dan kesan harus 2–1000 karakter.' });
      return;
    }

    const eventRow = db
      .prepare('SELECT id, is_active FROM events WHERE id = ?')
      .get(eventId) as { id: string; is_active: number } | undefined;

    if (!eventRow) {
      res.status(404).json({ error: 'Acara tidak ditemukan.' });
      return;
    }
    if (eventRow.is_active !== 1) {
      res
        .status(403)
        .json({ error: 'Penerimaan tamu untuk acara ini sedang ditutup.' });
      return;
    }

    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const createdAt = new Date().toISOString();

    db.prepare(
      `INSERT INTO guests (id, event_id, nama, asal, kategori_asal, pesan, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, eventId, nama, asal, kategoriAsal, pesan, 'hadir', createdAt);

    const created = serializeGuest({
      id,
      event_id: eventId,
      nama,
      asal,
      kategori_asal: kategoriAsal,
      pesan,
      status: 'hadir',
      created_at: createdAt,
    });

    broadcastAdminEvent('guest-added', created);
    res.status(201).json(created);
  });

  // Protected Admin Endpoints
  app.get('/api/admin/bootstrap', requireAdmin, (_req, res) => {
    const guestRows = db
      .prepare('SELECT * FROM guests ORDER BY created_at DESC')
      .all() as unknown as GuestRow[];
    const eventRows = db
      .prepare('SELECT * FROM events ORDER BY created_at DESC')
      .all() as unknown as EventRow[];

    res.json({
      guests: guestRows.map(serializeGuest),
      events: eventRows.map(serializeEvent),
    });
  });

  app.get('/api/admin/stream', requireAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    adminStreamClients.add(res);

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      adminStreamClients.delete(res);
    });
  });

  app.patch('/api/admin/guests/:id', requireAdmin, (req, res) => {
    const guestId = req.params.id;
    if (!ID_PATTERN.test(guestId)) {
      res.status(400).json({ error: 'ID tamu tidak valid.' });
      return;
    }

    const existing = db
      .prepare('SELECT * FROM guests WHERE id = ?')
      .get(guestId) as GuestRow | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Data tamu tidak ditemukan.' });
      return;
    }

    const nama =
      typeof req.body?.nama === 'string'
        ? req.body.nama.trim()
        : existing.nama;
    const asal =
      typeof req.body?.asal === 'string'
        ? req.body.asal.trim()
        : existing.asal;
    const kategoriAsal =
      typeof req.body?.kategoriAsal === 'string'
        ? req.body.kategoriAsal.trim()
        : existing.kategori_asal;
    const pesan =
      typeof req.body?.pesan === 'string'
        ? req.body.pesan.trim()
        : existing.pesan;
    const status =
      typeof req.body?.status === 'string'
        ? req.body.status.trim()
        : existing.status;

    if (nama.length < 2 || nama.length > 100) {
      res.status(400).json({ error: 'Nama lengkap harus 2–100 karakter.' });
      return;
    }
    if (asal.length < 2 || asal.length > 150) {
      res.status(400).json({ error: 'Asal harus 2–150 karakter.' });
      return;
    }
    if (!VALID_CATEGORIES.has(kategoriAsal)) {
      res.status(400).json({ error: 'Kategori asal tidak valid.' });
      return;
    }
    if (pesan.length < 2 || pesan.length > 1000) {
      res.status(400).json({ error: 'Pesan harus 2–1000 karakter.' });
      return;
    }
    if (!VALID_STATUSES.has(status)) {
      res.status(400).json({ error: 'Status kehadiran tidak valid.' });
      return;
    }

    db.prepare(
      `UPDATE guests SET nama = ?, asal = ?, kategori_asal = ?, pesan = ?, status = ? WHERE id = ?`
    ).run(nama, asal, kategoriAsal, pesan, status, guestId);

    const updated = serializeGuest({
      ...existing,
      nama,
      asal,
      kategori_asal: kategoriAsal,
      pesan,
      status,
    });

    broadcastAdminEvent('guest-updated', updated);
    res.json(updated);
  });

  app.delete('/api/admin/guests/:id', requireAdmin, (req, res) => {
    const guestId = req.params.id;
    if (!ID_PATTERN.test(guestId)) {
      res.status(400).json({ error: 'ID tamu tidak valid.' });
      return;
    }

    const result = db.prepare('DELETE FROM guests WHERE id = ?').run(guestId);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Data tamu tidak ditemukan.' });
      return;
    }

    broadcastAdminEvent('guest-deleted', { id: guestId });
    res.json({ ok: true, id: guestId });
  });

  app.post('/api/admin/events', requireAdmin, (req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    const headingName =
      typeof req.body?.headingName === 'string'
        ? req.body.headingName.trim()
        : '';
    const bannerImage =
      typeof req.body?.bannerImage === 'string'
        ? req.body.bannerImage.trim()
        : '';
    const title =
      typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const subtitle =
      typeof req.body?.subtitle === 'string' ? req.body.subtitle.trim() : '';
    const location =
      typeof req.body?.location === 'string' ? req.body.location.trim() : '';
    const isActive =
      typeof req.body?.isActive === 'boolean' ? req.body.isActive : true;

    if (!ID_PATTERN.test(id)) {
      res.status(400).json({ error: 'ID acara tidak valid.' });
      return;
    }
    if (headingName.length < 1 || headingName.length > 80) {
      res.status(400).json({ error: 'Nama heading harus 1–80 karakter.' });
      return;
    }
    if (bannerImage.length > 350000) {
      res.status(400).json({ error: 'Ukuran gambar terlalu besar.' });
      return;
    }
    if (title.length < 2 || title.length > 120) {
      res.status(400).json({ error: 'Judul acara harus 2–120 karakter.' });
      return;
    }

    const exists = db
      .prepare('SELECT id FROM events WHERE id = ?')
      .get(id) as { id: string } | undefined;
    if (exists) {
      res.status(409).json({ error: 'ID acara sudah digunakan.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const safeBanner =
      bannerImage || '/src/assets/images/venue_reception_banner_1794970857392.jpg';

    db.prepare(
      `INSERT INTO events (id, heading_name, banner_image, title, subtitle, location, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      headingName,
      safeBanner,
      title,
      subtitle.slice(0, 200),
      location.slice(0, 120),
      isActive ? 1 : 0,
      nowIso,
      nowIso
    );

    const created = serializeEvent({
      id,
      heading_name: headingName,
      banner_image: safeBanner,
      title,
      subtitle: subtitle.slice(0, 200),
      location: location.slice(0, 120),
      is_active: isActive ? 1 : 0,
      created_at: nowIso,
      updated_at: nowIso,
    });

    broadcastAdminEvent('event-updated', created);
    res.status(201).json(created);
  });

  app.put('/api/admin/events/:id', requireAdmin, (req, res) => {
    const id = req.params.id;
    if (!ID_PATTERN.test(id)) {
      res.status(400).json({ error: 'ID acara tidak valid.' });
      return;
    }

    const existing = db
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(id) as EventRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Acara tidak ditemukan.' });
      return;
    }

    const headingName =
      typeof req.body?.headingName === 'string'
        ? req.body.headingName.trim()
        : existing.heading_name;
    const bannerImage =
      typeof req.body?.bannerImage === 'string'
        ? req.body.bannerImage.trim()
        : existing.banner_image;
    const title =
      typeof req.body?.title === 'string'
        ? req.body.title.trim()
        : existing.title;
    const subtitle =
      typeof req.body?.subtitle === 'string'
        ? req.body.subtitle.trim()
        : existing.subtitle;
    const location =
      typeof req.body?.location === 'string'
        ? req.body.location.trim()
        : existing.location;
    const isActive =
      typeof req.body?.isActive === 'boolean'
        ? req.body.isActive
        : existing.is_active === 1;

    if (headingName.length < 1 || headingName.length > 80) {
      res.status(400).json({ error: 'Nama heading harus 1–80 karakter.' });
      return;
    }
    if (bannerImage.length > 350000) {
      res.status(400).json({ error: 'Ukuran gambar terlalu besar.' });
      return;
    }
    if (title.length < 2 || title.length > 120) {
      res.status(400).json({ error: 'Judul acara harus 2–120 karakter.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const safeBanner =
      bannerImage || '/src/assets/images/venue_reception_banner_1794970857392.jpg';

    db.prepare(
      `UPDATE events
       SET heading_name = ?, banner_image = ?, title = ?, subtitle = ?, location = ?, is_active = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      headingName,
      safeBanner,
      title,
      subtitle.slice(0, 200),
      location.slice(0, 120),
      isActive ? 1 : 0,
      nowIso,
      id
    );

    const updated = serializeEvent({
      ...existing,
      heading_name: headingName,
      banner_image: safeBanner,
      title,
      subtitle: subtitle.slice(0, 200),
      location: location.slice(0, 120),
      is_active: isActive ? 1 : 0,
      updated_at: nowIso,
    });

    broadcastAdminEvent('event-updated', updated);
    broadcastPublicEventUpdate(id, updated);
    res.json(updated);
  });

  // Vite dev middleware or production static assets
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, HOST, () => {
    console.log(`TamuKita server running on http://${HOST}:${PORT}`);
  });
}

void startServer();

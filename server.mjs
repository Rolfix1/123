import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const password = process.env.OWNER_PASSWORD;
if (!password || password.length < 12 || password.length > 300) {
  console.error('Задайте OWNER_PASSWORD длиной от 12 до 300 символов.');
  process.exit(1);
}
const databaseFile = process.env.VECTOR_DB || join(
  process.env.LOCALAPPDATA || homedir(), 'VectorGarage', 'requests.sqlite',
);
mkdirSync(dirname(databaseFile), { recursive: true });
const db = new DatabaseSync(databaseFile);
db.exec('PRAGMA busy_timeout = 5000');
db.exec(
  'CREATE TABLE IF NOT EXISTS requests (' +
  'id TEXT PRIMARY KEY, created TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, ' +
  'car TEXT NOT NULL, service TEXT NOT NULL, message TEXT NOT NULL)',
);
const services = new Set(['Нужна помощь с выбором', 'Двигатель', 'Электрика', 'Ходовая и тормоза',
  'Ремонт двигателей',
  'Ремонт подвески',
  'Техническое обслуживание',
  'Ремонт тормозной системы',
  'Автоэлектрика и оборудование',
  'Ремонт АКПП',
  'Ремонт DSG',
  'Диагностика автомобиля',
  'Раскоксовка двигателя',
  'Мойка автомобиля',
]);
const insert = db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?, ?, ?)');
const list = db.prepare('SELECT * FROM requests ORDER BY created DESC LIMIT 200');
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/site.js', ['site.js', 'text/javascript; charset=utf-8']],
  ['/hero.jpg', ['hero.b64', 'image/jpeg']],
  ['/work.jpg', ['work.b64', 'image/jpeg']],
  ['/parts.jpg', ['parts.b64', 'image/jpeg']],
]);
const sessions = new Map();
const loginAttempts = new Map();
const hour = 60 * 60 * 1000;
const secureCookie = process.env.SECURE_COOKIE === '1';
const cookieSettings = 'Path=/owner; HttpOnly; SameSite=Strict' + (secureCookie ? '; Secure' : '');
const hash = value => createHash('sha256').update(value).digest();
const passwordHash = hash(password);
const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function reply(response, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'",
    ...headers,
  });
  response.end(body);
}

function json(response, status, data) {
  reply(response, status, JSON.stringify(data), 'application/json; charset=utf-8');
}

async function readForm(request) {
  if (!request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= 10000) chunks.push(chunk);
  }
  return size <= 10000 ? new URLSearchParams(Buffer.concat(chunks).toString('utf8')) : null;
}

function ownerPage(title, content) {
  return '<!doctype html><html lang="ru"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + title + ' — ВЕКТОР</title><link rel="stylesheet" href="/style.css">' +
    '<main class="wrap owner"><a class="logo" href="/"><i aria-hidden="true"></i>ВЕКТОР</a>' +
    '<h1>' + title + '</h1>' + content + '</main></html>';
}

function login(response, status = 200, error = '') {
  reply(response, status, ownerPage('Вход для владельца',
    '<form method="post" action="/owner"><label>Пароль<input name="password" type="password" ' +
    'autocomplete="current-password" required maxlength="300"></label>' +
    '<button type="submit" class="button">Войти ↗</button></form>' +
    (error ? '<p class="owner-error">' + escape(error) + '</p>' : ''),
  ));
}

function renderRequests(response) {
  const date = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow',
  });
  const rows = list.all().map(row => (
    '<article><time class="owner-time" datetime="' + escape(row.created) + '">' +
    date.format(new Date(row.created)) + ' · ' + escape(row.id.slice(0, 8).toUpperCase()) +
    '</time><h2>' + escape(row.name) + ' · ' + escape(row.service) + '</h2><p>' +
    escape(row.phone) + ' · ' + escape(row.car) + '</p><p>' + escape(row.message) + '</p></article>'
  )).join('');
  reply(response, 200, ownerPage('Заявки на диагностику',
    '<form action="/owner/logout" method="post"><button class="outline" type="submit">Выйти</button></form>' +
    '<div class="owner-list">' + (rows || '<p>Заявок пока нет.</p>') + '</div>',
  ));
}

async function saveRequest(request, response) {
  const fields = await readForm(request);
  const get = key => fields?.get(key)?.trim() || '';
  const name = get('name');
  const phone = get('phone');
  const car = get('car');
  const service = get('service');
  const message = get('message');
  const digits = phone.replace(/\D/g, '').length;
  if (!name || name.length > 80 || !car || car.length > 100 ||
      phone.length > 28 || !/^[+\d ()-]+$/.test(phone) || digits < 7 || digits > 15 ||
      !services.has(service) || message.length > 600 || get('consent') !== 'yes') {
    return json(response, 400, { error: 'Проверьте имя, телефон, автомобиль, услугу и согласие.' });
  }
  const id = randomUUID();
  insert.run(id, new Date().toISOString(), name, phone, car, service, message);
  if (request.headers.accept?.includes('text/html')) {
    return reply(response, 201, ownerPage('Заявка сохранена', '<p><a href="/">Вернуться на сайт</a></p>'));
  }
  json(response, 201, { id });
}

async function route(request, response) {
  const path = new URL(request.url, 'http://localhost').pathname;
  const method = request.method;
  if (method === 'GET' && files.has(path)) {
    const [name, type] = files.get(path);
    const bytes = readFileSync(new URL(name, import.meta.url));
    return reply(response, 200, name.endsWith('.b64') ? Buffer.from(bytes.toString(), 'base64') : bytes, type);
  }
  if (path === '/api/requests' && method === 'POST') return saveRequest(request, response);
  const token = request.headers.cookie?.match(/(?:^|;\s*)vector_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const now = Date.now();
  if (path === '/owner' && method === 'GET') {
    return sessions.get(token) > now ? renderRequests(response) : login(response);
  }
  if (path === '/owner' && method === 'POST') {
    const address = request.socket.remoteAddress;
    const attempt = loginAttempts.get(address);
    if (attempt?.until > now && attempt.count >= 8) return login(response, 429, 'Попробуйте через 15 минут.');
    const fields = await readForm(request);
    if (!timingSafeEqual(hash(fields?.get('password') || ''), passwordHash)) {
      loginAttempts.set(address, attempt?.until > now
        ? { until: attempt.until, count: attempt.count + 1 }
        : { until: now + hour / 4, count: 1 });
      return login(response, 401, 'Неверный пароль.');
    }
    loginAttempts.delete(address);
    if (token) sessions.delete(token);
    const session = randomBytes(32).toString('hex');
    sessions.set(session, now + hour * 8);
    return reply(response, 303, '', undefined, {
      Location: '/owner', 'Set-Cookie': 'vector_session=' + session + '; Max-Age=28800; ' + cookieSettings,
    });
  }
  if (path === '/owner/logout' && method === 'POST') {
    sessions.delete(token);
    return reply(response, 303, '', undefined, {
      Location: '/owner', 'Set-Cookie': 'vector_session=; Max-Age=0; ' + cookieSettings,
    });
  }
  reply(response, 404, 'Страница не найдена', 'text/plain; charset=utf-8');
}

setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of sessions) if (expiry <= now) sessions.delete(token);
  for (const [address, attempt] of loginAttempts) if (attempt.until <= now) loginAttempts.delete(address);
}, hour / 4).unref();

createServer((request, response) => {
  route(request, response).catch(error => {
    console.error(error);
    if (!response.headersSent) json(response, 500, { error: 'Внутренняя ошибка сервера.' });
    else response.end();
  });
}).listen(port, host, () => console.log('ВЕКТОР  http://' + host + ':' + port));

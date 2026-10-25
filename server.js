import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';

const dir = resolve(process.env.DATA_DIR || './data');
mkdirSync(dir, { recursive: true });
const file = resolve(dir, 'rooms.json');
const rooms = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const key = () => randomBytes(18).toString('hex');
const ai = {
  key: process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY,
  baseUrl: process.env.DEEPSEEK_BASE_URL || process.env.LLM_BASE_URL || 'https://api.deepseek.com',
  model: process.env.DEEPSEEK_MODEL || process.env.LLM_MODEL || 'deepseek-flash',
  prompt: readFileSync(resolve(process.env.DEEPSEEK_PROMPT_FILE || 'prompts/board.txt'), 'utf8')
};
const isDeepSeek = new URL(ai.baseUrl).hostname === 'api.deepseek.com';
const provider = isDeepSeek ? 'DeepSeek' : 'AI';
function save() { writeFileSync(file + '.tmp', JSON.stringify(rooms)); renameSync(file + '.tmp', file); }
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function clean(value, max = 600) { if (typeof value !== 'string' || !value.trim() || value.length > max) fail('Попълни полетата (най-много 600 знака).'); return value.trim(); }
function deck(input) {
  const heavy = /move|sofa|renovat|week|paint|party|furniture|мест[ея]|премест|диван|ремонт|седмиц|боядис|купон|парт[и]|мебел/i.test(input.ask + ' ' + input.wantA + ' ' + input.wantB);
  const minutes = heavy ? 40 : 15;
  const costumes = input.heat === 'Filthy' ? ['Домашна мръсница', 'Любимото ти лошо решение', 'Сертифициран съседски угодник'] : ['Гореща бъркотия', 'На твоите услуги', 'Поход на срама'];
  const favors = [
    ['Домашно обслужване', `Дължиш на съседа ${minutes} минути чистене на кухнята със саморъчно направена престилка „${costumes[0]}“ върху дрехите.`],
    ['Закуска след мрак', `Дължиш на съседа ${minutes} минути приготвяне и поднасяне на закуска с безобразно съблазнително четене на менюто. Продуктите се уговарят предварително.`],
    ['Мръсно пране', `Дължиш на съседа ${minutes} минути сгъване на уговореното пране в избран от теб костюм „${costumes[1]}“.`],
    ['Поход на срама', `Дължиш на съседа ${minutes} минути изхвърляне на боклука и чистене на площадката с табела „${costumes[2]}“ в негово присъствие.`],
    ['Лично изкушение', `Дължиш на съседа ${minutes} минути уговорени домашни задачи, започващи с 30-секундно кабаре с всички дрехи.`],
    ['Търкай ме по-силно', `Дължиш на съседа ${minutes} минути чистене на банята с драматично въведение в стил филм за възрастни. Снимане не се изисква.`]
  ].map(([title, detail]) => ({ title, detail }));
  if (input.mode === 'favor') return favors;
  return [
    { title: `По волята на ${input.nameA}`, detail: `Решението на ${input.nameA}: ${input.wantA}` },
    ...[
      ['Целувка и компромис', `Всяко домакинство получава половината от поисканото време или достъп по обща уговорка. ${input.nameA} дължи 30-секундно кабаре извинение с всички дрехи; ${input.nameB} дължи ${minutes} минути чистене на общите части.`],
      ['Твой ред е, скъпи', `Този път важи решението на ${input.nameA}; следващия подобен път — на ${input.nameB}. ${input.nameA} дължи ${minutes} минути помощ в дома с табела „На твоите услуги“.`],
      ['Помоли се', `Този път важи решението на ${input.nameB}; следващия път — на ${input.nameA}. ${input.nameB} дължи ${minutes} минути помощ в дома, започваща с драматично извинение с намеци.`],
      ['Взаимно удовлетворение', `Нито едно от първоначалните искания не важи тази вечер. Уговорете средно положение преди да продължите; всяко домакинство дължи ${Math.ceil(minutes / 2)} минути общо чистене с избрани от него костюми „Гореща бъркотия“.`]
    ].map(([title, detail]) => ({ title, detail })),
    { title: `По волята на ${input.nameB}`, detail: `Решението на ${input.nameB}: ${input.wantB}` }
  ];
}
async function generate(input) {
  const fallback = deck(input);
  if (!ai.key) return { options: fallback, source: `Готови варианти · ${provider} не е настроен` };
  try {
    const response = await fetch(ai.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(45000),
      headers: { Authorization: `Bearer ${ai.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ai.model, max_tokens: 2000, temperature: 1.1, stream: false, ...(isDeepSeek ? { thinking: { type: 'disabled' } } : {}), response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: ai.prompt },
        { role: 'user', content: JSON.stringify({ input, ...(input.mode === 'dispute' ? { fixedPockets: { first: fallback[0], last: fallback[5] } } : {}) }) }
      ] })
    });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const result = await response.json();
    const choice = result.choices?.[0];
    if (choice?.finish_reason !== 'stop' || !choice.message?.content?.trim()) throw Error('Incomplete response');
    const options = JSON.parse(choice.message.content).options;
    if (!Array.isArray(options) || options.length !== 6 || options.some(o => !o || typeof o.title !== 'string' || !o.title.trim() || o.title.length > 70 || typeof o.detail !== 'string' || !o.detail.trim() || o.detail.length > 700) || new Set(options.map(o => o.title.trim().toLowerCase())).size !== 6) throw Error('Invalid board');
    if (input.mode === 'dispute') { options[0] = fallback[0]; options[5] = fallback[5]; }
    return { options: options.map(({ title, detail }) => ({ title: title.trim(), detail: detail.trim() })), source: `Генерирано от ${provider}` };
  } catch (error) {
    // Log a bounded failure category, never provider content, credentials or neighbor requests.
    const reason = /^HTTP \d{3}$/.test(error.message) ? error.message : error.name === 'TimeoutError' ? 'timeout' : 'invalid or unavailable response';
    console.warn(`[${provider}] Board generation failed (${reason}); using house deck.`);
    return { options: fallback, source: `Готови варианти · ${provider} е недостъпен` };
  }
}
async function body(req) {
  let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 12000) fail('Заявката е твърде голяма', 413); }
  try { return JSON.parse(data); } catch { fail('Невалидна заявка'); }
}
// Live connections stay in memory; the selected result and animation survive restarts.
const connections = new Map();
const presence = room => Object.fromEntries(['owner', 'guest'].map(role => [role,
  [...(connections.get(room.id) || [])].some(peer => peer.role === role && peer.screen === 'play' && peer.visible && Date.now() - peer.updatedAt < 6500)
]));
function reconcileSpin(room) {
  const spin = room.spin;
  if (!spin || spin.finishedAt) return;
  const now = Date.now(), time = spin.pausedAt ?? now;
  if (time >= spin.startsAt + spin.duration + spin.revealDuration) { spin.finishedAt = now; save(); return; }
  const watching = presence(room);
  if ((!watching.owner || !watching.guest) && spin.pausedAt == null) { spin.pausedAt = now; save(); }
  else if (watching.owner && watching.guest && spin.pausedAt != null) {
    spin.startsAt += now - spin.pausedAt; spin.pausedAt = null; save();
  }
}
function view(room, role) {
  const { ownerKey, guestKey, ...publicRoom } = room;
  return { ...publicRoom, role, presence: presence(room), serverTime: Date.now() };
}
function publish(room) {
  reconcileSpin(room);
  for (const peer of connections.get(room.id) || []) {
    if (!peer.res.destroyed) peer.res.write(`data: ${JSON.stringify(view(room, peer.role))}\n\n`);
  }
}
function spinPath(result) {
  const target = (result + .5) / 6, path = [{ x: .5, y: .065 }];
  for (let row = 0; row < 10; row++) {
    const progress = (row + 1) / 11;
    const desired = .5 + (target - .5) * progress + (randomInt(10000) / 10000 - .5) * .22 * Math.sin(progress * Math.PI);
    const pegs = Array.from({ length: row % 2 ? 5 : 6 }, (_, col) => (col + (row % 2 ? 1 : .5)) / 6);
    path.push({ x: pegs.reduce((best, x) => Math.abs(x - desired) < Math.abs(best - desired) ? x : best), y: .2 + row * .071 - .027 });
  }
  return [...path, { x: target, y: .97 }];
}
setInterval(() => { for (const id of connections.keys()) if (rooms[id]) publish(rooms[id]); }, 2000).unref();
const server = http.createServer(async (req, res) => {
  const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      if (Object.keys(rooms).length >= 10000) fail('Къщата е пълна. Помоли администратора да архивира старите табла.', 503);
      const raw = await body(req);
      const input = { mode: raw.mode === 'dispute' ? 'dispute' : 'favor', nameA: clean(raw.nameA, 35), nameB: clean(raw.nameB, 35), heat: 'Filthy' };
      if (input.mode === 'favor') input.ask = clean(raw.ask);
      else { input.wantA = clean(raw.wantA); input.wantB = clean(raw.wantB); }
      const generated = await generate(input);
      const room = { id: key(), ownerKey: key(), guestKey: key(), input, ...generated, approved: { owner: false, guest: false }, result: null, createdAt: Date.now() };
      rooms[room.id] = room; save();
      return send(201, { ...view(room, 'owner'), token: room.ownerKey, guestToken: room.guestKey });
    }
    const match = url.pathname.match(/^\/api\/rooms\/([a-f0-9]{36})(?:\/(approve|drop|invite|events|presence))?$/);
    if (match) {
      const room = rooms[match[1]];
      if (!room) fail('Това табло не е намерено.', 404);
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const role = token === room.ownerKey ? 'owner' : token === room.guestKey ? 'guest' : null;
      if (!role) fail('Тази покана е невалидна.', 403);
      if (req.method === 'GET' && match[2] === 'events') {
        const clientId = clean(url.searchParams.get('clientId'), 80);
        const peers = connections.get(room.id) || new Set();
        // A reconnect replaces its previous connection without impersonating the other role.
        for (const peer of peers) if (peer.role === role && peer.clientId === clientId) { peers.delete(peer); peer.res.end(); }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        const peer = { res, role, clientId, screen: '', visible: false, updatedAt: 0 };
        peers.add(peer); connections.set(room.id, peers);
        res.on('close', () => { peers.delete(peer); publish(room); if (!peers.size && connections.get(room.id) === peers) connections.delete(room.id); });
        publish(room); return;
      }
      if (req.method === 'POST' && match[2] === 'presence') {
        const raw = await body(req);
        for (const peer of connections.get(room.id) || []) if (peer.role === role && peer.clientId === raw.clientId) {
          peer.screen = raw.screen === 'play' ? 'play' : 'review'; peer.visible = raw.visible === true; peer.updatedAt = Date.now();
        }
        publish(room); return send(200, view(room, role));
      }
      if (req.method === 'GET' && !match[2]) { reconcileSpin(room); return send(200, view(room, role)); }
      if (req.method === 'POST' && match[2] === 'invite' && role === 'owner') return send(200, { guestToken: room.guestKey });
      if (req.method === 'POST' && match[2] === 'approve') { room.approved[role] = true; save(); publish(room); return send(200, view(room, role)); }
      if (req.method === 'POST' && match[2] === 'drop') {
        if (!room.approved.owner || !room.approved.guest) fail('И двамата съседи трябва първо да одобрят всички варианти.');
        if (room.input.mode === 'favor' && role !== 'guest') fail('Този жетон се пуска от съседа ти.');
        if (room.result === null) {
          const watching = presence(room);
          if (!watching.owner || !watching.guest) fail('И двамата трябва да сте на таблото с отворена игра.');
          room.result = randomInt(6); room.settledAt = Date.now();
          room.spin = { startsAt: Date.now() + 1200, duration: 4300, revealDuration: 1600, pausedAt: null, finishedAt: null, path: spinPath(room.result) };
          save(); publish(room);
        }
        return send(200, view(room, role));
      }
      fail('Действието е недостъпно', 405);
    }
    if (url.pathname.startsWith('/api/')) fail('Не е намерено', 404);
    const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
    const asset = ['/favor', '/dispute', '/board', '/play', '/result'].includes(url.pathname) ? assets['/'] : assets[url.pathname]; if (!asset) fail('Не е намерено', 404);
    res.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(readFileSync(resolve('public', asset[0])));
  } catch (error) { send(error.status || 500, { error: error.status ? error.message : 'Възникна проблем. Опитай отново.' }); }
});
server.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log(`Bad Neighbors → http://localhost:${process.env.PORT || 3000}`));

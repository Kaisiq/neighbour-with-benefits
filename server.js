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
function clean(value, max = 600) { if (typeof value !== 'string' || !value.trim() || value.length > max) fail('Please fill in the fields (600 characters maximum).'); return value.trim(); }
function deck(input) {
  const heavy = /move|sofa|renovat|week|paint|party|furniture/i.test(input.ask + ' ' + input.wantA + ' ' + input.wantB);
  const minutes = heavy ? 40 : 15;
  const costumes = input.heat === 'Filthy' ? ['Domestic Slut', 'Your Favorite Bad Decision', 'Certified Neighbor Pleaser'] : ['Hot Mess', 'At Your Service', 'Walk of Shame'];
  const favors = [
    ['Domestic service', `You owe your neighbor ${minutes} minutes of kitchen cleaning wearing a self-made “${costumes[0]}” apron over your clothes.`],
    ['Breakfast after dark', `You owe your neighbor ${minutes} minutes of breakfast prep and delivery, with an outrageously seductive menu reading. Ingredients agreed in advance.`],
    ['Dirty laundry', `You owe your neighbor ${minutes} minutes folding their agreed laundry, in a “${costumes[1]}” outfit of your choosing.`],
    ['Walk of shame', `You owe your neighbor ${minutes} minutes of bin duty and landing cleanup, wearing a “${costumes[2]}” sign in their company.`],
    ['Personal temptation', `You owe your neighbor ${minutes} minutes of agreed household errands, introduced with a fully clothed, 30-second cabaret performance.`],
    ['Scrub me harder', `You owe your neighbor ${minutes} minutes of bathroom cleaning, with a dramatic adult-film-style introduction. No filming required.`]
  ].map(([title, detail]) => ({ title, detail }));
  if (input.mode === 'favor') return favors;
  return [
    { title: `${input.nameA}'s way`, detail: `${input.nameA}'s resolution: ${input.wantA}` },
    ...[
      ['Kiss & compromise', `Each household gets half of its requested time or access, arranged together. ${input.nameA} owes a fully clothed, 30-second cabaret apology; ${input.nameB} owes ${minutes} minutes of shared-space cleanup.`],
      ['Your turn, darling', `${input.nameA}'s resolution applies this time; ${input.nameB}'s applies to the next comparable occasion. ${input.nameA} owes ${minutes} minutes of household help wearing an “At Your Service” sign.`],
      ['Beg for it', `${input.nameB}'s resolution applies this time; ${input.nameA}'s applies next time. ${input.nameB} owes ${minutes} minutes of household help, introduced with a dramatic, suggestive apology.`],
      ['Mutual satisfaction', `Neither original demand applies tonight. Agree a middle ground before proceeding; each household owes ${Math.ceil(minutes / 2)} minutes of shared cleanup in self-chosen “Hot Mess” outfits.`]
    ].map(([title, detail]) => ({ title, detail })),
    { title: `${input.nameB}'s way`, detail: `${input.nameB}'s resolution: ${input.wantB}` }
  ];
}
async function generate(input) {
  const fallback = deck(input);
  if (!ai.key) return { options: fallback, source: `House deck · ${provider} not configured` };
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
    return { options: options.map(({ title, detail }) => ({ title: title.trim(), detail: detail.trim() })), source: `${provider} generated` };
  } catch (error) {
    // Log a bounded failure category, never provider content, credentials or neighbor requests.
    const reason = /^HTTP \d{3}$/.test(error.message) ? error.message : error.name === 'TimeoutError' ? 'timeout' : 'invalid or unavailable response';
    console.warn(`[${provider}] Board generation failed (${reason}); using house deck.`);
    return { options: fallback, source: `House deck · ${provider} unavailable` };
  }
}
async function body(req) {
  let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 12000) fail('Request too large', 413); }
  try { return JSON.parse(data); } catch { fail('Invalid request'); }
}
function view(room, role) { const { ownerKey, guestKey, ...publicRoom } = room; return { ...publicRoom, role }; }
const server = http.createServer(async (req, res) => {
  const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      if (Object.keys(rooms).length >= 10000) fail('The house is full. Ask the host to archive old boards.', 503);
      const raw = await body(req);
      const input = { mode: raw.mode === 'dispute' ? 'dispute' : 'favor', nameA: clean(raw.nameA, 35), nameB: clean(raw.nameB, 35), heat: ['Tease', 'After dark', 'Filthy'].includes(raw.heat) ? raw.heat : 'After dark' };
      if (input.mode === 'favor') input.ask = clean(raw.ask);
      else { input.wantA = clean(raw.wantA); input.wantB = clean(raw.wantB); }
      const generated = await generate(input);
      const room = { id: key(), ownerKey: key(), guestKey: key(), input, ...generated, approved: { owner: false, guest: false }, result: null, createdAt: Date.now() };
      rooms[room.id] = room; save();
      return send(201, { ...view(room, 'owner'), token: room.ownerKey, guestToken: room.guestKey });
    }
    const match = url.pathname.match(/^\/api\/rooms\/([a-f0-9]{36})(?:\/(approve|drop|invite))?$/);
    if (match) {
      const room = rooms[match[1]];
      if (!room) fail('This board could not be found.', 404);
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const role = token === room.ownerKey ? 'owner' : token === room.guestKey ? 'guest' : null;
      if (!role) fail('This invite link is not valid.', 403);
      if (req.method === 'GET' && !match[2]) return send(200, view(room, role));
      if (req.method === 'POST' && match[2] === 'invite' && role === 'owner') return send(200, { guestToken: room.guestKey });
      if (req.method === 'POST' && match[2] === 'approve') { room.approved[role] = true; save(); return send(200, view(room, role)); }
      if (req.method === 'POST' && match[2] === 'drop') {
        if (!room.approved.owner || !room.approved.guest) fail('Both neighbors must approve every outcome first.');
        if (room.input.mode === 'favor' && role !== 'guest') fail('Your neighbor gets to drop this chip.');
        if (room.result === null) { room.result = randomInt(6); room.settledAt = Date.now(); save(); }
        return send(200, view(room, role));
      }
      fail('Action unavailable', 405);
    }
    if (url.pathname.startsWith('/api/')) fail('Not found', 404);
    const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
    const asset = ['/favor', '/dispute', '/board', '/play', '/result'].includes(url.pathname) ? assets['/'] : assets[url.pathname]; if (!asset) fail('Not found', 404);
    res.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(readFileSync(resolve('public', asset[0])));
  } catch (error) { send(error.status || 500, { error: error.status ? error.message : 'The house hit a snag. Please try again.' }); }
});
server.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log(`Bad Neighbors → http://localhost:${process.env.PORT || 3000}`));

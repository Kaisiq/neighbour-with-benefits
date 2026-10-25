const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const form = $('#setup-form');
const canvas = $('#plinko');
const ctx = canvas.getContext('2d');
let mode = 'favor', room = null, token = '', busy = false, animating = false, sound = false, audio;
let chip = null, toastTimer, clockOffset = 0, liveConnected = false, leaving = false;
const clientId = crypto.randomUUID();
let streamController, heartbeat, lastSnapshotAt = 0;
let trail = [], impacts = [], landingAt = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const route = location.pathname;
const page = route === '/favor' || route === '/dispute' ? 'setup' : route === '/board' ? 'review' : route === '/play' ? 'play' : route === '/result' ? 'result' : 'home';
$$('[data-page]').forEach(section => section.hidden = section.dataset.page !== page);
const roomUrl = (path) => `${path}#${room.id}/${token}`;
const titles = { home: 'Лоши съседи — Остави на боговете.', setup: route === '/dispute' ? 'Разреши спор — Лоши съседи' : 'Поискай услуга — Лоши съседи', review: 'Прегледай условията — Лоши съседи', play: 'Пусни жетона — Лоши съседи', result: 'Твоят резултат — Лоши съседи' };
document.title = titles[page];
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3500); }
function error(message = '') { $('#error').textContent = message; $('#error').hidden = !message; }
async function api(path, data, auth = token) {
  const startedAt = Date.now();
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (result.serverTime) clockOffset = result.serverTime - (startedAt + Date.now()) / 2;
  if (!response.ok) throw Error(result.error || 'Нещо се обърка. Опитай отново.'); return result;
}
function setMode(next) {
  mode = next;
  $('#ask-field').hidden = mode !== 'favor'; $('#dispute-fields').hidden = mode !== 'dispute';
  form.elements.ask.required = mode === 'favor'; form.elements.wantA.required = form.elements.wantB.required = mode === 'dispute';
  $('#form-title').innerHTML = mode === 'favor' ? 'Поискай <em>услуга.</em>' : 'Разреши <em>спор.</em>';
  $('#form-description').textContent = mode === 'favor' ? 'Кажи от какво имаш нужда. Ще предложим шест ответни услуги.' : 'Опиши двете страни. Ще добавим четири алтернативни решения.';
}
function renderOptions(options) {
  $('#pockets').replaceChildren(); $('#outcomes').replaceChildren();
  options.forEach((option, index) => {
    const pocket = document.createElement('button'); pocket.type = 'button'; pocket.className = 'pocket'; pocket.title = option.detail;
    pocket.setAttribute('aria-label', `Вариант ${index + 1}: ${option.title}. ${option.detail}`);
    pocket.addEventListener('click', () => {
      if (animating || landingAt) return;
      $('#board-outcome').hidden = false;
      $('#board-outcome').textContent = `${String(index + 1).padStart(2, '0')} · ${option.title} — ${option.detail}`;
      $$('.pocket').forEach((el, i) => el.classList.toggle('inspecting', i === index));
    });
    const number = document.createElement('span'); number.className = 'pocket-number'; number.textContent = `0${index + 1}`;
    const label = document.createElement('span'); label.textContent = option.title;
    pocket.append(number, label); $('#pockets').append(pocket);
    const card = document.createElement('article'); card.className = 'outcome-card';
    const badge = document.createElement('span'); badge.className = 'outcome-number'; badge.textContent = `0${index + 1}`;
    const chance = document.createElement('span'); chance.className = 'chance'; chance.textContent = '1 КЪМ 6';
    const title = document.createElement('h3'); title.textContent = option.title;
    const detail = document.createElement('p'); detail.textContent = option.detail;
    card.append(badge, chance, title, detail); $('#outcomes').append(card);
  });
}
function summary() { return room.input.mode === 'favor' ? `${room.input.nameA} моли ${room.input.nameB}: “${room.input.ask}”` : `${room.input.nameA}: “${room.input.wantA}”\n${room.input.nameB}: “${room.input.wantB}”`; }
function renderRoom() {
  $('#room-summary').textContent = summary();
  $('#room-role').textContent = room.input.mode === 'favor' ? `${room.input.nameA} дължи ответната услуга. ${room.input.nameB} пуска жетона и изпълнява първоначалната молба.` : 'И двете домакинства одобряват. Всяко от тях може да изкуши съдбата.';
  $('#share-button').hidden = room.role !== 'owner'; $('#source-label').textContent = room.source.toUpperCase();
  const mine = room.approved[room.role]; $('#board-consent').disabled = mine; if (mine) $('#board-consent').checked = true;
  $('#approve-button').disabled = mine || !$('#board-consent').checked;
  $('#approve-button').hidden = mine;
  $('#board-consent-label').hidden = mine;
  $('#continue-button').hidden = !mine;
  $('#continue-button').href = roomUrl(room.result === null ? '/play' : '/result');
  $('#continue-button').textContent = room.result === null ? 'Продължи към Плинко →' : 'Виж резултата →';
  $$('.board-review-link').forEach(link => link.href = roomUrl('/board?review=1'));
  $('#approval-list').replaceChildren();
  [['owner', room.input.nameA], ['guest', room.input.nameB]].forEach(([role, name]) => {
    const row = document.createElement('div'), person = document.createElement('span'), status = document.createElement('span');
    person.textContent = `${name}${role === room.role ? ' (ти)' : ''}`; status.textContent = room.approved[role] ? 'Прието ✓' : 'Все още не е прието'; if (room.approved[role]) status.className = 'approved'; row.append(person, status); $('#approval-list').append(row);
  });
  const ready = room.approved.owner && room.approved.guest;
  const watching = room.presence?.owner && room.presence?.guest && liveConnected;
  const canDrop = room.input.mode === 'dispute' || room.role === 'guest';
  const paused = room.spin?.pausedAt != null;
  $('#drop-button').disabled = busy || animating || room.result === null && (!ready || !canDrop || !watching);
  $('#drop-label').textContent = animating ? paused ? 'На пауза — изчакваме съседа' : serverNow() < room.spin.startsAt ? 'Пригответе се…' : 'Нека съдбата реши…' : room.result !== null ? 'Виж резултата' : !watching ? 'Изчакваме и двамата' : !canDrop ? `Пуска ${room.input.nameB}` : 'Пусни жетона';
  $('#board-caption').textContent = 'Шест варианта. Равни шансове.';
  $('#play-instruction').textContent = room.input.mode === 'favor' ? `${room.input.nameB} пуска. ${room.input.nameA} връща услугата.` : 'Едно табло, един и същ резултат и за двамата.';
  $('#presence-list').replaceChildren();
  [['owner', room.input.nameA], ['guest', room.input.nameB]].forEach(([role, name]) => {
    const item = document.createElement('span');
    const online = room.presence?.[role] && (role !== room.role || liveConnected);
    item.className = `presence-person${online ? ' online' : ''}`;
    item.textContent = `${name} · ${online ? 'на линия' : 'изчакваме'}`;
    $('#presence-list').append(item);
  });
  $('#play-status').textContent = !liveConnected ? 'Свързваме ви…' : paused ? 'Играта продължава, когато и двамата отново гледате таблото.' : !watching ? 'Отворете играта и оставете двата екрана активни.' : !canDrop && !animating ? 'Гледате заедно. Съседът ти пуска жетона.' : 'Гледате заедно в реално време.';
  if (room.result !== null && !animating && !spinPending(room)) highlight(room.result);
  if (page === 'result' && room.result !== null) renderResult();
}
const serverNow = () => Date.now() + clockOffset;
function spinPending(state) {
  return state.spin && !state.spin.finishedAt;
}
function receiveRoom(state) {
  if (state.serverTime < lastSnapshotAt || room?.result != null && state.result === null) return;
  lastSnapshotAt = state.serverTime || 0; room = state;
  const ready = room.approved.owner && room.approved.guest;
  if (page === 'review' && ready && (room.result === null || spinPending(room)) && !new URLSearchParams(location.search).has('review')) {
    location.replace(roomUrl('/play')); return;
  }
  if (page === 'result' && (room.result === null || spinPending(room))) { location.replace(roomUrl(room.result === null ? '/board' : '/play')); return; }
  // Completion must not depend on animation frames, which background browsers can suspend.
  if (page === 'play' && room.result !== null && !spinPending(room)) { showResult(); return; }
  renderRoom();
  if (page === 'play' && room.result !== null && !animating) {
    if (spinPending(room)) animateDrop(room.result);
    else showResult();
  }
}
async function updatePresence() {
  if (!room || leaving || !liveConnected) return;
  try { await api(`/api/rooms/${room.id}/presence`, { clientId, screen: page, visible: !document.hidden }); }
  catch { liveConnected = false; renderRoom(); streamController?.abort(); }
}
async function connectLive() {
  if (!room || leaving || !['review', 'play'].includes(page)) return;
  streamController = new AbortController();
  try {
    const response = await fetch(`/api/rooms/${room.id}/events?clientId=${clientId}`, { headers: { Authorization: `Bearer ${token}` }, signal: streamController.signal });
    if (!response.ok || !response.body) throw Error('Live connection unavailable');
    liveConnected = true; renderRoom();
    await updatePresence();
    clearInterval(heartbeat); heartbeat = setInterval(updatePresence, 1000);
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    while (!leaving) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        if (event.startsWith('data: ')) receiveRoom(JSON.parse(event.slice(6)));
      }
    }
  } catch { /* Reconnect and resume the authoritative timeline after an interruption. */ }
  finally {
    clearInterval(heartbeat); liveConnected = false;
    if (!leaving) { renderRoom(); setTimeout(connectLive, 1000); }
  }
}
document.addEventListener('visibilitychange', updatePresence);
window.addEventListener('pagehide', () => { leaving = true; clearInterval(heartbeat); streamController?.abort(); });

function highlight(index) { $$('.pocket').forEach((el, i) => el.classList.toggle('winner', i === index)); $$('.outcome-card').forEach((el, i) => el.classList.toggle('selected', i === index)); }
async function loadRoom(id, secret) {
  try {
    token = secret;
    const initial = await api(`/api/rooms/${id}`);
    setMode(initial.input.mode); renderOptions(initial.options); receiveRoom(initial);
    draw(); connectLive();
  } catch (err) { error(err.message); toast(err.message); }
}
form.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return; busy = true; error();
  $('#generate').disabled = true; $('#generate').textContent = 'Подготвяме последствията…';
  try {
    const data = Object.fromEntries(new FormData(form));
    const created = await api('/api/rooms', { ...data, mode, heat: 'Filthy' }, '');
    token = created.token; room = created;
    location.assign(roomUrl('/board'));
  } catch (err) { error(err.message); }
  finally { busy = false; $('#generate').disabled = false; $('#generate').innerHTML = '<span>Създай нашето табло</span><span>→</span>'; }
});
$('#board-consent').addEventListener('change', renderRoom);
$('#approve-button').addEventListener('click', async () => {
  if (!$('#board-consent').checked || busy) return; busy = true;
  try { receiveRoom(await api(`/api/rooms/${room.id}/approve`, {})); toast('Условията са приети. Изчакваме и двамата.'); }
  catch (err) { error(err.message); } finally { busy = false; }
});
$('#share-button').addEventListener('click', async () => {
  try {
    const { guestToken } = await api(`/api/rooms/${room.id}/invite`, {});
    const link = `${location.origin}/board#${room.id}/${guestToken}`;
    try { await navigator.clipboard.writeText(link); toast('Личната покана е копирана. Изпрати я на съседа.'); }
    catch { window.prompt('Копирай тази лична покана за съседа:', link); }
  } catch (err) { error(err.message); }
});
$('#rules-button').addEventListener('click', () => $('#rules-dialog').showModal());
$$('.close-dialog, .close-rules').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$$('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
$('#sound-button').addEventListener('click', () => { sound = !sound; $('#sound-button').textContent = sound ? 'Със звук ♫' : 'Без звук ♩'; $('#sound-button').setAttribute('aria-pressed', String(sound)); if (sound) { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume().catch(() => {}); ping(600); } });
function ping(frequency = 450) {
  if (!sound || !audio) return;
  const oscillator = audio.createOscillator(), volume = audio.createGain(); oscillator.connect(volume); volume.connect(audio.destination); oscillator.type = 'sine'; oscillator.frequency.value = frequency; volume.gain.setValueAtTime(.035, audio.currentTime); volume.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .13); oscillator.start(); oscillator.stop(audio.currentTime + .14);
}
function showResult() {
  if (!room || room.result === null) return;
  location.assign(roomUrl('/result'));
}
function renderResult() {
  $('#result-title').textContent = room.options[room.result].title; $('#result-detail').textContent = room.options[room.result].detail;
  $('#result-original').textContent = summary();
}
const pegRows = 10;
function pegPositions(row) {
  const count = row % 2 ? 5 : 6;
  return Array.from({ length: count }, (_, col) => (col + (row % 2 ? 1 : .5)) / 6);
}
function draw() {
  const width = canvas.clientWidth, height = canvas.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (!width || !height) return;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  const now = performance.now(), usable = width - 34;
  const px = x => 17 + x * usable;
  const glow = (x, y, radius, color) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color); gradient.addColorStop(1, '#ee405600');
    ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  };
  ctx.strokeStyle = '#aa445019'; ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(px(i / 6), 48); ctx.lineTo(px(i / 6), height); ctx.stroke(); }
  for (let row = 0; row < pegRows; row++) {
    const y = (.2 + row * .071) * height;
    for (const x of pegPositions(row)) {
      const hit = impacts.findLast(impact => impact.row === row && Math.abs(impact.x - x) < .01);
      const intensity = hit ? Math.max(0, 1 - (now - hit.at) / 650) : 0;
      if (intensity) glow(px(x), y, 23 * intensity, `rgba(255,75,111,${intensity * .5})`);
      ctx.beginPath(); ctx.arc(px(x), y, intensity ? 4.1 : 3.3, 0, Math.PI * 2); ctx.fillStyle = intensity ? '#ffd4df' : '#986578'; ctx.fill();
      ctx.beginPath(); ctx.arc(px(x) - .7, y - 1, 1.1, 0, Math.PI * 2); ctx.fillStyle = '#f4c6d3'; ctx.fill();
    }
  }
  if (!reducedMotion.matches) for (const impact of impacts) {
    const age = (now - impact.at) / 500; if (age < 0 || age > 1) continue;
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3 + impact.row;
      ctx.globalAlpha = 1 - age; ctx.fillStyle = i % 2 ? '#f9bd91' : '#ff658b';
      ctx.fillRect(px(impact.x) + Math.cos(angle) * age * 25, (.2 + impact.row * .071) * height + Math.sin(angle) * age * 19 + age * age * 12, 2, 2);
    }
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i <= 6; i++) { ctx.strokeStyle = '#914456'; ctx.beginPath(); ctx.moveTo(px(i / 6), height - 20); ctx.lineTo(px(i / 6), height); ctx.stroke(); }
  if (trail.length > 1 && !reducedMotion.matches) {
    for (let i = 1; i < trail.length; i++) {
      ctx.beginPath(); ctx.moveTo(px(trail[i - 1].x), trail[i - 1].y * height); ctx.lineTo(px(trail[i].x), trail[i].y * height);
      ctx.strokeStyle = `rgba(255,99,135,${i / trail.length * .65})`; ctx.lineWidth = 1 + i / trail.length * 5; ctx.lineCap = 'round'; ctx.stroke();
    }
  }
  const x = px(chip ? chip.x : .5), y = chip ? chip.y * height : 24;
  glow(x, y, 35, '#fa4d7966');
  const ball = ctx.createRadialGradient(x - 3, y - 4, 1, x, y, 10); ball.addColorStop(0, '#fff1d8'); ball.addColorStop(.4, '#f1c29b'); ball.addColorStop(1, '#a74e4a');
  ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fillStyle = ball; ctx.fill(); ctx.strokeStyle = '#ffdcbd'; ctx.lineWidth = 1.3; ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.strokeStyle = '#ad624f'; ctx.lineWidth = .7; ctx.stroke();
  if (landingAt && !reducedMotion.matches) {
    const age = Math.min(1, (now - landingAt) / 1000);
    ctx.strokeStyle = `rgba(255,168,190,${1 - age})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 10 + age * 55, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 24; i++) {
      const angle = i * 2.39996; ctx.globalAlpha = 1 - age;
      ctx.fillStyle = i % 3 ? '#f9648a' : '#f9d29c';
      ctx.fillRect(x + Math.cos(angle) * age * 85, y - Math.abs(Math.sin(angle)) * age * 85 + age * age * 45, 3, 5);
    }
    ctx.globalAlpha = 1;
  }
}
function animateDrop(index) {
  if (page !== 'play' || animating) return;
  animating = true; trail = []; impacts = []; landingAt = 0;
  $('.board-wrap').classList.add('dropping');
  $$('.pocket').forEach(el => el.classList.remove('inspecting'));
  $('#board-outcome').hidden = true;
  renderRoom();
  const path = room.spin.path, target = (index + .5) / 6;
  let lastStep = -1, landed = false, disconnectedAt = null;
  function frame() {
    const spin = room.spin;
    if (!liveConnected && disconnectedAt === null) disconnectedAt = serverNow();
    if (liveConnected) disconnectedAt = null;
    const time = spin.pausedAt ?? disconnectedAt ?? serverNow();
    const progress = Math.max(0, Math.min(1, (time - spin.startsAt) / spin.duration));
    const travel = progress < .73 ? progress * 1.12 : .8176 + (progress - .73) / .27 * .1824;
    const pos = Math.min(path.length - 1, travel * (path.length - 1));
    const step = Math.min(path.length - 2, Math.floor(pos)), fraction = pos - step;
    const from = path[step], to = path[step + 1];
    chip = { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction * fraction - (step ? Math.sin(fraction * Math.PI) * .017 : 0) };
    canvas.dataset.progress = progress.toFixed(3);
    canvas.dataset.position = `${chip.x.toFixed(4)},${chip.y.toFixed(4)}`;
    canvas.dataset.paused = String(spin.pausedAt != null || !liveConnected);
    if (time < spin.startsAt && spin.pausedAt == null && liveConnected) $('#drop-label').textContent = `Започваме след ${Math.max(1, Math.ceil((spin.startsAt - time) / 1000))}…`;
    if (step !== lastStep && spin.pausedAt == null && liveConnected) {
      if (step > 0) { impacts.push({ row: step - 1, x: from.x, at: performance.now() }); ping(470 + step * 38); }
      lastStep = step;
    }
    if (spin.pausedAt == null && liveConnected) { trail.push({ ...chip }); if (trail.length > 14) trail.shift(); }
    if (progress >= 1 && !landed) {
      landed = true; chip = { x: target, y: .97 }; trail = []; landingAt = performance.now();
      highlight(index); $('.board-wrap').classList.remove('dropping'); $('.board-wrap').classList.add('landed');
      $('#board-outcome').hidden = false;
      $('#board-outcome').textContent = `${String(index + 1).padStart(2, '0')} · ${room.options[index].title}`;
      $('#board-outcome').classList.add('revealed');
      [0, 110, 220].forEach((delay, i) => setTimeout(() => ping([659, 831, 988][i]), delay));
    }
    draw();
    if (spin.finishedAt && liveConnected) { animating = false; showResult(); }
    else requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
$('#drop-button').addEventListener('click', async () => {
  if (!room || busy || animating) return;
  if (room.result !== null) return showResult();
  busy = true; renderRoom();
  try { receiveRoom(await api(`/api/rooms/${room.id}/drop`, {})); }
  catch (err) { error(err.message); }
  finally { busy = false; renderRoom(); }
});
window.addEventListener('hashchange', () => location.reload());
new ResizeObserver(() => draw()).observe(canvas);
setMode(route === '/dispute' ? 'dispute' : 'favor');
const parts = location.hash.slice(1).split('/');
if (parts.length === 2 && parts.every(p => /^[a-f0-9]{36}$/.test(p))) {
  if (page === 'home' || page === 'setup') location.replace(`/board${location.hash}`);
  else loadRoom(parts[0], parts[1]);
}
else if (location.hash) error('Поканата изглежда непълна. Поискай целия линк от съседа.');
else if (['review', 'play', 'result'].includes(page)) error('Отвори покана от съсед или създай ново табло от началната страница.');

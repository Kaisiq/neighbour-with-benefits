const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const form = $('#setup-form');
const canvas = $('#plinko');
const ctx = canvas.getContext('2d');
let mode = 'favor', room = null, token = '', busy = false, animating = false, sound = false, audio;
let seenResult = null, chip = null, toastTimer, lastPoll = 0;
let launchX = .5, trail = [], impacts = [], landingAt = 0;
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
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json(); if (!response.ok) throw Error(result.error || 'Нещо се обърка. Опитай отново.'); return result;
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
  $$('.board-review-link').forEach(link => link.href = roomUrl('/board'));
  $('#approval-list').replaceChildren();
  [['owner', room.input.nameA], ['guest', room.input.nameB]].forEach(([role, name]) => {
    const row = document.createElement('div'), person = document.createElement('span'), status = document.createElement('span');
    person.textContent = `${name}${role === room.role ? ' (ти)' : ''}`; status.textContent = room.approved[role] ? 'Прието ✓' : 'Все още не е прието'; if (room.approved[role]) status.className = 'approved'; row.append(person, status); $('#approval-list').append(row);
  });
  const ready = room.approved.owner && room.approved.guest;
  const canDrop = room.input.mode === 'dispute' || room.role === 'guest';
  $('#launch-position').disabled = busy || animating || room.result !== null || !ready || !canDrop;
  $('#board-state').textContent = animating ? 'СЪДБАТА СИ ИГРАЕ С ТЕБ…' : room.result !== null ? 'БОГОВЕТЕ СЕ ПРОИЗНЕСОХА' : ready && canDrop ? 'ИЗБЕРИ НАЧАЛНА ПОЗИЦИЯ' : 'ОЧАКВАМЕ СЪСЕДИТЕ';
  $('#drop-button').disabled = animating || room.result === null && (!ready || !canDrop);
  $('#drop-label').textContent = animating ? 'Нека съдбата реши…' : room.result !== null ? 'Виж резултата' : !ready ? 'Изчакваме одобрение' : !canDrop ? `Изчакваме ${room.input.nameB}` : 'Пусни жетона';
  $('#board-caption').textContent = room.result !== null ? 'Един запазен резултат. Без повторно пускане.' : 'Всеки резултат има шанс 1 към 6.';
  $('#play-instruction').textContent = room.input.mode === 'favor' ? `${room.input.nameB} пуска. ${room.input.nameA} дължи ответната услуга.` : `${room.input.nameA} и ${room.input.nameB}. Съдбата има последната дума.`;
  $('#play-status').replaceChildren();
  if (!ready) {
    $('#play-status').append(document.createTextNode(!mine ? 'Все още трябва да одобриш вариантите. ' : `Изчакваме одобрение от ${room.role === 'owner' ? room.input.nameB : room.input.nameA}. `));
    const link = document.createElement('a'); link.href = roomUrl('/board'); link.textContent = 'Прегледай таблото'; $('#play-status').append(link);
  } else if (!canDrop) $('#play-status').textContent = 'Съседът ти управлява играта. Неговото пускане ще се появи тук.';
  if (room.result !== null && !animating) highlight(room.result);
  if (page === 'result' && room.result !== null) renderResult();
}
function highlight(index) { $$('.pocket').forEach((el, i) => el.classList.toggle('winner', i === index)); $$('.outcome-card').forEach((el, i) => el.classList.toggle('selected', i === index)); }
async function loadRoom(id, secret) {
  try {
    token = secret; room = await api(`/api/rooms/${id}`); setMode(room.input.mode); renderOptions(room.options); renderRoom();
    seenResult = room.result;
    if (page === 'result' && room.result === null) return location.replace(roomUrl('/board'));
    if (page === 'play' && room.result !== null) return showResult();
    if (room.result !== null) { chip = { x: (room.result + .5) / 6, y: .98 }; draw(); }
    else { chip = null; draw(); }
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
  try { room = await api(`/api/rooms/${room.id}/approve`, {}); renderRoom(); toast('Условията са приети. Можеш да продължиш.'); }
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
function moveLaunch(value) {
  if (!room || $('#launch-position').disabled || animating) return;
  launchX = Math.max(.25, Math.min(.75, value));
  $('#launch-position').value = String(Math.round(launchX * 100));
  chip = null; draw();
}
$('#launch-position').addEventListener('input', event => moveLaunch(Number(event.target.value) / 100));
canvas.addEventListener('pointerdown', event => {
  if ($('#launch-position').disabled) return;
  canvas.setPointerCapture(event.pointerId);
  moveLaunch((event.clientX - canvas.getBoundingClientRect().left - 17) / (canvas.clientWidth - 34));
});
canvas.addEventListener('pointermove', event => {
  if (canvas.hasPointerCapture(event.pointerId)) moveLaunch((event.clientX - canvas.getBoundingClientRect().left - 17) / (canvas.clientWidth - 34));
});
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
  if (!animating && !landingAt && !$('#launch-position').disabled) {
    ctx.setLineDash([2, 6]); ctx.strokeStyle = '#ed7a9460'; ctx.beginPath(); ctx.moveTo(px(launchX), 30); ctx.lineTo(px(launchX), 65); ctx.stroke(); ctx.setLineDash([]);
  }
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
  const x = px(chip ? chip.x : launchX), y = chip ? chip.y * height : 24;
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
  if (page !== 'play') { renderRoom(); return; }
  animating = true; trail = []; impacts = []; landingAt = 0;
  $('.board-wrap').classList.add('dropping');
  $$('.pocket').forEach(el => el.classList.remove('inspecting'));
  $('#board-outcome').textContent = 'Един жетон. Шест възможности. Няма връщане назад.';
  renderRoom();
  const start = performance.now(), reduced = reducedMotion.matches;
  const duration = reduced ? 180 : 4300, target = (index + .5) / 6;
  // A route through real peg coordinates reveals the server's equal-odds draw.
  // Starting position changes the animation, not the probability or saved result.
  const path = [{ x: launchX, y: .065 }];
  for (let row = 0; row < pegRows; row++) {
    const progress = (row + 1) / (pegRows + 1);
    const desired = launchX + (target - launchX) * progress + (Math.random() - .5) * .22 * Math.sin(progress * Math.PI);
    const x = pegPositions(row).reduce((best, candidate) => Math.abs(candidate - desired) < Math.abs(best - desired) ? candidate : best);
    path.push({ x, y: .2 + row * .071 - .027 });
  }
  path.push({ x: target, y: .97 });
  let lastStep = -1;
  function frame(now) {
    const progress = Math.max(0, Math.min(1, (now - start) / duration));
    // Slow the last two rebounds for a little suspense at the pocket dividers.
    const travel = progress < .73 ? progress * 1.12 : .8176 + (progress - .73) / .27 * .1824;
    const pos = Math.min(path.length - 1, travel * (path.length - 1));
    const step = Math.min(path.length - 2, Math.floor(pos)), fraction = pos - step;
    const from = path[step], to = path[step + 1];
    chip = { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction * fraction - (step ? Math.sin(fraction * Math.PI) * .017 : 0) };
    if (step !== lastStep) {
      if (step > 0) { impacts.push({ row: step - 1, x: from.x, at: now }); ping(470 + step * 38); }
      lastStep = step;
    }
    trail.push({ ...chip }); if (trail.length > 14) trail.shift();
    draw();
    if (progress < 1) requestAnimationFrame(frame);
    else {
      chip = { x: target, y: .97 }; trail = []; landingAt = performance.now();
      animating = false; highlight(index); renderRoom();
      $('.board-wrap').classList.remove('dropping'); $('.board-wrap').classList.add('landed');
      $('#board-outcome').textContent = `${String(index + 1).padStart(2, '0')} · ${room.options[index].title}`;
      $('#board-outcome').classList.add('revealed');
      $('#board-state').textContent = 'ЕТО ТВОЯТА СЪДБА';
      [0, 110, 220].forEach((delay, i) => setTimeout(() => ping([659, 831, 988][i]), delay));
      const revealStart = performance.now();
      function reveal(now) { draw(); if (now - revealStart < (reduced ? 250 : 1600)) requestAnimationFrame(reveal); else showResult(); }
      requestAnimationFrame(reveal);
    }
  }
  requestAnimationFrame(frame);
}
$('#drop-button').addEventListener('click', async () => {
  if (!room || busy || animating) return;
  if (room.result !== null) return showResult(); busy = true; $('#drop-button').disabled = true; $('#launch-position').disabled = true;
  try { room = await api(`/api/rooms/${room.id}/drop`, {}); seenResult = room.result; animateDrop(room.result); }
  catch (err) { error(err.message); } finally { busy = false; if (!animating) renderRoom(); }
});
setInterval(async () => {
  if (!room || busy || animating || document.hidden || room.result !== null || Date.now() - lastPoll < 1800) return;
  lastPoll = Date.now(); const id = room.id;
  try {
    const updated = await api(`/api/rooms/${id}`); if (room?.id !== id || busy || animating) return;
    room = updated;
    if (room.result !== null && seenResult === null) { seenResult = room.result; animateDrop(room.result); }
    else renderRoom();
  } catch { /* Retain the board through temporary connection failures. */ }
}, 2000);
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

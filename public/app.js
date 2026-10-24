const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const form = $('#setup-form');
const canvas = $('#plinko');
const ctx = canvas.getContext('2d');
let mode = 'favor', heat = 'After dark', room = null, token = '', busy = false, animating = false, sound = false, audio;
let seenResult = null, chip = null, toastTimer, lastPoll = 0;
const preview = [
  { title: 'Domestic service', detail: 'A little elbow grease. A very suggestive apron. Your neighbor’s kitchen has never felt so appreciated.' },
  { title: 'Breakfast after dark', detail: 'Breakfast delivered with a menu reading that would get you fired from a respectable restaurant.' },
  { title: 'Dirty laundry', detail: 'Their laundry, your problem. Dress like you’re auditioning for a very questionable housekeeping service.' },
  { title: 'Walk of shame', detail: 'Take out the bins. Clean the landing. Wear the title with a deeply inappropriate amount of pride.' },
  { title: 'Personal temptation', detail: 'A few household errands, opened by a fully clothed cabaret performance nobody asked to remember.' },
  { title: 'Scrub me harder', detail: 'Bathroom cleaning with a ridiculous adult-film introduction. All clothes stay on. All grime comes off.' }
];
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3500); }
function error(message = '') { $('#error').textContent = message; $('#error').hidden = !message; }
async function api(path, data, auth = token) {
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json(); if (!response.ok) throw Error(result.error || 'Something went wrong. Try again.'); return result;
}
function setMode(next) {
  mode = next;
  $$('[data-mode]').forEach(button => { button.classList.toggle('active', button.dataset.mode === mode); button.setAttribute('aria-pressed', String(button.dataset.mode === mode)); });
  $('#ask-field').hidden = mode !== 'favor'; $('#dispute-fields').hidden = mode !== 'dispute';
  form.elements.ask.required = mode === 'favor'; form.elements.wantA.required = form.elements.wantB.required = mode === 'dispute';
  $('#form-title').textContent = mode === 'favor' ? 'Neighbor with benefits.' : 'Settle the tension.';
  $('#form-description').textContent = mode === 'favor' ? 'You ask. They play. You return the favor. How badly do you want it?' : 'Two sides. Six outcomes. One drop. Leave your little disagreement to the gods.';
}
$$('[data-mode]').forEach(button => button.addEventListener('click', () => { if (!room) setMode(button.dataset.mode); }));
$$('[data-heat]').forEach(button => button.addEventListener('click', () => { heat = button.dataset.heat; $$('[data-heat]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); }); }));
function renderOptions(options) {
  $('#pockets').replaceChildren(); $('#outcomes').replaceChildren();
  options.forEach((option, index) => {
    const pocket = document.createElement('div'); pocket.className = 'pocket'; pocket.title = option.detail;
    const number = document.createElement('span'); number.className = 'pocket-number'; number.textContent = `0${index + 1}`;
    const label = document.createElement('span'); label.textContent = option.title;
    pocket.append(number, label); $('#pockets').append(pocket);
    const card = document.createElement('article'); card.className = 'outcome-card';
    const badge = document.createElement('span'); badge.className = 'outcome-number'; badge.textContent = `0${index + 1}`;
    const chance = document.createElement('span'); chance.className = 'chance'; chance.textContent = '1 IN 6';
    const title = document.createElement('h3'); title.textContent = option.title;
    const detail = document.createElement('p'); detail.textContent = option.detail;
    card.append(badge, chance, title, detail); $('#outcomes').append(card);
  });
}
function summary() { return room.input.mode === 'favor' ? `${room.input.nameA} asks ${room.input.nameB}: “${room.input.ask}”` : `${room.input.nameA}: “${room.input.wantA}”\n${room.input.nameB}: “${room.input.wantB}”`; }
function renderRoom() {
  form.hidden = true; $('#room-controls').hidden = false;
  $$('[data-mode]').forEach(b => b.disabled = true);
  $('#room-summary').textContent = summary();
  $('#room-role').textContent = room.input.mode === 'favor' ? `${room.input.nameA} owes the return favor. ${room.input.nameB} drops the chip and fulfills the original request.` : 'Both households approve. Either one can tempt fate.';
  $('#share-button').hidden = room.role !== 'owner'; $('#source-label').textContent = room.source.toUpperCase();
  $('#board-badge').replaceChildren(); const dot = document.createElement('span'); dot.className = 'live-dot'; $('#board-badge').append(dot, document.createTextNode(room.result !== null ? 'SETTLED BY THE GODS' : 'LIVE BOARD'));
  const mine = room.approved[room.role]; $('#board-consent').disabled = mine; if (mine) $('#board-consent').checked = true;
  $('#approve-button').disabled = mine || !$('#board-consent').checked;
  $('#approve-button').textContent = mine ? 'Your stakes are accepted ✓' : 'Accept the stakes ♡';
  $('#approval-list').replaceChildren();
  [['owner', room.input.nameA], ['guest', room.input.nameB]].forEach(([role, name]) => {
    const row = document.createElement('div'), person = document.createElement('span'), status = document.createElement('span');
    person.textContent = `${name}${role === room.role ? ' (you)' : ''}`; status.textContent = room.approved[role] ? 'Accepted ✓' : 'Not yet accepted'; if (room.approved[role]) status.className = 'approved'; row.append(person, status); $('#approval-list').append(row);
  });
  const ready = room.approved.owner && room.approved.guest;
  const canDrop = room.input.mode === 'dispute' || room.role === 'guest';
  $('#drop-button').disabled = animating || room.result === null && (!ready || !canDrop);
  $('#drop-label').textContent = animating ? 'The gods are making a terrible decision…' : room.result !== null ? 'See what the gods decided' : !ready ? 'Waiting for both neighbors to accept' : !canDrop ? `Waiting for ${room.input.nameB} to drop` : 'Drop it like it’s hot';
  $('#board-caption').textContent = room.result !== null ? 'Settled. This board cannot be rerolled.' : 'All six outcomes have equal odds. Read them before accepting.';
  if (room.result !== null && !animating) highlight(room.result);
}
function highlight(index) { $$('.pocket').forEach((el, i) => el.classList.toggle('winner', i === index)); $$('.outcome-card').forEach((el, i) => el.classList.toggle('selected', i === index)); }
async function loadRoom(id, secret) {
  try {
    token = secret; room = await api(`/api/rooms/${id}`); setMode(room.input.mode); renderOptions(room.options); renderRoom();
    seenResult = room.result;
    if (room.result !== null) { chip = { x: (room.result + .5) / 6, y: .98 }; draw(); }
    else { chip = null; draw(); }
  } catch (err) { error(err.message); toast(err.message); }
}
form.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return; busy = true; error();
  $('#generate').disabled = true; $('#generate').textContent = 'Dealing your consequences…';
  try {
    const data = Object.fromEntries(new FormData(form));
    const created = await api('/api/rooms', { ...data, mode, heat }, '');
    token = created.token; room = created; seenResult = null; chip = null;
    history.replaceState(null, '', `#${room.id}/${token}`);
    renderOptions(room.options); renderRoom(); draw();
    toast('Board dealt. Review all six outcomes, then invite your neighbor.');
    if (window.innerWidth < 721) $('.stakes-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { error(err.message); }
  finally { busy = false; $('#generate').disabled = false; $('#generate').innerHTML = '<span>Deal me a little trouble</span><span>↗</span>'; }
});
$('#board-consent').addEventListener('change', renderRoom);
$('#approve-button').addEventListener('click', async () => {
  if (!$('#board-consent').checked || busy) return; busy = true;
  try { room = await api(`/api/rooms/${room.id}/approve`, {}); renderRoom(); toast('Accepted. Your neighbor needs to accept too.'); }
  catch (err) { error(err.message); } finally { busy = false; }
});
$('#share-button').addEventListener('click', async () => {
  try {
    const { guestToken } = await api(`/api/rooms/${room.id}/invite`, {});
    const link = `${location.origin}/#${room.id}/${guestToken}`;
    try { await navigator.clipboard.writeText(link); toast('Private invite copied. Send it to your neighbor.'); }
    catch { window.prompt('Copy this private neighbor invite:', link); }
  } catch (err) { error(err.message); }
});
$('#new-board').addEventListener('click', () => { location.href = '/'; });
$('#rules-button').addEventListener('click', () => $('#rules-dialog').showModal());
$$('.close-dialog, .close-rules').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$$('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
$('#sound-button').addEventListener('click', () => { sound = !sound; $('#sound-button').textContent = sound ? 'Sound on ♫' : 'Sound off ♩'; $('#sound-button').setAttribute('aria-pressed', String(sound)); if (sound) { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume().catch(() => {}); ping(600); } });
function ping(frequency = 450) {
  if (!sound || !audio) return;
  const oscillator = audio.createOscillator(), volume = audio.createGain(); oscillator.connect(volume); volume.connect(audio.destination); oscillator.type = 'sine'; oscillator.frequency.value = frequency; volume.gain.setValueAtTime(.035, audio.currentTime); volume.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .13); oscillator.start(); oscillator.stop(audio.currentTime + .14);
}
function showResult() {
  if (!room || room.result === null) return;
  $('#result-title').textContent = room.options[room.result].title; $('#result-detail').textContent = room.options[room.result].detail;
  $('#result-original').textContent = summary(); if (!$('#result-dialog').open) $('#result-dialog').showModal();
}
function draw() {
  const width = canvas.clientWidth, height = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  const margin = 23, usable = width - margin * 2;
  // The server draws a uniform outcome; the chip is its illustrative reveal, not a physics-based RNG.
  for (let row = 0; row < 9; row++) {
    const count = row + 3, y = 65 + row * ((height - 93) / 9), spread = usable * (row + 3) / 11;
    for (let col = 0; col < count; col++) {
      const x = width / 2 - spread / 2 + col * spread / (count - 1);
      ctx.beginPath(); ctx.arc(x, y, 3.1, 0, Math.PI * 2); ctx.fillStyle = '#a66d80'; ctx.shadowColor = '#f28ca555'; ctx.shadowBlur = 7; ctx.fill(); ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(x - .6, y - .8, 1.05, 0, Math.PI * 2); ctx.fillStyle = '#e2b4c2'; ctx.fill();
    }
  }
  ctx.strokeStyle = '#713247'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(width * .5 - 26, 8); ctx.lineTo(width * .5 - 17, 28); ctx.lineTo(width * .5 - 17, 39); ctx.moveTo(width * .5 + 26, 8); ctx.lineTo(width * .5 + 17, 28); ctx.lineTo(width * .5 + 17, 39); ctx.stroke();
  for (let i = 0; i <= 6; i++) { const x = 17 + (width - 34) * i / 6; ctx.beginPath(); ctx.moveTo(x, height - 20); ctx.lineTo(x, height); ctx.stroke(); }
  const x = chip ? 17 + chip.x * (width - 34) : width / 2;
  const y = chip ? chip.y * height : 20;
  const glow = ctx.createRadialGradient(x, y, 2, x, y, 28); glow.addColorStop(0, '#f6577580'); glow.addColorStop(1, '#f6577500'); ctx.fillStyle = glow; ctx.fillRect(x - 28, y - 28, 56, 56);
  const ball = ctx.createRadialGradient(x - 2, y - 3, 1, x, y, 9); ball.addColorStop(0, '#ffe5cb'); ball.addColorStop(.4, '#efb894'); ball.addColorStop(1, '#b64b48');
  ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fillStyle = ball; ctx.fill(); ctx.strokeStyle = '#ffc9ad'; ctx.lineWidth = 1; ctx.stroke();
}
function animateDrop(index) {
  animating = true; renderRoom();
  const start = performance.now(), reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduced ? 100 : 3400, target = (index + .5) / 6;
  const path = [.5];
  for (let row = 1; row <= 10; row++) {
    const progress = row / 10;
    path.push(Math.max(.04, Math.min(.96, .5 + (target - .5) * progress + (row === 10 ? 0 : (Math.random() - .5) * .13))));
  }
  let lastStep = -1;
  function frame(now) {
    const progress = Math.min(1, (now - start) / duration), pos = progress * 10, step = Math.min(9, Math.floor(pos)), fraction = pos - step;
    chip = { x: path[step] + (path[step + 1] - path[step]) * fraction, y: .065 + progress * .9 - Math.sin(fraction * Math.PI) * .018 };
    if (step !== lastStep) { ping(350 + step * 48); lastStep = step; }
    draw();
    if (progress < 1) requestAnimationFrame(frame);
    else { chip = { x: target, y: .98 }; animating = false; highlight(index); draw(); renderRoom(); ping(1050); setTimeout(showResult, 400); }
  }
  requestAnimationFrame(frame);
}
$('#drop-button').addEventListener('click', async () => {
  if (!room || busy || animating) return;
  if (room.result !== null) return showResult(); busy = true; $('#drop-button').disabled = true;
  try { room = await api(`/api/rooms/${room.id}/drop`, {}); seenResult = room.result; animateDrop(room.result); }
  catch (err) { error(err.message); renderRoom(); } finally { busy = false; }
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
new ResizeObserver(draw).observe(canvas);
renderOptions(preview); setMode('favor');
const parts = location.hash.slice(1).split('/');
if (parts.length === 2 && parts.every(p => /^[a-f0-9]{36}$/.test(p))) loadRoom(parts[0], parts[1]);
else if (location.hash) error('That invite link looks incomplete. Ask your neighbor for the full link.');

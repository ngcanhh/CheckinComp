import { demoRequest } from './demo.js';
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
let mode = 'server', state, signedIn = false, attendees = [], search = '', filter = 'all', receipt;
let refreshing = false, lastRefresh = 0, disconnected = false;
const pending = new Set();
const main = $('#main');
const isOrganizer = () => location.hash === '#organizer';
async function api(path, method = 'GET', input) {
  if (mode === 'demo') return demoRequest(path, method, input);
  let response;
  try {
    response = await fetch(new URL(`./api/${path}`, location.href), {
      method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(12000),
      ...(input === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
    });
  } catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('The server returned an unexpected response. Please try again.'); }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { status: response.status });
  return data;
}
let toastTimer;
function toast(message, warning = false) {
  const element = $('#toast'); element.textContent = message; element.className = warning ? 'warning' : ''; element.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.hidden = true; }, warning ? 10000 : 5500);
}
function errorAt(selector, message) { const node = $(selector); node.textContent = message; node.hidden = false; }
const eventDetails = () => `<div class="event-details"><div><span class="detail-label">WHEN</span><strong>${esc(state.event.day)} · ${esc(state.event.time)}</strong><span>${esc(state.event.dateNote)} · Singapore time</span></div><div><span class="detail-label">WHERE</span><strong>${esc(state.event.venue)}</strong><span>Bring your student ID</span></div></div>`;
function renderSignup() {
  document.title = 'Study Break Night · Sign up';
  const open = state.signupOpen;
  main.innerHTML = `<div class="signup-layout"><section class="event-panel" aria-label="Event details">
    <div class="event-topline"><span class="eyebrow">A BREAK BEFORE FINALS</span><span class="edition">01 / CAMPUS NIGHT</span></div>
    <h1>Study<br> Break<br> <span>Night.</span></h1>
    <p class="event-intro">Bubble tea, snacks, and a moment<br class="desktop-only"> to catch your breath.</p>
    ${eventDetails()}<div class="event-bottom"><span class="cup-symbol" aria-hidden="true">✳</span><div><strong>150 cups. One per student.</strong><span>Reserve yours when you sign up, while stock lasts.</span></div></div>
  </section><section class="registration-panel" aria-labelledby="signup-title">${receipt ? receiptHtml() : `
    <div class="section-kicker"><span class="status-pill ${open ? 'open' : 'closed'}">${open ? 'Registration open' : 'Registration closed'}</span><span class="small muted">STUDENTS ONLY</span></div>
    <h2 id="signup-title">Save your spot.</h2><p class="intro-copy">A quick signup. A well-earned study break.</p>
    <div class="availability"><strong>${state.stats.available}</strong><div><b>${open ? 'cups still available to reserve' : 'cups currently unreserved'}</b><span>${!open ? 'Online signup is currently closed.' : state.stats.available ? 'Signing up reserves one for you.' : 'You can still join the event. No cup is guaranteed.'}</span></div></div>
    ${!open ? '<p class="notice" role="status">Online signup is closed. You can still check in with an organizer at the door; cups are only available from unreserved stock.</p>' : ''}
    <form id="signup-form"><fieldset ${open ? '' : 'disabled'}>
      <label>Full name<input name="name" autocomplete="name" maxlength="80" minlength="2" required placeholder="e.g. Alex Tan"></label>
      <label>Student ID<input name="studentId" autocapitalize="characters" spellcheck="false" maxlength="24" minlength="4" required placeholder="e.g. A0123456B"><span class="field-hint">Used to find your entry and prevent duplicate cups.</span></label>
      <label>Telegram username <span class="optional">optional</span><div class="input-prefix"><span aria-hidden="true">@</span><input name="telegram" autocomplete="off" spellcheck="false" maxlength="33" placeholder="username"></div><span class="field-hint">To receive confirmation, you’ll also need to start our bot.</span></label>
      <label class="checkbox-label"><input name="student" type="checkbox" required><span>I’m a student. Organizers may use these details for event registration and check-in.</span></label>
      <p class="field-error" id="signup-error" role="alert" hidden></p>
      <button class="button primary full" type="submit">${open ? 'Sign me up' : 'Signup closed'} <span aria-hidden="true">↗</span></button>
    </fieldset></form><p class="signup-footnote">Walk-ins are welcome. A cup is guaranteed only when your confirmation shows a reservation.</p>`}</section></div>`;
  $('#signup-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button');
    button.disabled = true; button.textContent = 'Reserving your spot…'; $('#signup-error').hidden = true;
    try {
      receipt = await api('registrations', 'POST', Object.fromEntries(new FormData(form)));
      try { sessionStorage.setItem('sb-receipt', JSON.stringify(receipt)); } catch { /* Receipt still shown in memory. */ }
      try { state = await api('event'); } catch { /* Registration already succeeded: retain the confirmation. */ }
      renderSignup(); $('#receipt-title')?.focus();
    } catch (error) { errorAt('#signup-error', error.message); button.disabled = false; button.innerHTML = 'Sign me up <span aria-hidden="true">↗</span>'; }
  });
  $('#register-another')?.addEventListener('click', () => { receipt = undefined; try { sessionStorage.removeItem('sb-receipt'); } catch {} renderSignup(); });
}
function receiptHtml() {
  const a = receipt.attendee;
  return `<div class="success-mark" aria-hidden="true">✓</div><span class="eyebrow">YOU’RE ON THE LIST</span>
    <h2 id="receipt-title" tabindex="-1">See you there,<br>${esc(a.name.split(' ')[0])}.</h2>
    <p class="intro-copy">Thanks for signing up. Keep these details handy.</p>
    <div class="ticket"><span class="eyebrow">YOUR STUDY BREAK</span><h3>${esc(state.event.title)}</h3><p>${esc(state.event.day)} · ${esc(state.event.time)}<br>${esc(state.event.venue)}<br><span class="muted small">${esc(state.event.dateNote)}</span></p>
    <div class="ticket-divider"></div><div class="ticket-person"><strong>${esc(a.name)}</strong><span>${esc(a.studentId)}</span></div>
    <div class="reservation ${a.cupNumber ? '' : 'no-cup'}"><strong>${a.cupNumber ? `Cup #${a.cupNumber} reserved` : 'No cup reserved'}</strong><span>${a.cupNumber ? 'Show your student ID at the door. Your cup is held until the event ends.' : 'All cups are allocated. You’re still welcome to join us for the event.'}</span></div></div>
    ${receipt.telegramUrl ? `<a class="button primary full" href="${esc(receipt.telegramUrl)}" target="_blank" rel="noopener noreferrer">Get Telegram confirmation <span aria-hidden="true">↗</span></a><p class="small muted">Open the bot and press Start to receive your confirmation. This link expires in 24 hours.</p>` : `<div class="telegram-note"><strong>Telegram isn’t connected yet.</strong><span>Your registration is saved. This page is your confirmation; no Telegram message has been sent.</span></div>`}
    <button class="text-button" id="register-another">Register another student <span aria-hidden="true">↗</span></button>`;
}
function renderLogin() {
  document.title = 'Study Break Night · Organizer';
  main.innerHTML = `<section class="login-panel"><span class="eyebrow">FOR THE PEOPLE AT THE DOOR</span><h1>Organizer desk.</h1>
    <p>Find students, check them in, and keep every cup accounted for.</p>
    <form id="login-form">${mode === 'demo' ? '<div class="notice">This demo uses sample information stored in this browser. Organizer access here has no password.</div>' : '<label>Organizer password<input name="password" type="password" autocomplete="current-password" required placeholder="Enter your organizer password"></label>'}
    <p class="field-error" id="login-error" role="alert" hidden></p><button class="button primary full" type="submit">${mode === 'demo' ? 'Open demo organizer' : 'Sign in'} <span aria-hidden="true">↗</span></button></form>
    <a class="text-button" href="#signup">Back to signup</a></section>`;
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
    try { await api('session', 'POST', Object.fromEntries(new FormData(event.currentTarget))); signedIn = true; await refreshOrganizer(true); }
    catch (error) { if ($('#login-error')) errorAt('#login-error', error.message); button.disabled = false; }
  });
}
function renderOrganizer() {
  document.title = 'Study Break Night · Organizer';
  main.innerHTML = `<section class="dashboard"><div class="dashboard-heading"><div><span class="eyebrow">${esc(state.event.venue)} / ${esc(state.event.day)} ${esc(state.event.time)}</span><h1>At the door.</h1></div>
    <div class="heading-actions"><button class="button secondary" id="signup-toggle"></button><button class="button primary" id="add-walkin">+ Add walk-in</button></div></div>
    <div class="stats-grid" id="stats"></div><div class="stock-line"><p id="stock-copy"></p><meter id="cup-meter" min="0" max="150" aria-label="Cups allocated out of 150"></meter><span>150 TOTAL</span></div>
    <div class="attendees-panel"><div class="list-toolbar"><div><h2>Attendees <span id="list-count"></span></h2><p>Check student ID before check-in and cup collection.</p></div><label class="search-label"><span class="sr-only">Search name, student ID or Telegram</span><input id="search" type="search" placeholder="Search name or student ID…" autocomplete="off"></label></div>
    <div class="list-controls"><div class="filters" role="group" aria-label="Filter attendees"><button data-filter="all" class="active">All</button><button data-filter="waiting">Not checked in</button><button data-filter="here">Checked in</button><button data-filter="walkins">Walk-ins</button></div><div id="sync-status" role="status"></div></div>
    <div id="connection-error" class="notice error-notice" role="alert" hidden></div>
    <table class="attendee-table"><thead><tr><th scope="col">Student</th><th scope="col">Attendance</th><th scope="col">Bubble tea</th><th scope="col" class="action-column">Next action</th></tr></thead><tbody id="attendee-rows"></tbody></table>
    <div id="empty-state" hidden></div></div><div class="dashboard-footer"><div>${mode === 'demo' ? '<button class="text-button" id="load-samples">Load sample attendees</button><button class="text-button danger-text" id="reset-demo">Reset demo</button>' : '<span class="small muted">Changes are saved to the shared event database.</span>'}</div><button class="text-button" id="sign-out">Sign out</button></div></section>`;
  $('#search').value = search;
  $('#search').addEventListener('input', event => { search = event.target.value; renderRows(); });
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; renderRows(); }));
  $('#signup-toggle').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try { state = { ...state, ...await api('admin/signup', 'PATCH', { open: !state.signupOpen }) }; updateDashboard(); await refreshOrganizer(); toast(state.signupOpen ? 'Signup is now open.' : 'Signup is now closed. Door check-in remains open.'); }
    catch (error) { toast(error.message, true); button.disabled = false; }
  });
  $('#add-walkin').addEventListener('click', () => { $('#walkin-form').reset(); $('#walkin-error').hidden = true; $('#walkin-dialog').showModal(); });
  $('#sign-out').addEventListener('click', async () => {
    try { await api('session', 'DELETE'); signedIn = false; attendees = []; renderLogin(); } catch (error) { toast(error.message, true); }
  });
  $('#load-samples')?.addEventListener('click', async () => { try { await api('admin/samples', 'POST'); await refreshOrganizer(); } catch (e) { toast(e.message, true); } });
  $('#reset-demo')?.addEventListener('click', async () => { if (confirm('Clear all signup and check-in data in this browser demo?')) { await api('admin/reset', 'POST'); receipt = undefined; try { sessionStorage.removeItem('sb-receipt'); } catch {} await refreshOrganizer(); } });
  updateDashboard();
}
function updateDashboard() {
  if (!$('#stats')) return;
  const s = state.stats;
  $('#stats').innerHTML = `<div class="stat-card"><span>Signed up</span><strong>${s.signups}</strong><small>Registered before arrival</small></div>
    <div class="stat-card"><span>Checked in</span><strong>${s.checkedIn}<i> / ${s.signups + s.walkins}</i></strong><small>${s.walkins} walk-in${s.walkins === 1 ? '' : 's'} on the list</small></div>
    <div class="stat-card"><span>Cups reserved</span><strong>${s.reserved}</strong><small>Held, not yet collected</small></div><div class="stat-card dark-stat"><span>Cups handed out</span><strong>${s.collected}<i> / 150</i></strong><small>One per student ID</small></div>`;
  $('#stock-copy').innerHTML = `<strong>${s.available} cups unreserved</strong><span>Available for new signups or walk-ins. Existing reservations stay protected.</span>`;
  $('#cup-meter').value = s.reserved + s.collected;
  const toggle = $('#signup-toggle'); toggle.textContent = `${state.signupOpen ? 'Close' : 'Open'} signup`; toggle.disabled = disconnected;
  $('#add-walkin').disabled = disconnected;
  $('#sync-status').textContent = disconnected ? 'Connection lost' : mode === 'demo' ? 'Saved in this browser' : 'Shared data · updates every 5s';
  $('#connection-error').hidden = !disconnected;
  $('#connection-error').textContent = 'Updates paused. Reconnect before handing out cups. Your last saved list is shown below.';
  renderRows();
}
function renderRows() {
  if (!$('#attendee-rows')) return;
  const query = search.trim().toLowerCase();
  const list = attendees.filter(a => [a.name, a.studentId, a.telegram].some(v => v.toLowerCase().includes(query)))
    .filter(a => filter === 'all' || filter === 'waiting' && !a.checkedInAt || filter === 'here' && a.checkedInAt || filter === 'walkins' && a.source === 'walkin');
  $('#list-count').textContent = attendees.length;
  document.querySelectorAll('[data-filter]').forEach(b => { b.classList.toggle('active', b.dataset.filter === filter); b.setAttribute('aria-pressed', String(b.dataset.filter === filter)); });
  $('#attendee-rows').innerHTML = list.map(a => {
    const busy = pending.has(a.id), disabled = busy || disconnected;
    let action;
    if (!a.checkedInAt) action = `<button class="button row-button" data-action="check-in" data-id="${esc(a.id)}" ${disabled ? 'disabled' : ''}>${busy ? 'Saving…' : 'Check in'}</button>`;
    else if (a.collectedAt) action = '<span class="completed">✓ Completed</span>';
    else if (a.cupNumber || state.stats.available) action = `<button class="button row-button collect-button" data-action="collect" data-id="${esc(a.id)}" ${disabled ? 'disabled' : ''}>${busy ? 'Saving…' : 'Hand out cup'}</button>`;
    else action = '<span class="muted small">No cup available</span>';
    return `<tr><td class="student-cell"><div class="avatar" aria-hidden="true">${esc(a.name.split(' ').map(n => n[0]).slice(0, 2).join(''))}</div><div><strong>${esc(a.name)}</strong><span>${esc(a.studentId)} <span class="source-label">${a.source === 'walkin' ? 'Walk-in' : 'Signed up'}</span></span><span class="telegram-handle">${a.telegram ? `@${esc(a.telegram)}` : 'No Telegram'}${a.telegramStatus === 'sent' ? ' · Confirmed' : a.telegramStatus === 'failed' ? ' · Delivery failed' : ''}</span></div></td>
      <td data-label="Attendance"><span class="badge ${a.checkedInAt ? 'checked' : 'waiting'}">${a.checkedInAt ? 'Checked in' : 'Not checked in'}</span></td>
      <td data-label="Bubble tea"><span class="badge ${a.collectedAt ? 'collected' : a.cupNumber ? 'reserved' : 'no-reservation'}">${a.collectedAt ? `Collected #${a.cupNumber}` : a.cupNumber ? `Reserved #${a.cupNumber}` : 'No reservation'}</span></td><td class="action-cell">${action}</td></tr>`;
  }).join('');
  const empty = $('#empty-state'); empty.hidden = list.length > 0;
  empty.innerHTML = attendees.length ? '<h3>No matching students.</h3><p>Try their full student ID or clear the filters.</p>' : '<span class="empty-mark" aria-hidden="true">↳</span><h3>The list starts here.</h3><p>Share the signup page, or add your first walk-in at the door.</p>';
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => performAction(button.dataset.id, button.dataset.action)));
}
async function performAction(id, action) {
  if (pending.has(id) || disconnected) return;
  pending.add(id); renderRows();
  try {
    const result = await api(`admin/attendees/${id}/${action}`, 'POST', {});
    const a = result.attendee;
    attendees = attendees.map(person => person.id === id ? a : person);
    toast(result.alreadyDone ? (action === 'collect' ? 'Already collected. Do not hand out another cup.' : `${a.name} is already checked in.`) :
      action === 'collect' ? `Cup #${a.cupNumber} recorded for ${a.name}.` : `${a.name} is checked in.`, result.alreadyDone && action === 'collect');
    await refreshOrganizer();
  } catch (error) { toast(error.message, true); await refreshOrganizer(); }
  finally { pending.delete(id); renderRows(); }
}
async function refreshOrganizer(first = false) {
  if (refreshing) return; refreshing = true;
  try {
    const result = await api('admin/attendees');
    state = result; attendees = result.attendees; signedIn = true; disconnected = false; lastRefresh = Date.now();
    if (isOrganizer()) { if (first || !$('#attendee-rows')) renderOrganizer(); else updateDashboard(); }
  } catch (error) {
    if (error.status === 401) { signedIn = false; attendees = []; if (isOrganizer()) renderLogin(); }
    else { disconnected = true; if ($('#attendee-rows')) updateDashboard(); if (first) throw error; }
  } finally { refreshing = false; }
}
async function route() {
  $('#signup-nav').setAttribute('aria-current', isOrganizer() ? 'false' : 'page');
  $('#organizer-nav').setAttribute('aria-current', isOrganizer() ? 'page' : 'false');
  try {
    if (isOrganizer()) { if (signedIn) await refreshOrganizer(true); else { await refreshOrganizer(true); if (!signedIn) renderLogin(); } }
    else { state = await api('event'); renderSignup(); }
  } catch (error) { main.innerHTML = `<section class="login-panel"><h1>Let’s reconnect.</h1><p>${esc(error.message)}</p><button class="button primary" id="retry">Try again</button></section>`; $('#retry').addEventListener('click', route); }
}
$('#close-dialog').addEventListener('click', () => $('#walkin-dialog').close());
$('#walkin-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button'); button.disabled = true;
  try {
    const result = await api('admin/walk-ins', 'POST', Object.fromEntries(new FormData(form)));
    $('#walkin-dialog').close(); filter = 'all'; search = result.attendee.studentId;
    if ($('#search')) $('#search').value = search;
    toast(result.existing ? 'This student is already on the list. Use their existing entry below.' : `${result.attendee.name} added and checked in.`);
    await refreshOrganizer();
  } catch (error) { errorAt('#walkin-error', error.message); }
  finally { button.disabled = false; }
});
window.addEventListener('hashchange', route);
$('.skip-link').addEventListener('click', event => { event.preventDefault(); main.focus(); main.scrollIntoView({ block: 'start' }); });
window.addEventListener('storage', () => { if (mode === 'demo' && signedIn && isOrganizer()) refreshOrganizer(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && signedIn && isOrganizer()) refreshOrganizer(); });
setInterval(() => { if (signedIn && isOrganizer() && !document.hidden) refreshOrganizer(); }, 5000);
setInterval(() => { if (mode === 'server' && signedIn && Date.now() - lastRefresh > 16000 && !disconnected) { disconnected = true; updateDashboard(); } }, 3000);
async function boot() {
  try {
    const response = await fetch('./deployment.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Deployment configuration is missing.');
    mode = (await response.json()).mode;
    if (mode !== 'demo' && mode !== 'server') throw new Error('Unknown deployment mode.');
    if (mode === 'demo') {
      $('#demo-banner').hidden = false;
      $('#demo-banner').innerHTML = '<strong>INTERACTIVE DEMO</strong><span>Saved only in this browser. Use sample details; devices do not sync.</span><a href="https://github.com/ngcanhh/CheckinComp#run-the-shared-version">Run the shared version ↗</a>';
    }
    try { receipt = JSON.parse(sessionStorage.getItem('sb-receipt')); } catch {}
    await route();
  } catch (error) { main.innerHTML = `<section class="login-panel"><h1>Unable to start.</h1><p>${esc(error.message)}</p><p>Refresh the page after the connection is restored.</p></section>`; }
}
boot();

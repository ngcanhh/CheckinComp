import { EVENT, validateAttendee, statistics } from './domain.js';
const KEY = 'study-break-demo-v1';
const stamp = () => new Date().toISOString();
const initial = () => ({ signupOpen: true, attendees: [] });
let fallback;
function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || initial(); }
  catch { return fallback || initial(); }
}
function write(state) {
  fallback = state;
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { throw new Error('Browser storage is unavailable. Enable storage to use this demo.'); }
}
function state(data) { return { event: EVENT, signupOpen: data.signupOpen, stats: statistics(data.attendees), mode: 'demo', telegramConfigured: false }; }
function allocate(data) {
  const used = new Set(data.attendees.map(a => a.cupNumber));
  for (let n = 1; n <= 150; n++) if (!used.has(n)) return n;
  return null;
}
let signedIn = false;
export async function demoRequest(path, method = 'GET', input = {}) {
  const data = read();
  if (path === 'event') return state(data);
  if (path === 'session') { signedIn = method === 'POST'; return { ok: true }; }
  if (path.startsWith('admin/') && !signedIn) throw Object.assign(new Error('Please open the demo organizer.'), { status: 401 });
  if (path === 'admin/attendees') return { ...state(data), attendees: data.attendees.toReversed() };
  if (path === 'admin/signup') { data.signupOpen = input.open; write(data); return state(data); }
  if (path === 'admin/reset') { write(initial()); return state(initial()); }
  if (path === 'admin/samples') {
    if (data.attendees.length) throw new Error('Reset the demo before loading sample attendees.');
    const names = ['Alex Tan', 'Jamie Lim', 'Sam Lee', 'Taylor Wong', 'Riley Chen', 'Morgan Teo', 'Casey Ng', 'Jordan Goh'];
    for (let i = 0; i < names.length; i++) data.attendees.push({
      id: crypto.randomUUID(), name: names[i], studentId: `DEMO${1001 + i}`,
      telegram: `sample_${1001 + i}`, source: i < 6 ? 'registration' : 'walkin',
      createdAt: stamp(), checkedInAt: i < 3 || i > 5 ? stamp() : null,
      cupNumber: i < 6 ? i + 1 : i === 6 ? 7 : null,
      collectedAt: i < 2 || i === 6 ? stamp() : null, telegramStatus: 'not_connected',
    });
    write(data); return state(data);
  }
  if (path === 'registrations' || path === 'admin/walk-ins') {
    const details = validateAttendee(input), walkin = path === 'admin/walk-ins';
    if (!walkin && !data.signupOpen) throw new Error('Signup is closed. You can still check in at the door.');
    const existing = data.attendees.find(a => a.studentId === details.studentId);
    if (existing) {
      if (walkin) return { attendee: existing, existing: true };
      throw new Error('This student ID is already registered. Ask an organizer to find your entry.');
    }
    const a = { ...details, id: crypto.randomUUID(), source: walkin ? 'walkin' : 'registration',
      createdAt: stamp(), checkedInAt: walkin ? stamp() : null, cupNumber: walkin ? null : allocate(data),
      collectedAt: null, telegramStatus: 'not_connected' };
    data.attendees.push(a); write(data);
    return { attendee: a, existing: false, telegramConfigured: false, telegramUrl: null };
  }
  const match = /^admin\/attendees\/([^/]+)\/(check-in|collect)$/.exec(path);
  if (match) {
    const a = data.attendees.find(a => a.id === match[1]);
    if (!a) throw new Error('Attendee not found.');
    let alreadyDone;
    if (match[2] === 'check-in') { alreadyDone = Boolean(a.checkedInAt); a.checkedInAt ||= stamp(); }
    else {
      if (!a.checkedInAt) throw new Error('Check this student in before handing out a cup.');
      alreadyDone = Boolean(a.collectedAt);
      a.cupNumber ||= allocate(data);
      if (!a.cupNumber) throw new Error('All 150 cups are reserved or collected. Check-in is still available.');
      a.collectedAt ||= stamp();
    }
    write(data); return { attendee: a, alreadyDone };
  }
  throw new Error('Unknown demo action.');
}

import { EVENT, validateAttendee, statistics } from './domain.js';

const KEY = 'study-break-device-v2';
const LEGACY_KEY = 'study-break-demo-v1';
const stamp = () => new Date().toISOString();
const initial = () => ({ signupOpen: true, attendees: [] });

function read() {
  const stored = localStorage.getItem(KEY);
  if (stored) return JSON.parse(stored);
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (!legacy) return initial();
  const previous = JSON.parse(legacy);
  // Remove only the eight identifiable fixtures shipped by the old release.
  // Manually entered attendees are retained when this browser upgrades.
  previous.attendees = previous.attendees.filter(a => !(
    /^DEMO100[1-8]$/.test(a.studentId) && a.telegram === `sample_${a.studentId.slice(4)}`
  ));
  write(previous);
  localStorage.removeItem(LEGACY_KEY);
  return previous;
}
function write(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); }
  catch { throw new Error('Cannot save entries on this device. Enable browser storage and try again.'); }
}
function state(data) {
  return { event: EVENT, signupOpen: data.signupOpen, stats: statistics(data.attendees), mode: 'browser', telegramConfigured: false };
}
function allocate(data) {
  const used = new Set(data.attendees.map(a => a.cupNumber));
  for (let n = 1; n <= 150; n++) if (!used.has(n)) return n;
  return null;
}
let signedIn = false;

function request(path, method, input) {
  const data = read();
  if (path === 'event') return state(data);
  if (path === 'session') { signedIn = method === 'POST'; return { ok: true }; }
  if (path.startsWith('admin/') && !signedIn) throw Object.assign(new Error('Please open the organizer desk.'), { status: 401 });
  if (path === 'admin/attendees') return { ...state(data), attendees: data.attendees.filter(a => !a.removedAt).reverse() };
  const removal = /^admin\/attendees\/([^/]+)$/.exec(path);
  if (removal && method === 'DELETE') {
    const a = data.attendees.find(a => a.id === removal[1] && !a.removedAt);
    if (!a) return { removed: true, alreadyRemoved: true, ...state(data) };
    if (a.collectedAt) a.removedAt = stamp();
    else data.attendees = data.attendees.filter(person => person.id !== a.id);
    write(data);
    return { removed: true, alreadyRemoved: false, collectedCupRetained: Boolean(a.collectedAt), ...state(data) };
  }
  if (path === 'admin/signup' && method === 'PATCH') { data.signupOpen = input.open; write(data); return state(data); }
  if (path === 'admin/reset' && method === 'POST') { write(initial()); return state(initial()); }
  if ((path === 'registrations' || path === 'admin/walk-ins') && method === 'POST') {
    const details = validateAttendee(input), walkin = path === 'admin/walk-ins';
    if (!walkin && !data.signupOpen) throw new Error('Signup is closed. You can still check in at the door.');
    const existing = data.attendees.find(a => a.studentId === details.studentId);
    if (existing) {
      if (existing.removedAt) throw new Error('This student ID has already collected a cup, even though its entry was removed. Ask an organizer for help.');
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
  if (match && method === 'POST') {
    const a = data.attendees.find(a => a.id === match[1] && !a.removedAt);
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
  throw new Error('Unknown action.');
}

export async function browserRequest(path, method = 'GET', input = {}) {
  try {
    // Serialize same-origin tabs on browsers that support Web Locks.
    if (globalThis.navigator?.locks) return await navigator.locks.request(KEY, () => request(path, method, input));
    return request(path, method, input);
  } catch (error) {
    if (error.name === 'SecurityError') throw new Error('Browser storage is unavailable. Enable it to save entries on this device.');
    throw error;
  }
}

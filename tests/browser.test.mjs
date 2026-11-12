import test from 'node:test';
import assert from 'node:assert/strict';
import { browserRequest as request } from '../public/browser.js';

async function setup(t, values = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  // Model a browser without Web Locks; Node's worker-thread lock manager is not a browser origin.
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  t.after(() => { if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else delete globalThis.navigator; });
  const data = new Map(Object.entries(values));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; });
  await request('session', 'DELETE');
  return data;
}
const signup = n => request('registrations', 'POST', { name: `Test Student ${n}`, studentId: `TEST${String(n).padStart(4, '0')}` });

test('browser starts empty and has no sample-student loading action', async t => {
  await setup(t);
  const event = await request('event');
  assert.equal(event.stats.signups, 0); assert.equal(event.stats.available, 150);
  await assert.rejects(request('admin/attendees'), { status: 401 });
  await request('session', 'POST');
  assert.deepEqual((await request('admin/attendees')).attendees, []);
  await assert.rejects(request('admin/samples', 'POST'), /Unknown action/);
});

test('browser upgrade removes old fixtures but retains manually entered attendees and settings', async t => {
  const data = await setup(t, { 'study-break-demo-v1': JSON.stringify({ signupOpen: false, attendees: [
    { studentId: 'DEMO1001', telegram: 'sample_1001', cupNumber: 1, source: 'registration' },
    { studentId: 'DEMO1008', telegram: 'sample_1008', cupNumber: null, source: 'walkin' },
    { studentId: 'MANUAL01', name: 'Manually Entered', telegram: '', cupNumber: 9, source: 'registration' },
    { studentId: 'DEMO1002', name: 'Manually Entered Too', telegram: '', cupNumber: 10, source: 'registration' },
  ] }) });
  await request('session', 'POST');
  const state = await request('admin/attendees');
  assert.equal(state.signupOpen, false);
  assert.deepEqual(state.attendees.map(a => a.studentId), ['DEMO1002', 'MANUAL01']);
  assert.equal(state.stats.available, 148);
  assert.equal(data.has('study-break-demo-v1'), false);
  assert.equal(data.has('study-break-device-v2'), true);
});

test('browser caps reservations at 150 and deduplicates check-in and collection', async t => {
  await setup(t);
  const results = await Promise.all(Array.from({ length: 151 }, (_, i) => signup(i)));
  const cups = results.map(r => r.attendee.cupNumber).filter(Boolean);
  assert.equal(cups.length, 150); assert.equal(new Set(cups).size, 150);
  await assert.rejects(signup(0), /already registered/);
  await request('session', 'POST');
  const id = results[0].attendee.id;
  await assert.rejects(request(`admin/attendees/${id}/collect`, 'POST'), /Check this student in/);
  await request(`admin/attendees/${id}/check-in`, 'POST');
  assert.equal((await request(`admin/attendees/${id}/check-in`, 'POST')).alreadyDone, true);
  await request(`admin/attendees/${id}/collect`, 'POST');
  assert.equal((await request(`admin/attendees/${id}/collect`, 'POST')).alreadyDone, true);
  const stats = (await request('event')).stats;
  assert.equal(stats.collected, 1); assert.equal(stats.checkedIn, 1);
  assert.equal(stats.reserved + stats.collected + stats.available, 150);
});

test('browser signup closure preserves door check-in and unreserved walk-in allocation', async t => {
  await setup(t); await request('session', 'POST');
  await request('admin/signup', 'PATCH', { open: false });
  await assert.rejects(signup(1), /Signup is closed/);
  const { attendee } = await request('admin/walk-ins', 'POST', { name: 'Walk In', studentId: 'WALK0001' });
  assert.ok(attendee.checkedInAt); assert.equal(attendee.cupNumber, null);
  await request(`admin/attendees/${attendee.id}/collect`, 'POST');
  assert.equal((await request('event')).stats.available, 149);
  await request('admin/reset', 'POST');
  assert.equal((await request('event')).stats.available, 150);
});

test('browser reports storage write failures instead of claiming registration succeeded', async t => {
  await setup(t);
  localStorage.setItem = () => { throw new Error('Storage quota'); };
  await assert.rejects(signup(1), /Cannot save entries/);
  assert.equal((await request('event')).stats.signups, 0);
});

test('browser removal releases uncollected reservations and permits corrected registration', async t => {
  await setup(t); await request('session', 'POST');
  const { attendee } = await signup(1);
  await request(`admin/attendees/${attendee.id}/check-in`, 'POST');
  const removed = await request(`admin/attendees/${attendee.id}`, 'DELETE');
  assert.equal(removed.stats.available, 150); assert.equal(removed.stats.checkedIn, 0);
  assert.deepEqual((await request('admin/attendees')).attendees, []);
  assert.equal((await request(`admin/attendees/${attendee.id}`, 'DELETE')).alreadyRemoved, true);
  assert.ok((await signup(1)).attendee.cupNumber);
});

test('browser removal keeps collected stock and blocks duplicate claims for the removed ID', async t => {
  await setup(t); await request('session', 'POST');
  const { attendee } = await signup(1);
  await request(`admin/attendees/${attendee.id}/check-in`, 'POST');
  await request(`admin/attendees/${attendee.id}/collect`, 'POST');
  const removed = await request(`admin/attendees/${attendee.id}`, 'DELETE');
  assert.equal(removed.collectedCupRetained, true);
  assert.equal(removed.stats.collected, 1); assert.equal(removed.stats.available, 149);
  assert.equal(removed.stats.signups, 0); assert.equal(removed.stats.checkedIn, 0);
  assert.deepEqual((await request('admin/attendees')).attendees, []);
  await assert.rejects(signup(1), /already collected/);
  await assert.rejects(request(`admin/attendees/${attendee.id}/collect`, 'POST'), /not found/);
});

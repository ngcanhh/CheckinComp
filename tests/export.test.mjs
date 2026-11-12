import test from 'node:test';
import assert from 'node:assert/strict';
import { attendeesCsv } from '../public/export.js';

test('CSV preserves names, quotes and multiline input, with UTF-8 BOM and Singapore times', () => {
  const csv = attendeesCsv([{ name: 'Nguyễn, "An"\nTest', studentId: 'A0123456B', telegram: 'sample_user',
    source: 'registration', createdAt: '2026-11-12T15:30:00Z', checkedInAt: '2026-11-12T15:35:00Z',
    cupNumber: 12, collectedAt: null, telegramStatus: 'not_connected' }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"Nguyễn, ""An""\nTest"'));
  assert.ok(csv.includes('"2026-11-12 23:30:00","Yes","2026-11-12 23:35:00","12","Reserved",""'));
  assert.ok(csv.endsWith('\r\n'));
});

test('CSV neutralizes spreadsheet formulas in user input, including leading whitespace', () => {
  for (const name of ['=HYPERLINK("https://example.test")', '+1+2', '-1+2', '@SUM(A1)', '  =1+1', '\t=1+1', '\r=1', '\n=1']) {
    const csv = attendeesCsv([{ name, studentId: 'A1234', telegram: '', source: 'registration' }]);
    assert.ok(csv.includes(`"'${name.replaceAll('"', '""')}"`), name);
  }
});

test('CSV distinguishes collected, reserved and unreserved cups, and allows empty lists', () => {
  const csv = attendeesCsv([
    { name: 'One', cupNumber: 1, collectedAt: '2026-11-12T16:01:00Z', source: 'walkin' },
    { name: 'Two', cupNumber: 2, source: 'registration' },
    { name: 'Three', cupNumber: null, source: 'registration' },
  ]);
  assert.ok(csv.includes('"Collected","2026-11-13 00:01:00"'));
  assert.ok(csv.includes('"Reserved"'));
  assert.ok(csv.includes('"No reservation"'));
  assert.ok(csv.includes('"Walk-in"'));
  assert.equal(attendeesCsv([]).split('\r\n').length, 2);
});

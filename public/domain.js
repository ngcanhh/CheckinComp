export const CUP_LIMIT = 150;
export const EVENT = {
  title: 'Study Break Night', day: 'Thursday', time: '7–9 PM', venue: 'COM1 foyer',
  timezone: 'Asia/Singapore', dateNote: 'Event date to be confirmed',
};
export function validateAttendee(input) {
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  const studentId = String(input.studentId ?? '').trim().toUpperCase();
  const telegram = String(input.telegram ?? '').trim().replace(/^@/, '');
  if (name.length < 2 || name.length > 80) throw new Error('Enter your full name (2–80 characters).');
  if (!/^[A-Z0-9][A-Z0-9-]{3,23}$/.test(studentId)) throw new Error('Enter a valid student ID (4–24 letters, digits or hyphens).');
  if (telegram && !/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(telegram)) throw new Error('Enter a valid Telegram username, or leave it blank if you do not have one.');
  return { name, studentId, telegram };
}
export function statistics(attendees) {
  const active = attendees.filter(a => !a.removedAt);
  const collected = attendees.filter(a => a.collectedAt).length;
  const reserved = attendees.filter(a => a.cupNumber && !a.collectedAt).length;
  return { signups: active.filter(a => a.source === 'registration').length,
    walkins: active.filter(a => a.source === 'walkin').length,
    checkedIn: active.filter(a => a.checkedInAt).length,
    reserved, collected, available: CUP_LIMIT - reserved - collected, total: CUP_LIMIT };
}

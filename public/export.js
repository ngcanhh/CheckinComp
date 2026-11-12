// A UTF-8 CSV snapshot for Google Sheets and Excel. Export only organizer data.
function cell(value) {
  let text = String(value ?? '');
  // Quotes alone do not stop spreadsheet formula execution on imported input.
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

function localTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function attendeesCsv(attendees) {
  const rows = [[
    'Full name', 'Student ID', 'Telegram username', 'Entry type',
    'Registered at (Singapore)', 'Checked in', 'Checked in at (Singapore)',
    'Cup number', 'Cup status', 'Collected at (Singapore)', 'Telegram status',
  ], ...attendees.map(a => [
    a.name, a.studentId, a.telegram, a.source === 'walkin' ? 'Walk-in' : 'Registration',
    localTime(a.createdAt), a.checkedInAt ? 'Yes' : 'No', localTime(a.checkedInAt),
    a.cupNumber, a.collectedAt ? 'Collected' : a.cupNumber ? 'Reserved' : 'No reservation',
    localTime(a.collectedAt), a.telegramStatus,
  ])];
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

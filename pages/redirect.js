const destination = new URL('https://study-break-checkin.study-break-checkin.workers.dev/');
destination.hash = window.location.hash;
window.location.replace(destination.href);

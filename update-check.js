// The app can run for days without a real reload (Guided Access), so a
// code push here wouldn't otherwise reach it. GitHub Pages stamps every
// static file with an ETag/Last-Modified that changes on each deploy —
// poll that on a plain file and reload once it changes, only while
// sitting on the home screen so a story never gets interrupted.
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const VERSION_CHECK_URL = 'app.js';

let lastKnownVersion = null;
let pendingVersion = null;

function isOnHomeScreen() {
  return !window.location.hash || window.location.hash === '#/';
}

function reloadIfPendingAndHome() {
  if (pendingVersion && isOnHomeScreen()) {
    window.location.reload();
  }
}

async function checkForUpdate() {
  let current;
  try {
    const res = await fetch(VERSION_CHECK_URL, { method: 'HEAD', cache: 'no-store' });
    current = res.headers.get('etag') || res.headers.get('last-modified');
  } catch {
    return; // offline or blocked — try again next interval
  }
  if (!current) return;

  if (lastKnownVersion === null) {
    lastKnownVersion = current;
    return;
  }
  if (current !== lastKnownVersion) {
    pendingVersion = current;
  }
  reloadIfPendingAndHome();
}

// Also try right away whenever navigation lands back on the home screen,
// instead of waiting for the next poll interval.
window.addEventListener('hashchange', reloadIfPendingAndHome);

checkForUpdate();
setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);

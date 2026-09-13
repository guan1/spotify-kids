const API_BASE = 'https://api.spotify.com/v1';

// Formats a Retry-After (seconds from now) as a clock time, adding the
// date too if it falls on a different day (quota resets can be far out).
function formatRetryTime(retryAfterSeconds) {
  const target = new Date(Date.now() + retryAfterSeconds * 1000);
  const sameDay = target.toDateString() === new Date().toDateString();
  const time = target.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${time} (${target.toLocaleDateString('de-DE')})`;
}

async function apiFetch(path, options = {}, isRetry = false) {
  const token = await getValidAccessToken();
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  if (res.status === 429 && !isRetry) {
    const body = await res.json().catch(() => ({}));
    const retryAfterHeader = res.headers.get('Retry-After');
    const retryAfterSeconds = Number(retryAfterHeader);
    const hasRetryAfter = retryAfterHeader && !Number.isNaN(retryAfterSeconds);

    if (body.error?.reason === 'QUOTA_EXCEEDED') {
      // A hard per-account daily/hourly ceiling, not a short burst limit —
      // retrying immediately would just fail again and waste another call.
      const message = hasRetryAfter
        ? `Spotify Limit erreicht, versuche es um ${formatRetryTime(retryAfterSeconds)} nochmal`
        : 'Spotify-Limit für heute erreicht. Bitte später erneut versuchen.';
      throw new Error(message);
    }
    await new Promise(resolve => setTimeout(resolve, ((hasRetryAfter ? retryAfterSeconds : 1) + 1) * 1000));
    return apiFetch(path, options, true);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify API ${res.status} on ${path}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function getPlaylist(playlistId) {
  return apiFetch(`/playlists/${playlistId}?fields=id,name,images`);
}

// Every album by this artist is one "story". Public catalog data — no
// ownership restriction, unlike playlist track contents.
async function getArtistAlbums(artistId) {
  const albums = [];
  let url = `/artists/${artistId}/albums?limit=10&include_groups=album`;
  while (url) {
    const page = await apiFetch(url);
    albums.push(...page.items);
    url = page.next ? page.next.replace(API_BASE, '') : null;
  }
  // Oldest (episode 1) first.
  albums.sort((a, b) => (a.release_date || '').localeCompare(b.release_date || ''));
  return albums;
}

// Follows pagination to return every track on the album, in order.
async function getAlbumTracks(albumId) {
  const tracks = [];
  let url = `/albums/${albumId}/tracks?limit=50`;
  while (url) {
    const page = await apiFetch(url);
    tracks.push(...page.items);
    url = page.next ? page.next.replace(API_BASE, '') : null;
  }
  return tracks;
}

async function startPlayback(deviceId, uris) {
  await apiFetch(`/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris })
  });
}

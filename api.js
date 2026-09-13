const API_BASE = 'https://api.spotify.com/v1';

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
    if (body.error?.reason === 'QUOTA_EXCEEDED') {
      // A hard per-account daily/hourly ceiling, not a short burst limit —
      // retrying immediately would just fail again and waste another call.
      throw new Error('Spotify-Limit für heute erreicht. Bitte später erneut versuchen.');
    }
    const retryAfterSeconds = Number(res.headers.get('Retry-After')) || 1;
    await new Promise(resolve => setTimeout(resolve, (retryAfterSeconds + 1) * 1000));
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

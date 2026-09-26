// ---- Fill these in before running the app ----
//
// clientId: from your app in the Spotify Developer Dashboard
//   https://developer.spotify.com/dashboard
// redirectUri: must match EXACTLY (including trailing slash or not) one of the
//   "Redirect URIs" you register on that app.
const SPOTIFY_CONFIG = {
  clientId: '218f788bd3784f6f9f619670679d9387',
  redirectUri: window.location.origin + window.location.pathname,
  scopes: [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-read-playback-state',
    'user-modify-playback-state',
    'playlist-read-private',
    'playlist-read-collaborative'
  ].join(' ')
};

// ---- The hardcoded home-screen grid ----
//
// Two supported show types:
//
// type: 'albums' — each story is one album by an artist. Albums are public
//   catalog data (no ownership restriction, unlike playlist track contents).
//   artistId: from the artist's share link https://open.spotify.com/artist/<ID>
//   playlistId: only used for the home tile's cover image (playlist metadata
//     is public regardless of ownership) — from a playlist's share link
//     https://open.spotify.com/playlist/<ID>
//
// type: 'episodes' — each story is one episode of a podcast show. Episodes
//   are public catalog data too, and (unlike albums/tracks) already carry
//   their own playable URI directly, so no separate per-story track lookup
//   is needed. NOTE: Spotify's playback API only documents track URIs for
//   the uris array we pass to start playback — episode URIs there are
//   untested/unofficial and need to be verified live once deployed.
//   showId: from the show's share link https://open.spotify.com/show/<ID>
const SHOWS = [
  {
    id: 'fuchsbande',
    name: 'Die Fuchsbande',
    type: 'albums',
    playlistId: '1rh5amIJ00vlb0Tpy0Dt7A',
    artistId: '325gkGGHH2WrswRh3qC3e9'
  },
  {
    id: 'spidey',
    name: 'Marvels Spidey und seine Super-Freunde',
    type: 'albums',
    playlistId: '3bgcec2nqbxCWhP3wZBbsY',
    artistId: '1AqcmVcO9EkjniNmbAwef3'
  },
  {
    id: 'anna',
    name: 'Anna und die Wilden Tiere',
    type: 'episodes',
    showId: '1wDRxT0vAx2gU3cSgcNcL5'
  }
];

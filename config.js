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
// playlistId: only used for the home tile's cover image (playlist metadata
//   is public regardless of ownership) — from the playlist's share link
//   https://open.spotify.com/playlist/<THIS PART>?si=...
// artistId: each story is one album by this artist. Albums are public
//   catalog data (no ownership restriction, unlike playlist track contents)
//   — from the artist's share link https://open.spotify.com/artist/<THIS PART>
const SHOWS = [
  {
    id: 'fuchsbande',
    name: 'Die Fuchsbande',
    playlistId: '1rh5amIJ00vlb0Tpy0Dt7A',
    artistId: '325gkGGHH2WrswRh3qC3e9'
  },
  {
    id: 'spidey',
    name: 'Marvels Spidey und seine Super-Freunde',
    playlistId: '3bgcec2nqbxCWhP3wZBbsY',
    artistId: '1AqcmVcO9EkjniNmbAwef3'
  }
];

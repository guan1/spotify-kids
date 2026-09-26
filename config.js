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
//   playlistId: optional — if given, used for the home tile's cover image
//     instead of the artist's own image (playlist metadata is public
//     regardless of ownership) — from a playlist's share link
//     https://open.spotify.com/playlist/<ID>
//
// type: 'episodes' — each story is one episode of a podcast show. Metadata
//   (title/image/uri) comes from the public /shows/{id}/episodes endpoint.
//   showId: from the show's share link https://open.spotify.com/show/<ID>
//
//   Playback: passing the episode's own uri directly is CONFIRMED BROKEN —
//   Spotify's Start Playback endpoint silently no-ops on episode URIs in
//   its 'uris' array (see github.com/thelinmichael/spotify-web-api-node
//   issue #365). contextPlaylistId is the CONFIRMED WORKING workaround:
//   play a playlist that happens to contain these episodes as the
//   context_uri, with offset.uri targeting the specific episode.
//   *Playing* a public playlist as a context doesn't require
//   owning/collaborating on it (unlike *reading* its items via the API,
//   which does since Feb 2026) — the playlist's own contents are never
//   read via the API, it's used purely as an opaque playback context.
//   contextPlaylistId: from a playlist's share link
//     https://open.spotify.com/playlist/<ID> — doesn't need to be yours,
//     just needs to actually contain the episode(s) you want to target
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
    showId: '1wDRxT0vAx2gU3cSgcNcL5',
    contextPlaylistId: '2DE2ztUJpHMl1RVFaASE2j'
  }
];

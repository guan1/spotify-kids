const root = document.getElementById('app');

// In-memory caches so navigating back and forth doesn't refetch every time.
const playlistImageCache = {}; // showId -> image url
const storiesCache = {}; // showId -> [{title, image, albumId, uris}] (uris filled in lazily)

let playerController = null;
let currentStoryPaused = true;
let wakeLock = null;

const CONTINUE_KEY = 'sk_continue';

function saveContinueListening(entry) {
  localStorage.setItem(CONTINUE_KEY, JSON.stringify(entry));
}
function loadContinueListening() {
  try {
    return JSON.parse(localStorage.getItem(CONTINUE_KEY) || 'null');
  } catch {
    return null;
  }
}

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) {
    console.warn('Wake lock request failed', err);
  }
}
function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && window.location.hash.startsWith('#/play/')) {
    acquireWakeLock();
  }
});
window.addEventListener('pagehide', () => playerController?.disconnect());

// Loads (and caches) the story list for a show — shared by the stories
// grid and the player screen, so deep-linking straight into a player
// route (e.g. from the "continue listening" tile) works on its own.
async function loadStories(showId) {
  if (!storiesCache[showId]) {
    const show = SHOWS.find(s => s.id === showId);
    const albums = await getArtistAlbums(show.artistId);
    storiesCache[showId] = albums.map(album => ({
      title: album.name,
      image: album.images?.[0]?.url || null,
      albumId: album.id,
      uris: null
    }));
  }
  return storiesCache[showId];
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function navigate(hash) {
  window.location.hash = hash;
}

window.addEventListener('hashchange', render);

async function render() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);

  if (parts[0] === 'show' && parts[1]) {
    return renderShowScreen(parts[1]);
  }
  if (parts[0] === 'play' && parts[1] && parts[2] !== undefined) {
    return renderPlayerScreen(parts[1], parseInt(parts[2], 10));
  }
  return renderHomeScreen();
}

function renderLoading(message) {
  root.innerHTML = '';
  root.appendChild(el(`<div class="loading">${message}</div>`));
}

// ---------- Screen 1: home grid ----------
async function renderHomeScreen() {
  // Pause, but keep the SDK connection alive — tearing down and recreating
  // the Web Playback SDK device on every show switch is a race that
  // intermittently leaves the next screen stuck waiting for a 'ready' event.
  playerController?.pause();
  releaseWakeLock();

  root.innerHTML = '';
  const grid = el('<div class="grid"></div>');
  root.appendChild(grid);

  const continueEntry = loadContinueListening();
  if (continueEntry) {
    const tile = el(`
      <button class="tile continue-tile">
        <img alt="" src="${continueEntry.image || ''}">
        <span class="badge">▶</span>
        <span class="tile-label">Weiter hören: ${continueEntry.title}</span>
      </button>
    `);
    tile.addEventListener('click', () => navigate(`/play/${continueEntry.showId}/${continueEntry.storyIndex}`));
    grid.appendChild(tile);
  }

  for (const show of SHOWS) {
    const tile = el(`
      <button class="tile">
        <img alt="" src="${playlistImageCache[show.id] || ''}">
        <span class="tile-label">${show.name}</span>
      </button>
    `);
    tile.addEventListener('click', () => navigate(`/show/${show.id}`));
    grid.appendChild(tile);

    if (!playlistImageCache[show.id]) {
      getPlaylist(show.playlistId)
        .then(playlist => {
          const url = playlist.images?.[0]?.url;
          if (url) {
            playlistImageCache[show.id] = url;
            tile.querySelector('img').src = url;
          }
        })
        .catch(err => console.error('Failed to load playlist image', show.id, err));
    }
  }
}

// ---------- Screen 2: stories grid ----------
async function renderShowScreen(showId) {
  const show = SHOWS.find(s => s.id === showId);
  if (!show) return navigate('/');

  playerController?.pause();
  releaseWakeLock();
  renderLoading('Lade Geschichten…');

  let stories;
  try {
    stories = await loadStories(showId);
  } catch (err) {
    console.error('Failed to load stories for', showId, err);
    renderError(err.message, () => renderShowScreen(showId));
    return;
  }

  root.innerHTML = '';
  const header = el(`
    <div class="screen-header">
      <button class="back-button" aria-label="Zurück">←</button>
    </div>
  `);
  header.querySelector('.back-button').addEventListener('click', () => navigate('/'));
  root.appendChild(header);

  const grid = el('<div class="grid"></div>');
  root.appendChild(grid);

  const continueEntry = loadContinueListening();

  stories.forEach((story, index) => {
    const isNowPlaying = continueEntry?.showId === showId && continueEntry?.storyIndex === index;
    const tile = el(`
      <button class="tile">
        <img alt="" src="${story.image || ''}">
        ${isNowPlaying ? '<span class="badge">▶</span>' : ''}
        <span class="tile-label">${story.title}</span>
      </button>
    `);
    tile.addEventListener('click', () => navigate(`/play/${showId}/${index}`));
    grid.appendChild(tile);
  });
}

// ---------- Screen 3: player ----------
async function renderPlayerScreen(showId, storyIndex) {
  const show = SHOWS.find(s => s.id === showId);
  if (!show) return navigate('/');

  let stories = storiesCache[showId];
  if (!stories) {
    renderLoading('Lade Geschichten…');
    try {
      stories = await loadStories(showId);
    } catch (err) {
      console.error('Failed to load stories for', showId, err);
      renderError(err.message, () => renderPlayerScreen(showId, storyIndex));
      return;
    }
  }
  if (!stories[storyIndex]) return navigate('/');

  const story = stories[storyIndex];

  root.innerHTML = '';
  const screen = el(`
    <div class="player-screen" style="background-image:url('${story.image || ''}')">
      <button class="back-button" aria-label="Zurück">←</button>
      <div class="player-controls">
        <button class="control prev" aria-label="Vorherige Geschichte">⏮</button>
        <button class="control play-pause" aria-label="Play/Pause">⏵</button>
        <button class="control next" aria-label="Nächste Geschichte">⏭</button>
      </div>
    </div>
  `);
  root.appendChild(screen);

  screen.querySelector('.back-button').addEventListener('click', () => navigate(`/show/${showId}`));

  const prevBtn = screen.querySelector('.prev');
  const nextBtn = screen.querySelector('.next');
  const playPauseBtn = screen.querySelector('.play-pause');

  prevBtn.disabled = storyIndex === 0;
  nextBtn.disabled = storyIndex === stories.length - 1;

  prevBtn.addEventListener('click', () => navigate(`/play/${showId}/${storyIndex - 1}`));
  nextBtn.addEventListener('click', () => navigate(`/play/${showId}/${storyIndex + 1}`));
  playPauseBtn.addEventListener('click', () => playerController?.togglePlay());

  if (!playerController) {
    playerController = new SpotifyPlayerController();
  }
  // Re-bind every render: the button element is new each time, but the
  // controller (and its SDK connection) persists across story navigation.
  let hasStartedPlaying = false;
  let autoAdvanceTriggered = false;
  playerController.onStateChange = state => {
    currentStoryPaused = state.paused;
    playPauseBtn.textContent = state.paused ? '⏵' : '⏸';

    if (!state.paused) hasStartedPlaying = true;

    const reachedEnd = hasStartedPlaying && state.paused &&
      state.position === 0 &&
      state.track_window.next_tracks.length === 0;

    if (reachedEnd && !autoAdvanceTriggered) {
      autoAdvanceTriggered = true;
      if (storyIndex < stories.length - 1) {
        navigate(`/play/${showId}/${storyIndex + 1}`);
      }
    }
  };

  renderLoadingOverlay(screen);
  try {
    if (!story.uris) {
      const tracks = await getAlbumTracks(story.albumId);
      story.uris = tracks.map(t => t.uri);
    }
    await playerController.playUris(story.uris);
    removeLoadingOverlay(screen);
    acquireWakeLock();
    saveContinueListening({ showId, storyIndex, title: story.title, image: story.image });
  } catch (err) {
    console.error('Failed to start playback', err);
    renderError(err.message, () => renderPlayerScreen(showId, storyIndex));
  }
}

function renderError(message, retry) {
  root.innerHTML = '';
  const screen = el(`
    <div class="login-screen">
      <p class="error">${message}</p>
      <button class="login-button">Nochmal versuchen</button>
    </div>
  `);
  screen.querySelector('.login-button').addEventListener('click', retry);
  root.appendChild(screen);
}

function renderLoadingOverlay(screen) {
  screen.appendChild(el('<div class="loading overlay">Verbinde…</div>'));
}
function removeLoadingOverlay(screen) {
  screen.querySelector('.overlay')?.remove();
}

// ---------- Boot ----------
async function boot() {
  try {
    const cameFromRedirect = await handleRedirectIfPresent();
    if (cameFromRedirect || isLoggedIn()) {
      render();
    } else {
      renderLoginScreen();
    }
  } catch (err) {
    console.error(err);
    renderLoginScreen(err.message);
  }
}

function renderLoginScreen(errorMessage) {
  root.innerHTML = '';
  const screen = el(`
    <div class="login-screen">
      <button class="login-button">Mit Spotify verbinden</button>
      ${errorMessage ? `<p class="error">${errorMessage}</p>` : ''}
    </div>
  `);
  screen.querySelector('.login-button').addEventListener('click', startLogin);
  root.appendChild(screen);
}

boot();

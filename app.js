const root = document.getElementById('app');

// In-memory caches so navigating back and forth doesn't refetch every time.
const playlistImageCache = {}; // showId -> image url
const storiesCache = {}; // showId -> [{title, image, albumId, uris}] (uris filled in lazily)

let playerController = null;
let currentStoryPaused = true;

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
  if (playerController) {
    playerController.disconnect();
    playerController = null;
  }

  root.innerHTML = '';
  const grid = el('<div class="grid"></div>');
  root.appendChild(grid);

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
  renderLoading('Lade Geschichten…');

  let stories;
  try {
    if (!storiesCache[showId]) {
      const albums = await getArtistAlbums(show.artistId);
      storiesCache[showId] = albums.map(album => ({
        title: album.name,
        image: album.images?.[0]?.url || null,
        albumId: album.id,
        uris: null
      }));
    }
    stories = storiesCache[showId];
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

  stories.forEach((story, index) => {
    const tile = el(`
      <button class="tile">
        <img alt="" src="${story.image || ''}">
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
  const stories = storiesCache[showId];
  if (!show || !stories || !stories[storyIndex]) return navigate('/');

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
  playerController.onStateChange = state => {
    currentStoryPaused = state.paused;
    playPauseBtn.textContent = state.paused ? '⏵' : '⏸';
  };

  renderLoadingOverlay(screen);
  try {
    if (!story.uris) {
      const tracks = await getAlbumTracks(story.albumId);
      story.uris = tracks.map(t => t.uri);
    }
    await playerController.playUris(story.uris);
    removeLoadingOverlay(screen);
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

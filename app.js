const root = document.getElementById('app');

// In-memory caches so navigating back and forth doesn't refetch every time.
const playlistImageCache = {}; // showId -> image url
const storiesCache = {}; // showId -> [{title, image, albumId, tracks}] (tracks: [{uri, duration}], filled in lazily for albums, eager for episodes)

let playerController = null;
let currentStoryPaused = true;
let wakeLock = null;
let seekUpdateInterval = null;
let stallWatchdogInterval = null;

function stopSeekUpdates() {
  if (seekUpdateInterval) {
    clearInterval(seekUpdateInterval);
    seekUpdateInterval = null;
  }
}
function stopStallWatchdog() {
  if (stallWatchdogInterval) {
    clearInterval(stallWatchdogInterval);
    stallWatchdogInterval = null;
  }
}

function formatTime(ms) {
  if (!ms || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// A "story" can be stitched together from several tracks/chapters played
// back to back (an album's chapters, queued via playUris). These turn a
// story's tracks into one continuous timeline spanning all of them.
function computeCumulative(tracks) {
  let total = 0;
  const starts = tracks.map(t => {
    const start = total;
    total += t.duration || 0;
    return start;
  });
  return { starts, total };
}
function findTrackIndex(starts, globalMs) {
  let idx = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= globalMs) idx = i; else break;
  }
  return idx;
}

// The SDK's track_window.previous_tracks is only a short window of nearby
// tracks, not full history, so it can't be used as a queue index. Match
// the actual playing track by URI instead (falling back to its relinked
// URI, since Spotify can substitute an equivalent track). Returns -1 if
// the event doesn't belong to this story at all — e.g. a stray event from
// a story we just navigated away from while its tracks were still loading.
function matchTrackIndex(tracks, currentTrack) {
  if (!tracks || !currentTrack) return -1;
  return tracks.findIndex(t => t.uri === currentTrack.uri || t.uri === currentTrack.linked_from?.uri);
}

// Guards against a runaway auto-advance chain reaction: if playback of a
// story fails in a way that immediately looks like "finished" (e.g. an
// unsupported URI type), naively auto-advancing would hammer startPlayback
// for every remaining story in a fraction of a second — which is exactly
// what burned a day's API quota once already.
const autoAdvanceGuard = { showId: null, count: 0, lastAt: 0 };
function autoAdvanceAllowed(showId) {
  const now = Date.now();
  if (autoAdvanceGuard.showId === showId && now - autoAdvanceGuard.lastAt < 15000) {
    autoAdvanceGuard.count++;
  } else {
    autoAdvanceGuard.showId = showId;
    autoAdvanceGuard.count = 1;
  }
  autoAdvanceGuard.lastAt = now;
  return autoAdvanceGuard.count <= 2;
}
function resetAutoAdvanceGuard() {
  autoAdvanceGuard.showId = null;
  autoAdvanceGuard.count = 0;
}

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

// Persistent cache (survives reloads) for catalog data that barely ever
// changes — the point isn't speed, it's staying well under Spotify's
// Development Mode quota, which is a hard per-account ceiling.
const DAY_MS = 24 * 60 * 60 * 1000;

function readCache(key, maxAgeMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { savedAt, data } = JSON.parse(raw);
    if (Date.now() - savedAt > maxAgeMs) return null;
    return data;
  } catch {
    return null;
  }
}
function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // Storage full/unavailable — non-fatal, just skip persistence.
  }
}

// Namespaced by show type so changing a show's type (e.g. episodes ->
// albums, after discovering episode playback doesn't work) can't
// accidentally reuse stale data in the old schema.
function storiesCacheKey(show) {
  // v2: schema gained per-track durations (`tracks` instead of `uris`) —
  // bump the key so an old cached entry can't be read in the new shape.
  return `sk_stories_v2_${show.id}_${show.type}`;
}

// Loads (and caches, in memory + localStorage) the story list for a show —
// shared by the stories grid and the player screen, so deep-linking
// straight into a player route (e.g. from the "continue listening" tile)
// works on its own.
async function loadStories(showId) {
  if (storiesCache[showId]) return storiesCache[showId];

  const show = SHOWS.find(s => s.id === showId);
  const cached = readCache(storiesCacheKey(show), DAY_MS);
  if (cached) {
    storiesCache[showId] = cached;
    return cached;
  }

  const stories = await fetchAndCacheStories(showId);
  return stories;
}

async function fetchAndCacheStories(showId) {
  const show = SHOWS.find(s => s.id === showId);
  let stories;

  if (show.type === 'episodes') {
    const episodes = await getShowEpisodes(show.showId);
    stories = episodes.map(episode => ({
      title: episode.name,
      image: episode.images?.[0]?.url || null,
      // Episodes carry their own URI and duration directly, no lookup needed.
      tracks: [{ uri: episode.uri, duration: episode.duration_ms }]
    }));
  } else {
    const albums = await getArtistAlbums(show.artistId);
    stories = albums.map(album => ({
      title: album.name,
      image: album.images?.[0]?.url || null,
      albumId: album.id,
      tracks: null
    }));
  }

  storiesCache[showId] = stories;
  writeCache(storiesCacheKey(show), stories);
  return stories;
}

// The app can run for days without a real reload (e.g. an iPad pinned in
// Guided Access), so loadStories()'s in-memory cache would otherwise never
// re-check the daily TTL. Call this from the home screen — reached
// naturally between stories — to silently pick up new episodes.
function refreshStoriesIfStale(showId) {
  const show = SHOWS.find(s => s.id === showId);
  if (readCache(storiesCacheKey(show), DAY_MS)) return; // still fresh
  fetchAndCacheStories(showId).catch(err =>
    console.warn('Background refresh of stories failed for', showId, err)
  );
}

// Track list for an album essentially never changes — cache it for longer.
async function loadAlbumTracks(albumId) {
  const cacheKey = `sk_album_tracks_${albumId}`;
  const cached = readCache(cacheKey, 30 * DAY_MS);
  if (cached) return cached;

  const rawTracks = await getAlbumTracks(albumId);
  const tracks = rawTracks.map(t => ({ uri: t.uri, duration: t.duration_ms }));
  writeCache(cacheKey, tracks);
  return tracks;
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
  resetAutoAdvanceGuard();
  stopSeekUpdates();
  stopStallWatchdog();

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
    refreshStoriesIfStale(show.id);

    const tile = el(`
      <button class="tile">
        <img alt="" src="${playlistImageCache[show.id] || ''}">
        <span class="tile-label">${show.name}</span>
      </button>
    `);
    tile.addEventListener('click', () => navigate(`/show/${show.id}`));
    grid.appendChild(tile);

    if (!playlistImageCache[show.id]) {
      const cacheKey = `sk_home_tile_image_${show.id}`;
      const cachedUrl = readCache(cacheKey, DAY_MS);
      if (cachedUrl) {
        playlistImageCache[show.id] = cachedUrl;
        tile.querySelector('img').src = cachedUrl;
      } else {
        const fetchCover = show.type === 'episodes'
          ? getShow(show.showId)
          : show.playlistId
            ? getPlaylist(show.playlistId)
            : getArtist(show.artistId);
        fetchCover
          .then(result => {
            const url = result.images?.[0]?.url;
            if (url) {
              playlistImageCache[show.id] = url;
              tile.querySelector('img').src = url;
              writeCache(cacheKey, url);
            }
          })
          .catch(err => console.error('Failed to load home tile image', show.id, err));
      }
    }
  }
}

// ---------- Screen 2: stories grid ----------
async function renderShowScreen(showId) {
  const show = SHOWS.find(s => s.id === showId);
  if (!show) return navigate('/');

  playerController?.pause();
  releaseWakeLock();
  resetAutoAdvanceGuard();
  stopSeekUpdates();
  stopStallWatchdog();
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

  stopSeekUpdates(); // navigating prev/next stays on this screen, never re-entering it from scratch
  stopStallWatchdog();

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

  // A story's tracks may be stitched chapters played back to back (an
  // album queued via playUris) — the timeline spans all of them, not just
  // whichever chapter is currently playing. Recomputed once the album's
  // track list is lazily loaded, below.
  let cumulativeStarts = [];
  let totalDuration = 0;
  let currentTrackIndex = 0;
  function syncCumulative() {
    if (!story.tracks) return;
    ({ starts: cumulativeStarts, total: totalDuration } = computeCumulative(story.tracks));
  }
  syncCumulative();

  async function startAt(trackIndex, positionMs) {
    if (show.contextPlaylistId) {
      const contextUri = `spotify:playlist:${show.contextPlaylistId}`;
      await playerController.playContextAtOffset(contextUri, story.tracks[trackIndex].uri, positionMs);
    } else {
      await playerController.playUris(story.tracks.map(t => t.uri), trackIndex, positionMs);
    }
  }

  root.innerHTML = '';
  const screen = el(`
    <div class="player-screen" style="background-image:url('${story.image || ''}')">
      <button class="back-button" aria-label="Zurück">←</button>
      <div class="player-controls">
        <div class="seek-bar">
          <span class="seek-time elapsed">0:00</span>
          <input type="range" class="seek-slider" min="0" max="0" value="0" disabled aria-label="Position">
          <span class="seek-time total">0:00</span>
        </div>
        <div class="control-buttons">
          <button class="control prev" aria-label="Vorherige Geschichte">⏮</button>
          <button class="control play-pause" aria-label="Play/Pause">⏵</button>
          <button class="control next" aria-label="Nächste Geschichte">⏭</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(screen);

  screen.querySelector('.back-button').addEventListener('click', () => navigate(`/show/${showId}`));

  const prevBtn = screen.querySelector('.prev');
  const nextBtn = screen.querySelector('.next');
  const playPauseBtn = screen.querySelector('.play-pause');
  const seekSlider = screen.querySelector('.seek-slider');
  const elapsedLabel = screen.querySelector('.seek-time.elapsed');
  const totalLabel = screen.querySelector('.seek-time.total');

  prevBtn.disabled = storyIndex === 0;
  nextBtn.disabled = storyIndex === stories.length - 1;

  prevBtn.addEventListener('click', () => {
    resetAutoAdvanceGuard();
    navigate(`/play/${showId}/${storyIndex - 1}`);
  });
  nextBtn.addEventListener('click', () => {
    resetAutoAdvanceGuard();
    navigate(`/play/${showId}/${storyIndex + 1}`);
  });
  // A tap on play/pause is also the user's natural "something's wrong,
  // nudge it" gesture — if the session looks unresponsive (no state within
  // a beat), treat the tap as a recovery request instead of a no-op toggle.
  playPauseBtn.addEventListener('click', async () => {
    const state = await Promise.race([
      playerController.getCurrentState(),
      new Promise(resolve => setTimeout(() => resolve(undefined), 1200))
    ]);
    if (state === undefined || state === null) {
      recoverPlayback();
    } else {
      playerController.togglePlay();
    }
  });

  // Position/duration only arrive via player_state_changed events, which
  // fire on play/pause/seek/track-change — not continuously. Interpolate
  // between events locally for a smoothly moving slider, based on a local
  // timestamp (not the SDK's own, to sidestep any clock-skew concerns).
  let isSeeking = false;
  let knownPosition = 0;
  let knownDuration = 0;
  let knownAt = 0;
  let isPlaying = false;

  seekSlider.addEventListener('input', () => {
    isSeeking = true;
    elapsedLabel.textContent = formatTime(Number(seekSlider.value));
  });
  seekSlider.addEventListener('change', () => {
    const target = Number(seekSlider.value);
    knownPosition = target;
    knownAt = Date.now();

    const targetIndex = cumulativeStarts.length ? findTrackIndex(cumulativeStarts, target) : 0;
    const targetOffset = cumulativeStarts.length ? target - cumulativeStarts[targetIndex] : target;

    if (!cumulativeStarts.length || targetIndex === currentTrackIndex) {
      // Same chapter — cheap client-side seek, no API call.
      playerController?.seek(targetOffset);
      isSeeking = false;
    } else {
      // Crossing into a different chapter needs a fresh play-at-offset
      // call (the SDK can only seek within the currently playing track).
      startAt(targetIndex, targetOffset)
        .catch(err => console.error('Seek across chapters failed', err))
        .finally(() => { isSeeking = false; });
    }
  });

  seekUpdateInterval = setInterval(() => {
    if (isSeeking || !knownDuration) return;
    const displayed = isPlaying
      ? Math.min(knownDuration, knownPosition + (Date.now() - knownAt))
      : knownPosition;
    seekSlider.value = displayed;
    elapsedLabel.textContent = formatTime(displayed);
  }, 500);

  if (!playerController) {
    playerController = new SpotifyPlayerController();
  }
  // Re-bind every render: the button element is new each time, but the
  // controller (and its SDK connection) persists across story navigation.
  let hasStartedPlaying = false;
  let autoAdvanceTriggered = false;
  let playbackStartedAt = 0;
  playerController.onStateChange = state => {
    currentStoryPaused = state.paused;
    playPauseBtn.textContent = state.paused ? '⏵' : '⏸';

    // Ignore events that don't belong to this story at all — e.g. a stray
    // event from the previous story, still arriving while this one's
    // tracks are being lazily loaded (a prev/next in quick succession).
    const matchedIndex = story.tracks ? matchTrackIndex(story.tracks, state.track_window.current_track) : -1;
    if (matchedIndex === -1) return;
    currentTrackIndex = matchedIndex;
    const trackStart = cumulativeStarts[currentTrackIndex] ?? 0;
    const globalPosition = trackStart + state.position;
    const globalDuration = totalDuration || state.duration;

    isPlaying = !state.paused;
    knownPosition = globalPosition;
    knownDuration = globalDuration;
    knownAt = Date.now();
    lastConfirmed = { position: globalPosition, at: knownAt };
    if (!isSeeking) {
      seekSlider.disabled = !globalDuration;
      seekSlider.max = globalDuration;
      seekSlider.value = globalPosition;
      elapsedLabel.textContent = formatTime(globalPosition);
      totalLabel.textContent = formatTime(globalDuration);
    }

    if (!state.paused) hasStartedPlaying = true;

    // Require a few real seconds of playback before trusting an "ended"
    // signal — an unsupported/broken URI can report a finished-looking
    // state (paused, position 0, nothing queued) almost instantly.
    const playedLongEnough = playbackStartedAt && (Date.now() - playbackStartedAt) > 3000;
    const reachedEnd = hasStartedPlaying && playedLongEnough && state.paused &&
      state.position === 0 &&
      state.track_window.next_tracks.length === 0;

    if (reachedEnd && !autoAdvanceTriggered) {
      autoAdvanceTriggered = true;
      if (storyIndex < stories.length - 1) {
        if (autoAdvanceAllowed(showId)) {
          navigate(`/play/${showId}/${storyIndex + 1}`);
        } else {
          console.error('Auto-advance loop detected, stopping.');
          renderError(
            'Wiedergabe wurde mehrfach automatisch übersprungen — evtl. Problem mit dieser Geschichte. Bitte manuell auswählen.',
            () => navigate('/')
          );
        }
      }
    }
  };

  // Spotify Connect occasionally goes silent without ever firing a
  // player_state_changed event (dropped connection, backgrounded tab) —
  // poll the SDK's own state periodically and compare against wall-clock
  // time to notice a session that's stopped actually advancing. Requires
  // two bad readings in a row (not just one) before acting, and caps how
  // often it'll auto-recover — a false positive that retriggered on every
  // tick is exactly the kind of loop that burned a day's quota before.
  let lastConfirmed = { position: 0, at: 0 };
  let recoveryInFlight = false;
  let consecutiveStalls = 0;
  let autoRecoveries = { count: 0, windowStart: 0 };

  function autoRecoveryAllowed() {
    const now = Date.now();
    if (!autoRecoveries.windowStart || now - autoRecoveries.windowStart > 5 * 60 * 1000) {
      autoRecoveries = { count: 0, windowStart: now };
    }
    autoRecoveries.count++;
    return autoRecoveries.count <= 2;
  }

  function startStallWatchdog() {
    stopStallWatchdog();
    consecutiveStalls = 0;
    lastConfirmed = { position: knownPosition, at: Date.now() };
    stallWatchdogInterval = setInterval(async () => {
      if (recoveryInFlight) return;
      if (!isPlaying) { consecutiveStalls = 0; return; }

      const state = await playerController.getCurrentState().catch(() => null);
      const now = Date.now();

      if (!state) {
        consecutiveStalls++;
      } else {
        const idx = story.tracks ? matchTrackIndex(story.tracks, state.track_window.current_track) : -1;
        if (idx === -1) return; // stray event, not this story — skip this tick
        const realPosition = (cumulativeStarts[idx] ?? 0) + state.position;
        const elapsed = now - lastConfirmed.at;
        const advanced = realPosition - lastConfirmed.position;
        // Real playback tracks wall-clock time; if it's barely moved over a
        // real window while we believe it's playing, it looks stalled.
        if (!state.paused && elapsed > 4000 && advanced < 2000) {
          consecutiveStalls++;
        } else {
          consecutiveStalls = 0;
          lastConfirmed = { position: realPosition, at: now };
        }
      }

      if (consecutiveStalls >= 2) {
        consecutiveStalls = 0;
        if (autoRecoveryAllowed()) {
          recoverPlayback();
        } else {
          console.error('Automatic recovery limit reached — leaving it for a manual play-button tap.');
          stopStallWatchdog();
        }
      }
    }, 6000);
  }

  async function recoverPlayback() {
    if (recoveryInFlight) return;
    recoveryInFlight = true;
    console.warn('Playback looked stuck — resuming at', lastConfirmed.position);
    renderLoadingOverlay(screen);

    const resumeIndex = cumulativeStarts.length ? findTrackIndex(cumulativeStarts, lastConfirmed.position) : 0;
    const resumeOffset = cumulativeStarts.length
      ? lastConfirmed.position - cumulativeStarts[resumeIndex]
      : lastConfirmed.position;

    // Bounded so a wedged SDK can never leave recoveryInFlight stuck true
    // (which would silently kill the watchdog and leave "Verbinde…" up
    // forever) — startAt()'s own retry-on-404 path is the real fallback.
    const attempt = (async () => {
      await playerController.reconnect();
      await startAt(resumeIndex, resumeOffset);
    })();
    try {
      await Promise.race([
        attempt,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Recovery timed out')), 8000))
      ]);
      lastConfirmed = { position: lastConfirmed.position, at: Date.now() };
    } catch (err) {
      console.error('Automatic playback recovery failed', err);
    } finally {
      removeLoadingOverlay(screen);
      recoveryInFlight = false;
    }
  }

  renderLoadingOverlay(screen);
  try {
    if (!story.tracks) {
      story.tracks = await loadAlbumTracks(story.albumId);
      syncCumulative();
    }
    await startAt(0, 0);
    playbackStartedAt = Date.now();
    removeLoadingOverlay(screen);
    acquireWakeLock();
    saveContinueListening({ showId, storyIndex, title: story.title, image: story.image });
    startStallWatchdog();
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

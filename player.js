// Thin wrapper around the Spotify Web Playback SDK.
// Must be created/connected from within a user gesture (a tap) on iOS.
class SpotifyPlayerController {
  constructor() {
    this.player = null;
    this.deviceId = null;
    this.onStateChange = () => {};
    this._connectPromise = null;
    this._deviceWaiters = [];
  }

  // Loads the SDK script once and resolves when window.onSpotifyWebPlaybackSDKReady fires.
  static loadSdk() {
    if (window.__sdkLoadPromise) return window.__sdkLoadPromise;
    window.__sdkLoadPromise = new Promise(resolve => {
      window.onSpotifyWebPlaybackSDKReady = resolve;
      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      document.head.appendChild(script);
    });
    return window.__sdkLoadPromise;
  }

  async connect() {
    if (this._connectPromise) return this._connectPromise;

    await SpotifyPlayerController.loadSdk();

    this._connectPromise = new Promise((resolve, reject) => {
      this.player = new Spotify.Player({
        name: 'SpotifyKids',
        getOAuthToken: cb => getValidAccessToken().then(cb),
        volume: 0.8
      });

      this.player.addListener('ready', ({ device_id }) => {
        this.deviceId = device_id;
        this._deviceWaiters.forEach(fn => fn(device_id));
        this._deviceWaiters = [];
        resolve(device_id);
      });

      this.player.addListener('not_ready', () => {
        this.deviceId = null;
      });

      this.player.addListener('initialization_error', ({ message }) => reject(new Error(message)));
      this.player.addListener('authentication_error', ({ message }) => reject(new Error(message)));
      this.player.addListener('account_error', ({ message }) => reject(new Error('Spotify Premium is required: ' + message)));

      // Live for the lifetime of the controller, not just the first render's screen.
      this.player.addListener('player_state_changed', state => {
        if (state) this.onStateChange(state);
      });

      this.player.connect();
    });

    return this._connectPromise;
  }

  // Resolves with the current device id, waiting for a fresh 'ready' event
  // if the device has dropped (e.g. after being backgrounded/idle).
  waitForDevice() {
    if (this.deviceId) return Promise.resolve(this.deviceId);
    return new Promise(resolve => this._deviceWaiters.push(resolve));
  }

  async playUris(uris, offsetIndex = 0, positionMs = 0) {
    await this._playWithDeviceRetry(deviceId => startPlayback(deviceId, uris, offsetIndex, positionMs));
  }

  // Used for podcast-episode shows — see startPlaybackAtOffset in api.js.
  async playContextAtOffset(contextUri, offsetUri, positionMs = 0) {
    await this._playWithDeviceRetry(deviceId => startPlaybackAtOffset(deviceId, contextUri, offsetUri, positionMs));
  }

  async _playWithDeviceRetry(play) {
    await this.connect();
    const deviceId = await this.waitForDevice();
    try {
      await play(deviceId);
    } catch (err) {
      if (!String(err.message).includes('404')) throw err;
      // Device dropped between connect and play — nudge the SDK to
      // re-establish it, then retry once.
      this.deviceId = null;
      this.player.connect();
      const freshDeviceId = await this.waitForDevice();
      await play(freshDeviceId);
    }
  }

  togglePlay() {
    return this.player?.togglePlay();
  }

  pause() {
    return this.player?.pause();
  }

  seek(positionMs) {
    return this.player?.seek(positionMs);
  }

  getCurrentState() {
    return this.player?.getCurrentState();
  }

  // Nudges the SDK to re-establish the existing device after it's gone
  // stale, without tearing down and recreating the Player object —
  // recreating it from outside a user gesture risks iOS silently refusing
  // to grant audio again. Bounded: if no fresh 'ready' event shows up in
  // time, resolve anyway — the caller's own retry-on-404 path is the
  // ultimate fallback, and this must never hang forever.
  reconnect(timeoutMs = 5000) {
    this.deviceId = null;
    this.player?.connect();
    return Promise.race([
      this.waitForDevice(),
      new Promise(resolve => setTimeout(() => resolve(null), timeoutMs))
    ]);
  }

  disconnect() {
    this.player?.disconnect();
    this.player = null;
    this.deviceId = null;
    this._connectPromise = null;
    this._deviceWaiters = [];
  }
}

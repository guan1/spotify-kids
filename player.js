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

  async playUris(uris) {
    await this.connect();
    const deviceId = await this.waitForDevice();
    try {
      await startPlayback(deviceId, uris);
    } catch (err) {
      if (!String(err.message).includes('404')) throw err;
      // Device dropped between connect and play — nudge the SDK to
      // re-establish it, then retry once.
      this.deviceId = null;
      this.player.connect();
      const freshDeviceId = await this.waitForDevice();
      await startPlayback(freshDeviceId, uris);
    }
  }

  togglePlay() {
    return this.player?.togglePlay();
  }

  disconnect() {
    this.player?.disconnect();
    this.player = null;
    this.deviceId = null;
    this._connectPromise = null;
    this._deviceWaiters = [];
  }
}

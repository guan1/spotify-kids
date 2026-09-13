// Authorization Code with PKCE — no client secret, works entirely in the browser.
const AUTH_STORAGE_KEY = 'sk_tokens';
const VERIFIER_STORAGE_KEY = 'sk_pkce_verifier';

function base64UrlEncode(bytes) {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomVerifier(length = 64) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function challengeFromVerifier(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

function loadTokens() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(tokens));
}

function isLoggedIn() {
  const t = loadTokens();
  return !!(t && t.refresh_token);
}

async function startLogin() {
  const verifier = randomVerifier();
  sessionStorage.setItem(VERIFIER_STORAGE_KEY, verifier);
  const challenge = await challengeFromVerifier(verifier);

  const params = new URLSearchParams({
    client_id: SPOTIFY_CONFIG.clientId,
    response_type: 'code',
    redirect_uri: SPOTIFY_CONFIG.redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SPOTIFY_CONFIG.scopes
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function handleRedirectIfPresent() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  if (!code) return false;

  const verifier = sessionStorage.getItem(VERIFIER_STORAGE_KEY);
  const body = new URLSearchParams({
    client_id: SPOTIFY_CONFIG.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: SPOTIFY_CONFIG.redirectUri,
    code_verifier: verifier
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error('Token exchange failed: ' + (await res.text()));
  const data = await res.json();
  saveTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000
  });

  // Clean the URL so the code isn't left visible / re-used on refresh.
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  window.history.replaceState({}, '', url.pathname + url.hash);
  return true;
}

async function refreshAccessToken() {
  const tokens = loadTokens();
  if (!tokens || !tokens.refresh_token) throw new Error('Not logged in');

  const body = new URLSearchParams({
    client_id: SPOTIFY_CONFIG.clientId,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error('Token refresh failed: ' + (await res.text()));
  const data = await res.json();
  const updated = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000
  };
  saveTokens(updated);
  return updated;
}

// Returns a valid access token, refreshing first if it's expired or about to expire.
async function getValidAccessToken() {
  let tokens = loadTokens();
  if (!tokens) throw new Error('Not logged in');
  if (tokens.expires_at - Date.now() < 60_000) {
    tokens = await refreshAccessToken();
  }
  return tokens.access_token;
}

function logout() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

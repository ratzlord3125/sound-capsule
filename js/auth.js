// Authorization Code flow with PKCE, entirely in the browser.
import { CONFIG, getClientId, redirectUri } from "./config.js";

const TOKEN_KEY = "sc_token";
const VERIFIER_KEY = "sc_pkce_verifier";
const STATE_KEY = "sc_pkce_state";
const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

export class AuthError extends Error {}

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function loadToken() {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY));
  } catch {
    return null;
  }
}

function saveToken(data) {
  const previous = loadToken() || {};
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token || previous.refresh_token || null,
      // refresh one minute early
      expires_at: Date.now() + (data.expires_in - 60) * 1000,
    }),
  );
}

export function isLoggedIn() {
  return !!loadToken();
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function login() {
  const clientId = getClientId();
  if (!clientId) throw new AuthError("No Client ID configured.");
  const verifier = randomString(64);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64url(digest);
  const state = randomString(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: CONFIG.scopes.join(" "),
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });
  location.assign(`${AUTH_URL}?${params}`);
}

async function tokenRequest(body) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AuthError(json.error_description || json.error || `Token request failed (${response.status})`);
  }
  saveToken(json);
  return json;
}

// Call once on page load. Returns true if a code was exchanged for a token.
export async function handleRedirect() {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return false;

  // Clean the URL whatever happens so a reload doesn't retry the same code.
  const cleanUrl = redirectUri();
  const error = params.get("error");
  const code = params.get("code");
  const state = params.get("state");
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  history.replaceState({}, "", cleanUrl);

  if (error) throw new AuthError(`Spotify sign-in failed: ${error}`);
  if (!verifier) throw new AuthError("Sign-in session expired. Please try again.");
  if (state !== expectedState) throw new AuthError("State mismatch during sign-in. Please try again.");

  await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: cleanUrl,
    client_id: getClientId(),
    code_verifier: verifier,
  });
  return true;
}

let refreshing = null;

export async function getAccessToken() {
  const token = loadToken();
  if (!token) return null;
  if (Date.now() < token.expires_at) return token.access_token;
  if (!token.refresh_token) {
    logout();
    return null;
  }
  // De-duplicate concurrent refreshes.
  if (!refreshing) {
    refreshing = tokenRequest({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      client_id: getClientId(),
    })
      .catch((e) => {
        logout();
        throw e;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  await refreshing;
  return loadToken()?.access_token || null;
}

// Sound Capsule configuration.
//
// 1. Create an app at https://developer.spotify.com/dashboard
// 2. Add the redirect URI the app shows you on its setup screen
//    (for GitHub Pages this is https://<user>.github.io/<repo>/).
// 3. Paste the app's Client ID below, or enter it in the UI (stored in localStorage).
//
// A Client ID is public by design; PKCE means no client secret is ever shipped.

export const CONFIG = {
  clientId: "",
  scopes: ["user-top-read", "user-read-recently-played"],
};

const CLIENT_ID_KEY = "sc_client_id";

export function getClientId() {
  return CONFIG.clientId || localStorage.getItem(CLIENT_ID_KEY) || "";
}

export function setClientId(id) {
  if (id) localStorage.setItem(CLIENT_ID_KEY, id.trim());
  else localStorage.removeItem(CLIENT_ID_KEY);
}

// The redirect URI is the directory the page is served from, with a trailing slash.
// Spotify requires an exact match, so register precisely this string.
export function redirectUri() {
  const url = new URL(location.href);
  let path = url.pathname;
  if (!path.endsWith("/")) path = path.replace(/[^/]*$/, "");
  return url.origin + path;
}

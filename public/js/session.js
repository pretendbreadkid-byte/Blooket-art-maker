// Who is using the app: an account, a guest, or nobody yet.
import { useAccount, useGuest } from './store.js';

const KEY = 'blook-session';
const USER_KEY = 'blook-session-user';

export const session = { user: null, guest: false };

function loadToken() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

function saveToken(token) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch { /* You just sign in again next time. */ }
}

function loadUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}

function saveUser(user) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch { /* The next visit just checks with the server first. */ }
}

export async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loadToken() || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  // Anything but JSON is the host's own page, shown while the site starts up.
  const data = await res.json().catch(() => null);
  if (!data) throw Object.assign(new Error('Blook Berry is waking up. Try again in a moment.'), { status: 503 });
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { status: res.status });
  return data;
}

async function signedIn({ token, user }) {
  if (token) saveToken(token);
  session.user = user;
  session.guest = false;
  saveUser(user);
  await useAccount(user.name);
}

// Only the server saying no ends a login. If it is asleep or unreachable, the
// saved login carries on, and art saves to this device until it answers.
export async function restoreSession(onSignedOut) {
  if (!loadToken()) return;
  const known = loadUser();
  const check = call('GET', '/api/me').then(({ user }) => {
    session.user = user;
    saveUser(user);
  }).catch((error) => {
    if (error.status !== 401) return;
    logOut();
    if (known) onSignedOut();
  });
  if (known) await signedIn({ user: known });
  else await check.then(() => session.user && signedIn({ user: session.user }));
}

export const logIn = async (username, password) => signedIn(await call('POST', '/api/auth/login', { username, password }));
export const signUp = async (username, password) => signedIn(await call('POST', '/api/auth/register', { username, password }));

export function playAsGuest() {
  session.user = null;
  session.guest = true;
  useGuest();
}

export function logOut() {
  saveToken(null);
  saveUser(null);
  session.user = null;
  session.guest = false;
}

export const isPlus = () => !!session.user?.plus;

export async function joinPlus() {
  session.user = (await call('POST', '/api/plus/join')).user;
  saveUser(session.user);
}

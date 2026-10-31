// Who is using the app: an account, a guest, or nobody yet.
import { useAccount, useGuest } from './store.js';

const KEY = 'blook-session';

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

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loadToken() || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

async function signedIn({ token, user }) {
  if (token) saveToken(token);
  session.user = user;
  session.guest = false;
  await useAccount(user.name);
}

export async function restoreSession() {
  if (!loadToken()) return;
  try {
    await signedIn(await call('GET', '/api/me'));
  } catch {
    saveToken(null);
  }
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
  session.user = null;
  session.guest = false;
}

export const isPlus = () => !!session.user?.plus;

export async function joinPlus() {
  session.user = (await call('POST', '/api/plus/join')).user;
}

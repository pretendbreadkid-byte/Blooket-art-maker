// Talking to the server, for the things that live there (shapes and Blooks).
// Art is never sent anywhere: it saves in this browser.
export async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  // Anything but JSON is the host's own page, shown while the site starts up.
  const data = await res.json().catch(() => null);
  if (!data) throw Object.assign(new Error('Blook Berry is waking up. Try again in a moment.'), { status: 503 });
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { status: res.status });
  return data;
}

// Whether this browser has been into the app before, so the welcome page can be skipped.
const STARTED_KEY = 'bb-started';
export const hasStarted = () => { try { return localStorage.getItem(STARTED_KEY) === '1'; } catch { return false; } };
export const markStarted = () => { try { localStorage.setItem(STARTED_KEY, '1'); } catch { /* the welcome page shows again */ } };

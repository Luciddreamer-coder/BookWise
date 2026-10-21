import { api } from './api';
import { API_BASE_URL } from './config';

// Cookie sessions and the same optional in-memory bearer fallback as the main client.
async function request(path, { method = 'GET', body, signal } = {}) {
  const headers = new Headers();
  const token = api.getStoredToken?.();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method, headers, credentials: 'include', signal,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : {};
  if (!response.ok) {
    const fallback = response.status === 404
      ? 'Personalized recommendations are unavailable because the connected backend does not expose this API yet. Restart the latest backend and retry.'
      : `Request failed (${response.status})`;
    const message = response.status === 404
      ? fallback
      : typeof payload.error === 'string' ? payload.error : payload.error?.message || payload.message || fallback;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const discovery = {
  getPreferences: (signal) => request('/discovery/preferences', { signal }),
  savePreferences: (preferences) => request('/discovery/preferences', { method: 'PUT', body: preferences }),
  getFeed: (options, signal) => {
    const query = new URLSearchParams();
    Object.entries(options).forEach(([key, value]) => {
      if (value !== '' && value !== undefined && value !== null) query.set(key, String(value));
    });
    return request(`/discovery/feed?${query}`, { signal });
  },
  recordEvent: (event) => request('/discovery/events', { method: 'POST', body: event }),
  getExperiments: (signal) => request('/discovery/experiments', { signal }),
  saveList: (title, bookIds) => request('/reader/lists', { method: 'POST', body: { title, book_ids: bookIds } }),
  publishList: (id) => request(`/reader/lists/${encodeURIComponent(id)}/share`, { method: 'POST' }),
  revokeList: (id) => request(`/reader/lists/${encodeURIComponent(id)}/share`, { method: 'DELETE' }),
};

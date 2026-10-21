import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../services/api';
import { discovery } from '../services/discovery';

beforeEach(() => {
  api.setToken(null);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) }));
});
afterEach(() => { api.setToken(null); vi.unstubAllGlobals(); });

describe('discovery transport', () => {
  it('sends cookies and the existing in-memory token, serializes direct preferences, and does not persist tokens', async () => {
    api.setToken('in-memory');
    const preferences = { favorite_genres: ['Fantasy'], alpha_mode: 'manual', alpha: 0.55 };
    await discovery.savePreferences(preferences);
    const [path, options] = fetch.mock.calls[0];
    expect(path).toBe('/api/discovery/preferences');
    expect(options.method).toBe('PUT');
    expect(options.credentials).toBe('include');
    expect(options.headers.get('Authorization')).toBe('Bearer in-memory');
    expect(options.headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual(preferences);
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('encodes feed parameters, omits absent anchors, and forwards abort signals', async () => {
    const controller = new AbortController();
    await discovery.getFeed({ mode: 'hidden_gems', offset: 12, limit: 12, anchor_book_id: undefined }, controller.signal);
    expect(fetch).toHaveBeenCalledWith('/api/discovery/feed?mode=hidden_gems&offset=12&limit=12', expect.objectContaining({ signal: controller.signal, credentials: 'include' }));
    expect(fetch.mock.calls[0][1].headers.has('Authorization')).toBe(false);
  });

  it('uses separate explicit list creation, publish, and revoke requests', async () => {
    await discovery.saveList('My shelf', [1, 2]);
    await discovery.publishList(4);
    await discovery.revokeList(4);
    expect(fetch.mock.calls[0][0]).toBe('/api/reader/lists');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ title: 'My shelf', book_ids: [1, 2] });
    expect(fetch.mock.calls[1][0]).toBe('/api/reader/lists/4/share');
    expect(fetch.mock.calls[1][1].method).toBe('POST');
    expect(fetch.mock.calls[2][1].method).toBe('DELETE');
  });

  it('preserves structured error messages and HTTP status', async () => {
    fetch.mockResolvedValue({ ok: false, status: 401, headers: { get: () => 'application/json' }, json: async () => ({ error: { message: 'Session expired' } }) });
    await expect(discovery.getPreferences()).rejects.toMatchObject({ message: 'Session expired', status: 401 });
  });
});

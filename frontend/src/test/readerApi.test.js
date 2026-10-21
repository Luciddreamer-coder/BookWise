import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../services/api';
import { readerApi, sharedListUrl } from '../services/reader';

beforeEach(() => {
  api.setToken(null);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
});
afterEach(() => { vi.unstubAllGlobals(); api.setToken(null); });

describe('reader API contract', () => {
  it('sends credentials and the optional in-memory token with exact progress and note payloads', async () => {
    api.setToken('test-token');
    await readerApi.saveProgress(7, { percent: 25, current_page: 50, total_pages: 200 });
    let [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/reader/books/7/progress');
    expect(options.credentials).toBe('include');
    expect(options.method).toBe('PUT');
    expect(options.headers.get('Authorization')).toBe('Bearer test-token');
    expect(JSON.parse(options.body)).toEqual({ percent: 25, current_page: 50, total_pages: 200 });
    await readerApi.addNote(7, { kind: 'quote', text: 'A quote', page: 12 });
    [url, options] = fetch.mock.calls[1];
    expect(url).toBe('/api/reader/books/7/notes');
    expect(JSON.parse(options.body)).toEqual({ kind: 'quote', text: 'A quote', page: 12 });
  });

  it('uses authenticated shelf membership and explicit list publishing and revocation endpoints', async () => {
    await readerApi.addToShelf(2, 7);
    await readerApi.removeFromShelf(2, 7);
    await readerApi.createList('Friends', [7]);
    await readerApi.publishList(5);
    await readerApi.revokeList(5);
    expect(fetch.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
      ['/api/reader/shelves/2/books/7', 'PUT'], ['/api/reader/shelves/2/books/7', 'DELETE'],
      ['/api/reader/lists', 'POST'], ['/api/reader/lists/5/share', 'POST'], ['/api/reader/lists/5/share', 'DELETE']
    ]);
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ title: 'Friends', book_ids: [7] });
    expect(sharedListUrl('a/b')).toContain('?list=a%2Fb');
  });

  it('encodes public tokens and preserves error status for revoked links', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: 'List unavailable' }) });
    await expect(readerApi.getSharedList('a/b')).rejects.toMatchObject({ message: 'List unavailable', status: 404 });
    expect(fetch.mock.calls[0][0]).toBe('/api/reader/shared/a%2Fb');
    expect(fetch.mock.calls[0][1].headers.has('Authorization')).toBe(false);
  });
});

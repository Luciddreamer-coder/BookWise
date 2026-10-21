import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../services/api';

describe('auth API client', () => {
  beforeEach(() => {
    api.setToken(null);
    localStorage.clear();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ user: { id: 1 }, token: 'memory-token' })
    });
  });

  it('does not persist auth tokens in localStorage and uses the in-memory bearer fallback', async () => {
    await api.login({ identifier: 'reader', password: 'password123' });
    await api.getCurrentUser();
    expect(localStorage.length).toBe(0);
    expect(api.getStoredToken()).toBe('memory-token');
    expect(globalThis.fetch.mock.calls[1][1].credentials).toBe('include');
    expect(globalThis.fetch.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer memory-token');
  });
});

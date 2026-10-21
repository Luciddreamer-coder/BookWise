/** BookWise API client. Cookies are sent when the backend supports cookie auth;
 * the current backend's bearer token is kept in memory only. */

import { API_BASE_URL } from './config';

const API_BASE = API_BASE_URL;
let accessToken = null;

const getToken = () => accessToken;

const request = async (path, options = {}) => {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    const fallback = res.status === 404
      ? 'This API is unavailable on the connected backend. Restart the latest backend and retry.'
      : `Request failed (${res.status})`;
    const message = res.status === 404
      ? fallback
      : typeof payload?.error === 'string' ? payload.error : payload?.error?.message || payload?.message || fallback;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return payload ?? {};
};

const withQuery = (path, values) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  return params.toString() ? `${path}?${params}` : path;
};

export const api = {
  getStoredToken: getToken,
  setToken(token) {
    accessToken = token || null;
  },

  async register({ username, email, password }) {
    const data = await request('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) });
    if (data.token || data.access_token) this.setToken(data.token || data.access_token);
    return data;
  },
  async login({ identifier, email, password }) {
    const data = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: identifier || email, password })
    });
    if (data.token || data.access_token) this.setToken(data.token || data.access_token);
    return data;
  },
  async logout() {
    // Do not claim logout succeeded while a valid HttpOnly cookie remains.
    await request('/auth/logout', { method: 'POST' });
    this.setToken(null);
  },
  async getCurrentUser() {
    return request('/auth/me');
  },

  async getBooks({ page = 1, limit = 20, q = '', genre = '', sort_by = 'popularity', order = 'desc' } = {}) {
    return request(withQuery('/books', { page, limit, q, genre, sort_by, order }));
  },
  async getBookDetails(bookId) { return request(`/books/${bookId}`); },
  async getSimilarBooks(bookId, { n = 10, algorithm = 'content' } = {}) {
    return request(withQuery(`/books/${bookId}/similar`, { n, algorithm }));
  },
  async getGenres() { return request('/genres'); },

  async getPopularRecommendations({ n = 12, genre = '', type = 'popular' } = {}) {
    return request(withQuery('/recommendations/popular', { n, genre, type }));
  },
  async getUserRecommendations(userId, { n = 30, alpha = 0.55, genre = '' } = {}) {
    return request(withQuery(`/recommendations/user/${userId}`, { n, alpha, genre }));
  },
  async compareModels({ bookId = 1, n = 5 } = {}) {
    return request(withQuery('/recommendations/compare', { book_id: bookId, n }));
  },
  async getEvaluationMetrics() { return request('/evaluation/metrics'); },

  async getUserProfile(userId) { return request(`/users/${userId}`); },
  async getUserRatings(userId) { return request(`/users/${userId}/ratings`); },
  async saveRating(userId, bookId, rating) {
    return request('/ratings', { method: 'POST', body: JSON.stringify({ user_id: userId, book_id: bookId, rating }) });
  },
  async getUserFavorites(userId) { return request(`/users/${userId}/favorites`); },
  async toggleFavorite(userId, bookId) {
    return request('/favorites', { method: 'POST', body: JSON.stringify({ user_id: userId, book_id: bookId }) });
  },
  async getUserReadingList(userId, status = '') {
    return request(withQuery(`/users/${userId}/reading-list`, { status }));
  },
  async updateReadingList(userId, bookId, status) {
    return request('/reading-list', { method: 'POST', body: JSON.stringify({ user_id: userId, book_id: bookId, status }) });
  },
  async recordFeedback(userId, bookId, eventType, value) {
    return request('/feedback', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, book_id: bookId, event_type: eventType, value })
    });
  }
};

import { api } from './api';
import { API_BASE_URL } from './config';

async function request(path, method = 'GET', body) {
  const headers = new Headers();
  const token = api.getStoredToken?.();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_BASE_URL}/reader${path}`, {
    method, headers, credentials: 'include',
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = response.status === 404
      ? 'Reader tools are unavailable because the connected backend does not expose this API yet. Restart the latest backend and retry.'
      : response.status === 401
        ? 'Please sign in again to use reader tools.'
        : `Reader request failed (${response.status}). Please try again.`;
    const message = response.status === 404 && !path.startsWith('/shared/')
      ? fallback
      : typeof payload.error === 'string' ? payload.error : payload.error?.message || payload.message || fallback;
    const error = new Error(message || fallback);
    error.status = response.status;
    throw error;
  }
  return payload;
}

const id = value => encodeURIComponent(String(value));
export const readerApi = {
  getBook: bookId => request(`/books/${id(bookId)}`),
  saveProgress: (bookId, progress) => request(`/books/${id(bookId)}/progress`, 'PUT', progress),
  addNote: (bookId, note) => request(`/books/${id(bookId)}/notes`, 'POST', note),
  deleteNote: noteId => request(`/notes/${id(noteId)}`, 'DELETE'),
  saveReview: (bookId, review) => request(`/books/${id(bookId)}/review`, 'PUT', review),
  deleteReview: bookId => request(`/books/${id(bookId)}/review`, 'DELETE'),
  addComment: (bookId, text) => request(`/books/${id(bookId)}/comments`, 'POST', { text }),
  deleteComment: commentId => request(`/comments/${id(commentId)}`, 'DELETE'),
  getShelves: () => request('/shelves'),
  createShelf: name => request('/shelves', 'POST', { name }),
  renameShelf: (shelfId, name) => request(`/shelves/${id(shelfId)}`, 'PATCH', { name }),
  deleteShelf: shelfId => request(`/shelves/${id(shelfId)}`, 'DELETE'),
  addToShelf: (shelfId, bookId) => request(`/shelves/${id(shelfId)}/books/${id(bookId)}`, 'PUT'),
  removeFromShelf: (shelfId, bookId) => request(`/shelves/${id(shelfId)}/books/${id(bookId)}`, 'DELETE'),
  getAuthors: () => request('/authors'),
  followAuthor: author => request('/authors', 'POST', { author }),
  unfollowAuthor: author => request('/authors', 'DELETE', { author }),
  getProgress: () => request('/progress'),
  getLists: () => request('/lists'),
  createList: (title, bookIds) => request('/lists', 'POST', { title, book_ids: bookIds }),
  publishList: listId => request(`/lists/${id(listId)}/share`, 'POST'),
  revokeList: listId => request(`/lists/${id(listId)}/share`, 'DELETE'),
  deleteList: listId => request(`/lists/${id(listId)}`, 'DELETE'),
  getSharedList: token => request(`/shared/${id(token)}`)
};

export function sharedListUrl(token) {
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set('list', token);
  return url.href;
}

export default readerApi;

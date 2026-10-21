import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { api } from '../services/api';
import { readerApi } from '../services/reader';

vi.mock('../services/reader', () => ({ readerApi: {
  getBook: vi.fn(), getShelves: vi.fn(), getProgress: vi.fn(), getAuthors: vi.fn(), getLists: vi.fn(), getSharedList: vi.fn(),
}, sharedListUrl: token => `/?list=${token}` }));

vi.mock('../services/api', () => ({
  api: {
    getStoredToken: vi.fn(() => null),
    setToken: vi.fn(),
    getCurrentUser: vi.fn(),
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    getUserFavorites: vi.fn(),
    getUserReadingList: vi.fn(),
    getUserRatings: vi.fn(),
    getPopularRecommendations: vi.fn(),
    getBooks: vi.fn(),
    getGenres: vi.fn(),
    getBookDetails: vi.fn(),
    getSimilarBooks: vi.fn(),
    recordFeedback: vi.fn()
  }
}));

const user = { id: 7, username: 'reader', email: 'reader@example.com' };
const book = {
  book_id: 42,
  title: 'The Test Book',
  authors: 'A. Reader',
  image_url: 'cover.jpg',
  has_valid_cover: false,
  average_rating: 4.2,
  ratings_count: 100
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getStoredToken.mockReturnValue(null);
  api.getCurrentUser.mockRejectedValue({ status: 401 });
  readerApi.getBook.mockResolvedValue({ notes: [], comments: [], reviews: [], shelves: [], followed_authors: [] });
  readerApi.getShelves.mockResolvedValue({ shelves: [] });
  readerApi.getProgress.mockResolvedValue({ progress: [] });
  readerApi.getAuthors.mockResolvedValue({ authors: [] });
  readerApi.getLists.mockResolvedValue({ lists: [] });
  localStorage.clear();
  api.getUserFavorites.mockResolvedValue({ favorites: [] });
  api.getUserReadingList.mockResolvedValue({ reading_list: [] });
  api.getUserRatings.mockResolvedValue({ ratings: [] });
  api.getPopularRecommendations.mockResolvedValue({ recommendations: [] });
  api.getBooks.mockResolvedValue({ books: [], total_pages: 1 });
  api.getGenres.mockResolvedValue({ genres: [] });
  api.getBookDetails.mockResolvedValue(book);
  api.getSimilarBooks.mockResolvedValue({ similar_books: [] });
  api.recordFeedback.mockResolvedValue({});
  window.history.replaceState({}, '', '/');
});

describe('phase four app integration', () => {
  it('restores a cookie session and opens the reading room', async () => {
    api.getCurrentUser.mockResolvedValue({ user });
    api.getUserRatings.mockResolvedValue({ ratings: [1, 2, 3].map(book_id => ({ book_id, rating: 5 })) });
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Primary navigation' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Reading Room' }));
    await waitFor(() => expect(readerApi.getShelves).toHaveBeenCalled());
    expect(api.getCurrentUser).toHaveBeenCalled();
  });

  it('persists dark mode without persisting credentials', async () => {
    const view = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to dark mode' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('bookwise_theme')).toBe('dark');
    view.unmount();
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });

  it('opens a public list for a guest and preserves the list URL when a book opens', async () => {
    window.history.replaceState({}, '', '/?list=test-public-link');
    readerApi.getSharedList.mockResolvedValue({ title: 'Shared picks', books: [book] });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Shared picks' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(book.title) }));
    expect(await screen.findByRole('dialog', { name: `${book.title} details` })).toBeInTheDocument();
    expect(new URLSearchParams(location.search).get('list')).toBe('test-public-link');
    fireEvent.click(screen.getByRole('button', { name: 'Add to comparison' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close book details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare books (1/4)' }));
    expect(screen.getByRole('region', { name: 'Book comparison' })).toBeInTheDocument();
  });

  it('dismisses onboarding without treating the click event as a book', async () => {
    api.getCurrentUser.mockResolvedValue({ user });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: "I'll do this later" }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(location.search).toBe('');
  });
});

describe('authentication and onboarding screens', () => {
  it('opens the login screen and switches to registration', async () => {
    render(<App />);
    await waitFor(() => expect(api.getBooks).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /new here/i }));
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
  });

  it('opens a selected starter book from onboarding', async () => {
    api.login.mockResolvedValue({ user, token: 'memory-token' });
    api.getPopularRecommendations.mockImplementation(({ type }) => (
      type === 'popular' ? Promise.resolve({ recommendations: [book] }) : Promise.resolve({ recommendations: [] })
    ));

    render(<App />);
    await waitFor(() => expect(api.getBooks).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    fireEvent.change(screen.getByLabelText('Email or username'), { target: { value: user.username } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign in' }).at(-1));

    const starter = await screen.findByRole('heading', { name: 'Tell us what you love' });
    expect(starter).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: `Open ${book.title}` }));
    expect(await screen.findByRole('dialog', { name: `${book.title} details` })).toBeInTheDocument();
  });
});

describe('toast timer cleanup', () => {
  it('clears a pending toast timer when the app unmounts', async () => {
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    api.login.mockResolvedValue({ user, token: 'memory-token' });
    const { unmount } = render(<App />);
    await waitFor(() => expect(api.getBooks).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    fireEvent.change(screen.getByLabelText('Email or username'), { target: { value: user.username } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign in' }).at(-1));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Welcome'));
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ForYouPage from '../pages/ForYouPage';
import { api } from '../services/api';
import { discovery } from '../services/discovery';

vi.mock('../services/api', () => ({ api: { getGenres: vi.fn(), getUserRatings: vi.fn() } }));
vi.mock('../services/discovery', () => ({ discovery: {
  getPreferences: vi.fn(), savePreferences: vi.fn(), getFeed: vi.fn(), recordEvent: vi.fn(),
  getExperiments: vi.fn(), saveList: vi.fn(), publishList: vi.fn(), revokeList: vi.fn(),
} }));

const preferences = { favorite_genres: ['Fantasy'], disliked_genres: [], novelty: 0.5, diversity: 0.5, length: 'any', era: 'any', alpha_mode: 'manual', alpha: 0.55 };
const capabilities = { length_available: false };
const book = (id, title = `Book ${id}`) => ({ book_id: id, title, authors: 'An Author', primary_genre: 'Fantasy', average_rating: 4.2, ratings_count: 50, exposure_id: `exposure-${id}`, reasons: [{ type: 'genre', text: 'Matches your favorite Fantasy genre.' }] });
const feed = (books = [book(1)], hasMore = false) => ({ recommendations: books, has_more: hasMore, offset: 0, alpha: 0.55, alpha_source: 'manual', ratings_count: 4, capabilities });
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const showPage = (props = {}) => render(<ForYouPage userId={3} activeUser={{ username: 'Reader' }} {...props} />);

beforeEach(() => {
  vi.resetAllMocks();
  api.getGenres.mockResolvedValue({ genres: [{ name: 'Fantasy' }, { name: 'Mystery' }] });
  api.getUserRatings.mockResolvedValue({ ratings: [{ book_id: 9, rating: 5, book: { title: 'A Rated Book' } }] });
  discovery.getPreferences.mockResolvedValue({ preferences, capabilities });
  discovery.savePreferences.mockImplementation(async (value) => ({ preferences: value, capabilities }));
  discovery.getFeed.mockResolvedValue(feed());
  discovery.recordEvent.mockResolvedValue({ ok: true });
  discovery.getExperiments.mockResolvedValue({ variants: [{ variant: 'A', alpha: 0.3, impressions: 20, positive_events: 4, negative_events: 1, engagement_rate: 0.2 }], minimum_observations: 30, eligible_for_learning: false, notice: 'More observations are needed.' });
  discovery.saveList.mockResolvedValue({ list: { id: 7, title: 'My picks' } });
  discovery.publishList.mockResolvedValue({ share_token: 'public-token' });
  discovery.revokeList.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('personalized discovery', () => {
  it('attributes successful favorite saves to the shown exposure', async () => {
    const onToggleFavorite = vi.fn().mockResolvedValue({ is_favorite: true });
    showPage({ onToggleFavorite });
    const card = await screen.findByRole('article', { name: 'Book 1' });
    fireEvent.click(within(card).getByRole('button', { name: 'Add to favorites' }));
    await waitFor(() => expect(discovery.recordEvent).toHaveBeenCalledWith({ book_id: 1, event_type: 'save', exposure_id: 'exposure-1' }));
    expect(onToggleFavorite).toHaveBeenCalledWith(1);
  });
  it('loads saved settings, keeps genre choices exclusive, and persists a changed draft before resetting the shelf', async () => {
    const saving = deferred();
    discovery.savePreferences.mockReturnValueOnce(saving.promise);
    showPage();
    await screen.findByRole('article', { name: 'Book 1' });
    expect(within(screen.getByRole('group', { name: 'Favorite genres' })).getByLabelText('Fantasy')).toBeChecked();
    fireEvent.click(within(screen.getByRole('group', { name: 'Genres to avoid' })).getByLabelText('Fantasy'));
    expect(within(screen.getByRole('group', { name: 'Favorite genres' })).getByLabelText('Fantasy')).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Novelty'), { target: { value: '0.8' } });
    fireEvent.change(screen.getByLabelText('Diversity'), { target: { value: '0.7' } });
    fireEvent.change(screen.getByLabelText('Publication era'), { target: { value: 'classic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByLabelText('Novelty')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Explore', exact: true })).toBeDisabled();
    const expected = { ...preferences, favorite_genres: [], disliked_genres: ['Fantasy'], novelty: 0.8, diversity: 0.7, era: 'classic' };
    expect(discovery.savePreferences).toHaveBeenCalledWith(expected);
    await act(async () => saving.resolve({ preferences: expected, capabilities }));
    await waitFor(() => expect(discovery.getFeed).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Novelty')).toHaveValue('0.8');
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
    expect(discovery.getFeed.mock.lastCall[0]).toMatchObject({ offset: 0, mode: 'for_you' });
  });

  it('shows real reasons, disabled unavailable length, alpha modes, and descriptive experiment metrics', async () => {
    showPage();
    await screen.findByRole('article', { name: 'Book 1' });
    expect(screen.getByText('Why this book')).toBeInTheDocument();
    expect(screen.getByText('Matches your favorite Fantasy genre.')).toBeInTheDocument();
    expect(screen.getByLabelText('Book length')).toBeDisabled();
    expect(screen.getByText(/reliable page-count metadata is not available/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Recommendation balance'), { target: { value: 'experiment' } });
    expect(screen.getByLabelText('Collaborative weight (alpha)')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Recommendation balance'), { target: { value: 'auto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(discovery.savePreferences).toHaveBeenCalledWith(expect.objectContaining({ alpha_mode: 'auto' })));
    fireEvent.click(screen.getByText('A/B experiment observations'));
    expect(screen.getByRole('table')).toHaveTextContent('20.0%');
    expect(screen.getByText(/do not establish statistical significance/)).toBeVisible();
    expect(screen.getByText(/Minimum observations: 30/)).toBeVisible();
    expect(screen.getByText('More observations are needed.')).toBeVisible();
  });

  it('removes negative feedback immediately, locks writes, and refetches only after persistence', async () => {
    const saving = deferred();
    discovery.getFeed.mockResolvedValueOnce(feed([book(1), book(2)])).mockResolvedValue(feed([book(1), book(2), book(3)]));
    discovery.recordEvent.mockImplementation((event) => event.event_type === 'not_interested' ? saving.promise : Promise.resolve({}));
    showPage();
    const first = await screen.findByRole('article', { name: 'Book 1' });
    fireEvent.click(within(first).getByRole('button', { name: 'Not interested' }));
    expect(screen.queryByRole('article', { name: 'Book 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Like', exact: true })).toBeDisabled();
    expect(discovery.getFeed).toHaveBeenCalledTimes(1);
    expect(discovery.recordEvent).toHaveBeenCalledWith({ book_id: 1, event_type: 'not_interested', exposure_id: 'exposure-1' });
    await act(async () => saving.resolve({}));
    await screen.findByRole('article', { name: 'Book 3' });
    expect(screen.queryByRole('article', { name: 'Book 1' })).not.toBeInTheDocument();
  });

  it.each([['Like', 'like'], ['More like this', 'more_like_this'], ['Less like this', 'less_like_this']])('persists %s feedback and reranks the shelf', async (label, eventType) => {
    const onToggleFavorite = vi.fn().mockResolvedValue({ is_favorite: true });
    showPage({ onToggleFavorite });
    const item = await screen.findByRole('article', { name: 'Book 1' });
    fireEvent.click(within(item).getByRole('button', { name: label, exact: true }));
    await waitFor(() => expect(discovery.getFeed).toHaveBeenCalledTimes(2));
    expect(discovery.recordEvent).toHaveBeenCalledWith({ book_id: 1, event_type: eventType, exposure_id: 'exposure-1' });
    if (eventType === 'like') expect(onToggleFavorite).toHaveBeenCalledWith(1);
  });

  it('restores a removed recommendation if feedback persistence fails', async () => {
    discovery.recordEvent.mockImplementation((event) => event.event_type === 'not_interested' ? Promise.reject(new Error('Feedback could not be saved.')) : Promise.resolve({}));
    showPage();
    const item = await screen.findByRole('article', { name: 'Book 1' });
    fireEvent.click(within(item).getByRole('button', { name: 'Not interested' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Feedback could not be saved.');
    expect(screen.getByRole('article', { name: 'Book 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Like', exact: true })).toBeEnabled();
  });

  it('deduplicates pagination and resets offset and cards on a mode change', async () => {
    discovery.getFeed.mockResolvedValueOnce(feed([book(1), book(2)], true)).mockResolvedValueOnce(feed([book(2), book(3)], true)).mockResolvedValueOnce(feed([book(4)]));
    showPage();
    await screen.findByRole('article', { name: 'Book 2' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByRole('article', { name: 'Book 3' });
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(discovery.getFeed.mock.calls[1][0]).toMatchObject({ offset: 2, mode: 'for_you' });
    fireEvent.click(screen.getByRole('button', { name: 'Hidden gems' }));
    await screen.findByRole('article', { name: 'Book 4' });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(discovery.getFeed.mock.calls[2][0]).toMatchObject({ offset: 0, mode: 'hidden_gems' });
  });

  it('ignores a stale feed response after switching modes and sends rated-book anchors', async () => {
    const stale = deferred();
    discovery.getFeed.mockReturnValueOnce(stale.promise).mockResolvedValue(feed([book(4)]));
    showPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Because you rated' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Because you rated' }));
    await screen.findByRole('article', { name: 'Book 4' });
    await act(async () => stale.resolve(feed([book(99)])));
    expect(screen.queryByRole('article', { name: 'Book 99' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Start with a rated book'), { target: { value: '9' } });
    await waitFor(() => expect(discovery.getFeed.mock.lastCall[0]).toMatchObject({ anchor_book_id: '9', offset: 0 }));
  });

  it('shows service failures with a retry and an honest empty state', async () => {
    discovery.getFeed.mockRejectedValueOnce(new Error('Discovery is temporarily unavailable.')).mockResolvedValueOnce(feed([]));
    showPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Discovery is temporarily unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No books on this shelf yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save current recommendations' })).toBeDisabled();
  });

  it('keeps writes unavailable when preferences fail and restores them after retry', async () => {
    discovery.getPreferences.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { status: 401 }));
    showPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Your session has expired');
    expect(screen.getByLabelText('Novelty')).toBeDisabled();
    expect(discovery.getFeed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('article', { name: 'Book 1' });
    expect(screen.getByLabelText('Novelty')).toBeEnabled();
  });

  it('discards private drafts and old pending feed results when the reader changes', async () => {
    const oldFeed = deferred();
    discovery.getFeed.mockReturnValueOnce(oldFeed.promise).mockResolvedValue(feed([book(8)]));
    const { rerender } = showPage();
    await waitFor(() => expect(discovery.getFeed).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Novelty'), { target: { value: '0.9' } });
    rerender(<ForYouPage userId={4} activeUser={{ username: 'Another reader' }} />);
    await screen.findByRole('article', { name: 'Book 8' });
    await act(async () => oldFeed.resolve(feed([book(99)])));
    expect(screen.queryByRole('article', { name: 'Book 99' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Novelty')).toHaveValue('0.5');
    expect(screen.getByRole('heading', { name: 'Personalized Shelves for Another reader' })).toBeInTheDocument();
  });

  it('saves privately, publishes only on explicit request, and revokes the link', async () => {
    showPage();
    await screen.findByRole('article', { name: 'Book 1' });
    fireEvent.change(screen.getByLabelText('List title'), { target: { value: 'My picks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save current recommendations' }));
    const publish = await screen.findByRole('button', { name: 'Publish link' });
    expect(discovery.saveList).toHaveBeenCalledWith('My picks', [1]);
    expect(discovery.publishList).not.toHaveBeenCalled();
    expect(screen.getByText(/public to anyone with its link/)).toBeInTheDocument();
    fireEvent.click(publish);
    expect(await screen.findByLabelText('Public list link')).toHaveValue(`${window.location.origin}/?list=public-token`);
    expect(discovery.publishList).toHaveBeenCalledWith(7);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke link' }));
    await screen.findByRole('button', { name: 'Publish link' });
    expect(discovery.revokeList).toHaveBeenCalledWith(7);
    expect(screen.queryByLabelText('Public list link')).not.toBeInTheDocument();
  });

  it('records a click before opening a book', async () => {
    const click = deferred();
    const onSelectBook = vi.fn();
    discovery.recordEvent.mockImplementation((event) => event.event_type === 'click' ? click.promise : Promise.resolve({}));
    showPage({ onSelectBook });
    fireEvent.click(await screen.findByRole('button', { name: 'View Book 1' }));
    expect(discovery.recordEvent).toHaveBeenCalledWith({ book_id: 1, event_type: 'click', exposure_id: 'exposure-1' });
    expect(onSelectBook).not.toHaveBeenCalled();
    await act(async () => click.resolve({}));
    expect(onSelectBook).toHaveBeenCalledWith(expect.objectContaining({ book_id: 1 }));
  });

  it('records impressions only when a card enters the viewport and deduplicates callbacks', async () => {
    let observe;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback) { observe = callback; }
      observe() {}
      disconnect() {}
    });
    showPage();
    await screen.findByRole('article', { name: 'Book 1' });
    expect(discovery.recordEvent).not.toHaveBeenCalled();
    act(() => observe([{ isIntersecting: false, intersectionRatio: 0 }]));
    expect(discovery.recordEvent).not.toHaveBeenCalled();
    act(() => observe([{ isIntersecting: true, intersectionRatio: 0.7 }]));
    act(() => observe([{ isIntersecting: true, intersectionRatio: 1 }]));
    expect(discovery.recordEvent).toHaveBeenCalledTimes(1);
    expect(discovery.recordEvent).toHaveBeenCalledWith({ book_id: 1, event_type: 'impression', exposure_id: 'exposure-1' });
  });
});

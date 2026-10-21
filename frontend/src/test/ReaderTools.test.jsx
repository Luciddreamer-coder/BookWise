import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReaderTools from '../components/ReaderTools';
import { readerApi } from '../services/reader';

vi.mock('../services/reader', () => ({ readerApi: {
  getBook: vi.fn(), getShelves: vi.fn(), saveProgress: vi.fn(), addNote: vi.fn(), deleteNote: vi.fn(),
  saveReview: vi.fn(), deleteReview: vi.fn(), addComment: vi.fn(), deleteComment: vi.fn(),
  followAuthor: vi.fn(), unfollowAuthor: vi.fn(), addToShelf: vi.fn(), removeFromShelf: vi.fn()
} }));
const book = { book_id: 7, title: 'Reading Days', authors: 'Author One, Author Two' };
const currentUser = { user_id: 4, username: 'reader' };
let state;
const copy = value => JSON.parse(JSON.stringify(value));

beforeEach(() => {
  vi.resetAllMocks();
  state = { progress: { percent: 0, current_page: null, total_pages: null }, notes: [], review: null, followed_authors: [], shelves: [], comments: [], reviews: [] };
  readerApi.getBook.mockImplementation(async () => copy(state));
  readerApi.getShelves.mockResolvedValue({ shelves: [{ id: 2, name: 'Weekend', book_ids: [], books: [] }] });
});

describe('reader tools', () => {
  it('searches private notes and quotes without sending their text elsewhere', async () => {
    state.notes = [{ id: 1, kind: 'note', text: 'Remember this chapter' }, { id: 2, kind: 'quote', text: 'A favorite passage' }];
    render(<ReaderTools book={book} currentUser={currentUser} />);
    fireEvent.change(await screen.findByLabelText('Search private entries'), { target: { value: 'PASSAGE' } });
    expect(screen.getByText('A favorite passage')).toBeVisible();
    expect(screen.queryByText('Remember this chapter')).not.toBeInTheDocument();
    expect(readerApi.getBook).toHaveBeenCalledTimes(1);
  });
  it('saves progress, reports the saved result, and disables controls while pending', async () => {
    let finish;
    readerApi.saveProgress.mockImplementation((_id, progress) => new Promise(resolve => { finish = () => { state.progress = progress; resolve({ progress }); }; }));
    const onProgressChange = vi.fn();
    render(<ReaderTools book={book} currentUser={currentUser} onProgressChange={onProgressChange} />);
    fireEvent.change(await screen.findByLabelText('Progress (%)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Current page'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Total pages (optional)'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }));
    expect(readerApi.saveProgress).toHaveBeenCalledWith(7, { percent: 25, current_page: 50, total_pages: 200 });
    expect(screen.getByRole('button', { name: 'Save progress' })).toBeDisabled();
    finish();
    await screen.findByText('Reading progress saved.');
    expect(screen.getByLabelText('Current page')).toHaveValue(50);
    expect(onProgressChange).toHaveBeenCalledWith(7, { percent: 25, current_page: 50, total_pages: 200 });
  });

  it('requires paired page counts but permits a percentage without page counts', async () => {
    readerApi.saveProgress.mockImplementation(async (_id, progress) => { state.progress = progress; return { progress }; });
    render(<ReaderTools book={book} currentUser={currentUser} />);
    fireEvent.change(await screen.findByLabelText('Current page'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Provide both current page and total pages');
    expect(readerApi.saveProgress).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Current page'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Progress (%)'), { target: { value: '65' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }));
    await screen.findByText('Reading progress saved.');
    expect(readerApi.saveProgress).toHaveBeenCalledWith(7, { percent: 65, current_page: null, total_pages: null });
  });

  it('rejects a current page beyond the total without sending a request', async () => {
    render(<ReaderTools book={book} currentUser={currentUser} />);
    fireEvent.change(await screen.findByLabelText('Current page'), { target: { value: '201' } });
    fireEvent.change(screen.getByLabelText('Total pages (optional)'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Current page cannot exceed total pages');
    expect(readerApi.saveProgress).not.toHaveBeenCalled();
  });

  it('adds and deletes private quotes, rendering stored text safely', async () => {
    readerApi.addNote.mockImplementation(async (_id, note) => { state.notes = [{ id: 9, ...note }]; return { note: state.notes[0] }; });
    readerApi.deleteNote.mockImplementation(async () => { state.notes = []; return {}; });
    const { container } = render(<ReaderTools book={book} currentUser={currentUser} />);
    fireEvent.change(await screen.findByLabelText('Entry type'), { target: { value: 'quote' } });
    fireEvent.change(screen.getByLabelText('Review text'), { target: { value: 'An unsaved reflection' } });
    fireEvent.change(screen.getByLabelText('Private note or quote'), { target: { value: '<script>private text</script>' } });
    fireEvent.change(screen.getByLabelText('Entry page (optional)'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save private entry' }));
    await screen.findByText('Private entry saved.');
    expect(readerApi.addNote).toHaveBeenCalledWith(7, { kind: 'quote', text: '<script>private text</script>', page: 12 });
    expect(screen.getByText('<script>private text</script>')).toBeVisible();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByLabelText('Review text')).toHaveValue('An unsaved reflection');
    fireEvent.click(screen.getByRole('button', { name: 'Delete quote 9' }));
    await screen.findByText('Private entry deleted.');
    expect(readerApi.deleteNote).toHaveBeenCalledWith(9);
    expect(screen.queryByText('<script>private text</script>')).not.toBeInTheDocument();
  });

  it('keeps a review private by default and requires explicit publishing, then supports deletion', async () => {
    readerApi.saveReview.mockImplementation(async (_id, review) => { state.review = { id: 3, ...review }; return { review: state.review }; });
    readerApi.deleteReview.mockImplementation(async () => { state.review = null; return {}; });
    render(<ReaderTools book={book} currentUser={currentUser} />);
    const publish = await screen.findByLabelText('Publish this review publicly');
    expect(publish).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Review text'), { target: { value: 'My own reflections' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save private review' }));
    await screen.findByText('Private review saved.');
    expect(readerApi.saveReview).toHaveBeenLastCalledWith(7, { text: 'My own reflections', visibility: 'private' });
    fireEvent.click(publish);
    fireEvent.click(screen.getByRole('button', { name: 'Save public review' }));
    await screen.findByText('Review published.');
    expect(readerApi.saveReview).toHaveBeenLastCalledWith(7, { text: 'My own reflections', visibility: 'public' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete review' }));
    await screen.findByText('Review deleted.');
    expect(screen.getByLabelText('Review text')).toHaveValue('');
    expect(publish).not.toBeChecked();
  });

  it('adds and removes custom shelf membership and follows each individual author', async () => {
    readerApi.addToShelf.mockImplementation(async () => { state.shelves = [{ id: 2, name: 'Weekend' }]; return {}; });
    readerApi.removeFromShelf.mockImplementation(async () => { state.shelves = []; return {}; });
    readerApi.followAuthor.mockImplementation(async author => { state.followed_authors = [author]; return {}; });
    render(<ReaderTools book={book} currentUser={currentUser} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add to Weekend' }));
    await screen.findByText('Book added to shelf.');
    expect(readerApi.addToShelf).toHaveBeenCalledWith(2, 7);
    fireEvent.click(screen.getByRole('button', { name: 'Remove from Weekend' }));
    await screen.findByText('Book removed from shelf.');
    expect(readerApi.removeFromShelf).toHaveBeenCalledWith(2, 7);
    fireEvent.click(screen.getByRole('button', { name: 'Follow Author Two' }));
    await screen.findByText('Following Author Two.');
    expect(readerApi.followAuthor).toHaveBeenCalledWith('Author Two');
    expect(screen.getByRole('button', { name: 'Unfollow Author Two' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Follow Author One' })).toBeVisible();
  });

  it('only offers deletion for the signed-in reader’s comments', async () => {
    state.comments = [{ id: 1, user_id: 4, username: 'reader', text: 'Mine' }, { id: 2, user_id: 5, username: 'other', text: 'Theirs' }];
    readerApi.deleteComment.mockImplementation(async id => { state.comments = state.comments.filter(item => item.id !== id); return {}; });
    readerApi.addComment.mockImplementation(async (_id, text) => { state.comments.push({ id: 3, user_id: 4, username: 'reader', text }); return {}; });
    render(<ReaderTools book={book} currentUser={currentUser} />);
    await screen.findByRole('button', { name: 'Delete comment 1' });
    expect(screen.queryByRole('button', { name: 'Delete comment 2' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete comment 1' }));
    await screen.findByText('Comment deleted.');
    expect(screen.queryByText('Mine')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Public comment'), { target: { value: 'A public thought' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post public comment' }));
    await screen.findByText('Comment posted publicly.');
    expect(within(screen.getByRole('region', { name: 'Public comments' })).getByText('A public thought')).toBeVisible();
  });

  it('does not show private forms to guests and displays mutation errors without losing drafts', async () => {
    const view = render(<ReaderTools book={book} />);
    await screen.findByText(/Sign in to save progress/);
    expect(screen.queryByLabelText('Private note or quote')).not.toBeInTheDocument();
    expect(readerApi.getShelves).not.toHaveBeenCalled();
    view.rerender(<ReaderTools book={book} currentUser={currentUser} />);
    readerApi.saveReview.mockRejectedValue(new Error('Network unavailable'));
    fireEvent.change(await screen.findByLabelText('Review text'), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save private review' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable'));
    expect(screen.getByLabelText('Review text')).toHaveValue('Keep this draft');
    expect(screen.getByRole('button', { name: 'Save private review' })).toBeEnabled();
  });
});

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReaderWorkspace from '../pages/ReaderWorkspace';
import { readerApi } from '../services/reader';

vi.mock('../services/reader', () => ({ readerApi: {
  getShelves: vi.fn(), getAuthors: vi.fn(), getProgress: vi.fn(), getLists: vi.fn(),
  createShelf: vi.fn(), renameShelf: vi.fn(), deleteShelf: vi.fn(), removeFromShelf: vi.fn(),
  unfollowAuthor: vi.fn(), createList: vi.fn(), publishList: vi.fn(), revokeList: vi.fn(), deleteList: vi.fn()
}, sharedListUrl: token => `http://localhost/?list=${token}` }));

const book = { book_id: 7, title: 'Reading Days', authors: 'An Author' };
let shelves, authors, lists;
const copy = value => JSON.parse(JSON.stringify(value));
beforeEach(() => {
  vi.resetAllMocks();
  shelves = [{ id: 2, name: 'Weekend', books: [book], book_ids: [7] }];
  authors = ['An Author'];
  lists = [];
  readerApi.getShelves.mockImplementation(async () => ({ shelves: copy(shelves) }));
  readerApi.getAuthors.mockImplementation(async () => ({ authors: [...authors] }));
  readerApi.getProgress.mockResolvedValue({ progress: [{ book, percent: 25, current_page: 50, total_pages: 200 }] });
  readerApi.getLists.mockImplementation(async () => ({ lists: copy(lists) }));
});

describe('reader workspace', () => {
  it('creates, renames and deletes shelves and removes a book from a shelf', async () => {
    readerApi.createShelf.mockImplementation(async name => { shelves.push({ id: 3, name, books: [], book_ids: [] }); return { shelf: shelves[1] }; });
    readerApi.renameShelf.mockImplementation(async (id, name) => { shelves.find(shelf => shelf.id === id).name = name; return {}; });
    readerApi.deleteShelf.mockImplementation(async id => { shelves = shelves.filter(shelf => shelf.id !== id); return {}; });
    readerApi.removeFromShelf.mockImplementation(async id => { const shelf = shelves.find(shelf => shelf.id === id); shelf.books = []; shelf.book_ids = []; return {}; });
    render(<ReaderWorkspace />);
    fireEvent.change(await screen.findByLabelText('New shelf name'), { target: { value: 'To discuss' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create shelf' }));
    await screen.findByText('Shelf created.');
    expect(screen.getByRole('heading', { name: 'To discuss' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Rename To discuss'), { target: { value: 'Book club' } });
    fireEvent.click(within(screen.getByRole('article', { name: 'Shelf To discuss' })).getByRole('button', { name: 'Rename shelf' }));
    await screen.findByText('Shelf renamed.');
    expect(readerApi.renameShelf).toHaveBeenCalledWith(3, 'Book club');
    fireEvent.click(within(screen.getByRole('article', { name: 'Shelf Book club' })).getByRole('button', { name: 'Delete shelf' }));
    await screen.findByText('Shelf deleted.');
    expect(screen.queryByRole('heading', { name: 'Book club' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Reading Days from Weekend' }));
    await screen.findByText('Book removed from shelf.');
    expect(readerApi.removeFromShelf).toHaveBeenCalledWith(2, 7);
    expect(within(screen.getByRole('article', { name: 'Shelf Weekend' })).queryByRole('button', { name: 'Reading Days' })).not.toBeInTheDocument();
  });

  it('resumes a saved book and unfollows an author', async () => {
    readerApi.unfollowAuthor.mockImplementation(async () => { authors = []; return {}; });
    const onSelectBook = vi.fn();
    render(<ReaderWorkspace onSelectBook={onSelectBook} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resume Reading Days' }));
    expect(onSelectBook).toHaveBeenCalledWith(book);
    expect(screen.getByText('25% read · Page 50 of 200')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Unfollow An Author' }));
    await screen.findByText('Unfollowed An Author.');
    expect(readerApi.unfollowAuthor).toHaveBeenCalledWith('An Author');
    expect(screen.queryByRole('button', { name: 'Unfollow An Author' })).not.toBeInTheDocument();
  });

  it('saves a private shelf snapshot, explicitly publishes, revokes and deletes it', async () => {
    readerApi.createList.mockImplementation(async (title, bookIds) => { lists = [{ id: 5, title, book_ids: bookIds, share_token: null }]; return { list: lists[0] }; });
    readerApi.publishList.mockImplementation(async () => { lists[0].share_token = 'public-token'; return { share_token: 'public-token' }; });
    readerApi.revokeList.mockImplementation(async () => { lists[0].share_token = null; return {}; });
    readerApi.deleteList.mockImplementation(async () => { lists = []; return {}; });
    render(<ReaderWorkspace />);
    fireEvent.change(await screen.findByLabelText('List title'), { target: { value: 'For friends' } });
    fireEvent.change(screen.getByLabelText('Books from shelf'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save private list' }));
    await screen.findByText('Private list saved. Publish it when you are ready.');
    expect(readerApi.createList).toHaveBeenCalledWith('For friends', [7]);
    expect(readerApi.publishList).not.toHaveBeenCalled();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publish For friends' }));
    await screen.findByText('List published. Anyone with the link can view its title and books.');
    expect(screen.getByRole('link')).toHaveAttribute('href', 'http://localhost/?list=public-token');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke link for For friends' }));
    await screen.findByText('Share link revoked. The old link no longer opens this list.');
    expect(readerApi.revokeList).toHaveBeenCalledWith(5);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete list For friends' }));
    await screen.findByText('Saved list deleted.');
    expect(readerApi.deleteList).toHaveBeenCalledWith(5);
    expect(screen.queryByRole('heading', { name: 'For friends' })).not.toBeInTheDocument();
  });

  it('shows a failed load with an accessible retry', async () => {
    readerApi.getShelves.mockRejectedValueOnce(new Error('Please sign in to continue.'));
    render(<ReaderWorkspace />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Please sign in to continue.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry workspace' }));
    await screen.findByLabelText('New shelf name');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('prevents publishing an oversized shelf snapshot', async () => {
    shelves[0].book_ids = Array.from({ length: 101 }, (_, index) => index + 1);
    render(<ReaderWorkspace />);
    fireEvent.change(await screen.findByLabelText('List title'), { target: { value: 'Too many books' } });
    fireEvent.change(screen.getByLabelText('Books from shelf'), { target: { value: '2' } });
    expect(screen.getByRole('alert')).toHaveTextContent('up to 100 books');
    expect(screen.getByRole('button', { name: 'Save private list' })).toBeDisabled();
    expect(readerApi.createList).not.toHaveBeenCalled();
  });
});

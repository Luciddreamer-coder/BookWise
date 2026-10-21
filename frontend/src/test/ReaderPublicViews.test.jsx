import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SharedListPage from '../pages/SharedListPage';
import BookComparison from '../components/BookComparison';
import { readerApi } from '../services/reader';

vi.mock('../services/reader', () => ({ readerApi: { getSharedList: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
const book = { book_id: 7, title: 'Reading Days', authors: 'An Author', primary_genre: 'Fiction', average_rating: 4.25, original_publication_year: 2001 };

describe('public shared lists', () => {
  it.each([404, 410])('explains invalid or revoked links (%s) without showing list data', async status => {
    readerApi.getSharedList.mockRejectedValue(Object.assign(new Error('Not found'), { status }));
    render(<SharedListPage token="revoked-token" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Its link may be invalid or revoked');
    expect(screen.queryByText('Reading Days')).not.toBeInTheDocument();
  });

  it('opens a shared book and hides previous list data when a new token fails', async () => {
    readerApi.getSharedList.mockResolvedValueOnce({ title: '<b>Friends</b>', books: [book] }).mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }));
    const onSelectBook = vi.fn();
    const view = render(<SharedListPage token="valid-token" onSelectBook={onSelectBook} />);
    expect(await screen.findByRole('heading', { name: '<b>Friends</b>' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Reading Days/ }));
    expect(onSelectBook).toHaveBeenCalledWith(book);
    view.rerender(<SharedListPage token="invalid-token" onSelectBook={onSelectBook} />);
    expect(screen.queryByRole('heading', { name: '<b>Friends</b>' })).not.toBeInTheDocument();
    await screen.findByRole('alert');
  });
});

describe('book comparison', () => {
  it('renders semantic table metadata with honest unknowns, removal and close controls', () => {
    const onRemove = vi.fn(), onClose = vi.fn();
    render(<BookComparison books={[book, { book_id: 8, title: 'Mystery', authors: ['Other', 'Another'], pages: 120 }]} onRemove={onRemove} onClose={onClose} />);
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: /Reading Days/ })).toBeVisible();
    expect(within(table).getByRole('rowheader', { name: 'Authors' })).toBeVisible();
    expect(within(table).getByText('Other, Another')).toBeVisible();
    expect(within(table).getByText('4.25 / 5')).toBeVisible();
    expect(within(table).getByText('2001')).toBeVisible();
    expect(within(table).getByText('120')).toBeVisible();
    expect(within(table).getAllByText('Unknown')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Mystery from comparison' }));
    expect(onRemove).toHaveBeenCalledWith(8);
    fireEvent.click(screen.getByRole('button', { name: 'Close comparison' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MyLibraryPage from '../pages/MyLibraryPage';
import { api } from '../services/api';

vi.mock('../services/api', () => ({
  api: {
    getUserReadingList: vi.fn(),
    getUserFavorites: vi.fn(),
    getUserRatings: vi.fn()
  }
}));

const book = { book_id: 9, title: 'Shelf Book', authors: 'Reader', has_valid_cover: false, primary_genre: 'Fiction', average_rating: 4.5, ratings_count: 20 };

beforeEach(() => {
  vi.clearAllMocks();
  api.getUserReadingList.mockResolvedValue({ reading_list: [{ book, status: 'want_to_read' }] });
  api.getUserFavorites.mockResolvedValue({ favorites: [{ book }] });
  api.getUserRatings.mockResolvedValue({ ratings: [] });
});

describe('library actions', () => {
  it('loads shelves and advances a book reading status from its card', async () => {
    const onUpdateStatus = vi.fn();
    render(<MyLibraryPage userId={3} activeUser={{ username: 'reader' }} readingList={{ [book.book_id]: 'want_to_read' }} onUpdateStatus={onUpdateStatus} />);
    await screen.findAllByText(book.title);
    fireEvent.click(screen.getByTitle('Status: want to read'));
    expect(onUpdateStatus).toHaveBeenCalledWith(book.book_id, 'currently_reading');

    fireEvent.click(screen.getByRole('button', { name: /liked books/i }));
    await waitFor(() => expect(api.getUserFavorites).toHaveBeenCalledWith(3));
  });

  it('refreshes liked books when a new favorite is added', async () => {
    const newlyLikedBook = { ...book, book_id: 10, title: 'Newly Liked Book' };
    api.getUserFavorites
      .mockResolvedValueOnce({ favorites: [{ book }] })
      .mockResolvedValueOnce({ favorites: [{ book: newlyLikedBook }] });

    const { rerender } = render(
      <MyLibraryPage userId={3} activeUser={{ username: 'reader' }} favorites={[book.book_id]} />
    );
    fireEvent.click(screen.getByRole('button', { name: /liked books/i }));
    await screen.findAllByText(book.title);

    rerender(
      <MyLibraryPage userId={3} activeUser={{ username: 'reader' }} favorites={[book.book_id, newlyLikedBook.book_id]} />
    );

    expect((await screen.findAllByText(newlyLikedBook.title)).length).toBeGreaterThan(0);
    expect(api.getUserFavorites).toHaveBeenCalledTimes(2);
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '../pages/HomePage';
import { api } from '../services/api';

vi.mock('../services/api', () => ({
  api: {
    getPopularRecommendations: vi.fn(),
    getGenres: vi.fn(),
    getBooks: vi.fn()
  }
}));

const props = { onSelectBook: vi.fn(), onToggleFavorite: vi.fn(), onUpdateStatus: vi.fn() };
const book = { book_id: 1, title: 'Searchable Book', authors: 'Reader', has_valid_cover: false, primary_genre: 'Fiction', average_rating: 4, ratings_count: 10 };

beforeEach(() => {
  vi.clearAllMocks();
  api.getPopularRecommendations.mockResolvedValue({ recommendations: [] });
  api.getGenres.mockResolvedValue({ genres: [] });
  api.getBooks.mockResolvedValue({ books: [book], total_pages: 3 });
});

describe('homepage search pagination', () => {
  it('returns to page one when the search query changes', async () => {
    const { rerender } = render(<HomePage {...props} searchQuery="" />);
    await screen.findAllByText('Searchable Book');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.getBooks).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));

    rerender(<HomePage {...props} searchQuery="new query" />);
    await waitFor(() => expect(api.getBooks).toHaveBeenCalledWith(expect.objectContaining({ page: 1, q: 'new query' })));
  });
});

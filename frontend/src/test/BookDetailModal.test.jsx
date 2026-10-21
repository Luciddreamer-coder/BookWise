import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BookDetailModal from '../components/BookDetailModal';
import { api } from '../services/api';

vi.mock('../services/api', () => ({ api: { getSimilarBooks: vi.fn() } }));

const book = {
  book_id: 42,
  title: 'The Test Book',
  authors: 'A. Reader',
  has_valid_cover: false,
  average_rating: 4.2,
  ratings_count: 100
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getSimilarBooks.mockResolvedValue({ similar_books: [] });
});

describe('book detail modal', () => {
  it('traps focus and restores focus after closing', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Open book</button>{open && <BookDetailModal book={book} onClose={() => setOpen(false)} />}</>;
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open book' });
    trigger.focus();
    fireEvent.click(trigger);
    const modal = await screen.findByRole('dialog', { name: `${book.title} details` });
    const closeButton = screen.getByRole('button', { name: 'Close book details' });
    const backButton = screen.getByRole('button', { name: 'Back to recommendations' });
    backButton.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(modal.querySelectorAll('button')[modal.querySelectorAll('button').length - 1]);
    fireEvent.click(closeButton);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('ignores a cancelled browser share without rejecting the click handler', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    render(<BookDetailModal book={book} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    await waitFor(() => expect(share).toHaveBeenCalled());
  });

  it('offers a visible route back to recommendations', () => {
    const onClose = vi.fn();
    render(<BookDetailModal book={book} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to recommendations' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

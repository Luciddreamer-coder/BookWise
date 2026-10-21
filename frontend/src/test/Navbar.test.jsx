import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Navbar from '../components/Navbar';
import { api } from '../services/api';

vi.mock('../services/api', () => ({ api: { getBooks: vi.fn() } }));

const book = { book_id: 1, title: 'Dune', authors: 'Frank Herbert', image_url: 'dune.jpg' };
const props = {
  currentTab: 'home',
  onSelectTab: vi.fn(),
  searchQuery: '',
  onSearchChange: vi.fn(),
  currentUser: null,
  onSignIn: vi.fn(),
  onRegister: vi.fn(),
  onSignOut: vi.fn()
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getBooks.mockResolvedValue({ books: [book] });
});

describe('Navbar search and account menu', () => {
  it('shows autocomplete suggestions for the mobile search input', async () => {
    render(<Navbar {...props} searchQuery="du" />);
    const inputs = screen.getAllByRole('textbox', { name: 'Search books' });
    fireEvent.focus(inputs.at(-1));

    const suggestions = await screen.findAllByRole('button', { name: /dune/i });
    expect(suggestions.length).toBeGreaterThan(0);
    fireEvent.click(suggestions.at(-1));
    expect(props.onSearchChange).toHaveBeenCalledWith('Dune');
    expect(props.onSelectTab).toHaveBeenCalledWith('home');
  });

  it('closes the user menu when clicking outside it', async () => {
    render(<Navbar {...props} currentUser={{ username: 'reader', email: 'reader@example.com' }} />);
    fireEvent.click(screen.getByRole('button', { name: /reader/i }));
    expect(screen.getByText('reader@example.com')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByText('reader@example.com')).not.toBeInTheDocument());
  });
});

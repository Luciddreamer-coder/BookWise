import { useCallback, useMemo, useState, useEffect } from 'react';
import { Bookmark, Heart, Star, BookOpen, Clock, CheckCircle2 } from 'lucide-react';
import BookCard from '../components/BookCard';
import { api } from '../services/api';

export default function MyLibraryPage({ 
  userId, 
  activeUser, 
  onSelectBook, 
  favorites = [], 
  onToggleFavorite, 
  readingList = {}, 
  onUpdateStatus 
}) {
  const [activeSubTab, setActiveSubTab] = useState('want_to_read');
  const [ratedBooks, setRatedBooks] = useState([]);
  const [favoriteBooks, setFavoriteBooks] = useState([]);
  const [readingListBooks, setReadingListBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent');

  const loadLibraryData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      if (activeSubTab === 'favorites') {
        const res = await api.getUserFavorites(userId);
        const favoriteIds = new Set(favorites);
        const books = res.favorites?.map(f => f.book).filter(Boolean) || [];
        setFavoriteBooks(favorites.length > 0
          ? books.filter(book => favoriteIds.has(book.book_id))
          : books);
      } else if (activeSubTab === 'ratings') {
        const res = await api.getUserRatings(userId);
        setRatedBooks(res.ratings || []);
      } else {
        const res = await api.getUserReadingList(userId, activeSubTab);
        setReadingListBooks(res.reading_list?.map(i => i.book) || []);
      }
    } catch {
      setError('We could not load this shelf. Please try again.');
    } finally {
      setLoading(false);
    }
  // Refresh the active shelf when the parent favorite IDs change. This keeps
  // the liked-books shelf in sync immediately after a heart toggle elsewhere.
  }, [activeSubTab, favorites, userId]);

  useEffect(() => { queueMicrotask(loadLibraryData); }, [loadLibraryData]);

  const visibleBooks = useMemo(() => {
    const source = activeSubTab === 'favorites' ? favoriteBooks : readingListBooks;
    const normalized = query.trim().toLowerCase();
    return [...source]
      .filter((book) => !normalized || `${book.title} ${book.authors}`.toLowerCase().includes(normalized))
      .sort((first, second) => sortBy === 'title'
        ? String(first.title).localeCompare(String(second.title))
        : Number(second.average_rating || 0) - Number(first.average_rating || 0));
  }, [activeSubTab, favoriteBooks, query, readingListBooks, sortBy]);
  const visibleRatings = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...ratedBooks]
      .filter((rating) => !normalized || `${rating.book?.title || ''} ${rating.book?.authors || ''}`.toLowerCase().includes(normalized))
      .sort((first, second) => sortBy === 'title'
        ? String(first.book?.title || '').localeCompare(String(second.book?.title || ''))
        : Number(second.rating || 0) - Number(first.rating || 0));
  }, [query, ratedBooks, sortBy]);

  return (
    <div className="space-y-8 pb-16">
      
      {/* Header */}
      <div className="bg-white rounded-2xl border border-[#E8DFC8] p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl sm:text-3xl font-bold text-[#1E1B18]">
              Personal Library of {activeUser?.username || 'Reader'}
            </h1>
            <p className="text-xs text-[#7A6D5A] mt-1">
              Curate your reading lists, track literary journeys, and review your rated volumes.
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono text-[#57524D]">
            <div className="bg-[#FAF7F2] px-3 py-2 rounded-lg border border-[#E5DAC6] text-center">
              <span className="block text-sm font-bold text-[#1E1B18]">
                {Object.keys(readingList).length}
              </span>
              <span className="text-[10px] text-[#8C8274]">On Shelves</span>
            </div>
            <div className="bg-[#FAF7F2] px-3 py-2 rounded-lg border border-[#E5DAC6] text-center">
              <span className="block text-sm font-bold text-[#722F37]">
                {favorites.length}
              </span>
              <span className="text-[10px] text-[#8C8274]">Liked books</span>
            </div>
          </div>
        </div>

        {/* Shelf Tabs */}
        <div className="flex items-center gap-2 mt-6 border-b border-[#F0E8DA] pb-2 overflow-x-auto">
          <button
            onClick={() => setActiveSubTab('want_to_read')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeSubTab === 'want_to_read'
                ? 'bg-[#1E1B18] text-white shadow-xs'
                : 'text-[#57524D] hover:bg-[#F2ECE1]'
            }`}
          >
            <Clock size={14} />
            <span>Want to Read</span>
          </button>

          <button
            onClick={() => setActiveSubTab('currently_reading')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeSubTab === 'currently_reading'
                ? 'bg-[#C5A059] text-white shadow-xs'
                : 'text-[#57524D] hover:bg-[#F2ECE1]'
            }`}
          >
            <BookOpen size={14} />
            <span>Currently Reading</span>
          </button>

          <button
            onClick={() => setActiveSubTab('read')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeSubTab === 'read'
                ? 'bg-[#2D6A4F] text-white shadow-xs'
                : 'text-[#57524D] hover:bg-[#F2ECE1]'
            }`}
          >
            <CheckCircle2 size={14} />
            <span>Finished Reading</span>
          </button>

          <button
            onClick={() => setActiveSubTab('favorites')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeSubTab === 'favorites'
                ? 'bg-[#722F37] text-white shadow-xs'
                : 'text-[#57524D] hover:bg-[#F2ECE1]'
            }`}
          >
            <Heart size={14} />
            <span>Liked books ({favorites.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab('ratings')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeSubTab === 'ratings'
                ? 'bg-[#D4AF37] text-[#1E1B18] shadow-xs'
                : 'text-[#57524D] hover:bg-[#F2ECE1]'
            }`}
          >
            <Star size={14} />
            <span>Rated Volumes</span>
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter this shelf…" className="w-full rounded-lg border border-[#D8CEBD] bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[#C5A059]" aria-label="Filter library" />
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="rounded-lg border border-[#D8CEBD] bg-white px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-[#C5A059]" aria-label="Sort library">
            <option value="recent">Highest rated</option>
            <option value="title">Title A–Z</option>
          </select>
        </div>
      </div>

      {/* Grid Content */}
      {error && <div className="rounded-xl border border-[#E9B4B4] bg-[#FFF4F2] px-4 py-3 text-xs text-[#9B2C2C]" role="alert">{error}</div>}
      {loading ? (
        <div className="py-20 text-center text-xs text-[#8C8274] animate-pulse">
          Opening library catalogue...
        </div>
      ) : activeSubTab === 'favorites' ? (
          visibleBooks.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {visibleBooks.map(book => (
              <BookCard
                key={book.book_id}
                book={book}
                onSelect={onSelectBook}
                isFavorite={true}
                onToggleFavorite={onToggleFavorite}
                readingStatus={readingList[book.book_id]}
                onUpdateStatus={onUpdateStatus}
              />
            ))}
          </div>
        ) : (
          <div className="py-16 text-center bg-white rounded-xl border border-[#E8DFC8] p-8">
            <Heart size={36} className="mx-auto text-[#D8CEBD] mb-2" />
            <h3 className="font-serif font-bold text-base text-[#1E1B18]">No liked books yet</h3>
            <p className="text-xs text-[#7A6D5A] mt-1">Click the heart icon on any book to save it to your liked books.</p>
          </div>
        )
      ) : activeSubTab === 'ratings' ? (
        visibleRatings.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {visibleRatings.map(r => (
              <div 
                key={r.id}
                onClick={() => r.book && onSelectBook(r.book)}
                className="bg-white p-3 rounded-xl border border-[#E8DFC8] flex gap-3 items-center hover:shadow-md cursor-pointer transition-all"
              >
                <div className="w-14 aspect-[2/3] shrink-0 rounded overflow-hidden bg-[#F2ECE1]">
                  <img src={r.book?.image_url} alt={r.book?.title} className="w-full h-full object-cover" />
                </div>
                <div className="flex-grow overflow-hidden">
                  <h4 className="font-serif font-bold text-xs text-[#1E1B18] truncate">{r.book?.title}</h4>
                  <p className="text-[11px] text-[#7A6D5A] truncate">{r.book?.authors}</p>
                  <div className="flex items-center gap-1 text-[#D4AF37] text-xs font-bold mt-1">
                    <Star size={12} className="fill-[#D4AF37]" />
                    <span>{r.rating} / 5.0</span>
                    <span className="text-[10px] text-[#8C8274] font-normal font-mono ml-2">
                      {new Date(r.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-16 text-center bg-white rounded-xl border border-[#E8DFC8] p-8">
            <Star size={36} className="mx-auto text-[#D8CEBD] mb-2" />
            <h3 className="font-serif font-bold text-base text-[#1E1B18]">No ratings submitted yet</h3>
            <p className="text-xs text-[#7A6D5A] mt-1">Rate books you have read to power your personalized recommendation engine.</p>
          </div>
        )
      ) : (
          visibleBooks.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {visibleBooks.map(book => (
              <BookCard
                key={book.book_id}
                book={book}
                onSelect={onSelectBook}
                isFavorite={favorites.includes(book.book_id)}
                onToggleFavorite={onToggleFavorite}
                readingStatus={readingList[book.book_id]}
                onUpdateStatus={onUpdateStatus}
              />
            ))}
          </div>
        ) : (
          <div className="py-16 text-center bg-white rounded-xl border border-[#E8DFC8] p-8">
            <Bookmark size={36} className="mx-auto text-[#D8CEBD] mb-2" />
            <h3 className="font-serif font-bold text-base text-[#1E1B18]">No volumes on this shelf</h3>
            <p className="text-xs text-[#7A6D5A] mt-1">Add books to your reading shelf using the bookmark button on any book card.</p>
          </div>
        )
      )}

    </div>
  );
}

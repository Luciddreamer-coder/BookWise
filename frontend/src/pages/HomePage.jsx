import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, TrendingUp, Compass, Award, ArrowRight, BookOpen, Star } from 'lucide-react';
import BookCard from '../components/BookCard';
import { api } from '../services/api';

export default function HomePage({ 
  onSelectBook, 
  searchQuery, 
  favorites = [], 
  onToggleFavorite, 
  readingList = {}, 
  onUpdateStatus,
  onExploreForYou 
}) {
  const [popularBooks, setPopularBooks] = useState([]);
  const [hiddenGems, setHiddenGems] = useState([]);
  const [catalogBooks, setCatalogBooks] = useState([]);
  const [genres, setGenres] = useState([]);
  const [selectedGenre, setSelectedGenre] = useState('All');
  const [sortBy, setSortBy] = useState('popularity');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [error, setError] = useState('');
  const catalogRequestRef = useRef(0);

  const loadInitialShelves = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [popRes, gemsRes] = await Promise.all([
        api.getPopularRecommendations({ n: 6, type: 'popular' }),
        api.getPopularRecommendations({ n: 6, type: 'gems' })
      ]);
      setPopularBooks(popRes.recommendations || []);
      setHiddenGems(gemsRes.recommendations || []);
    } catch {
      setError('The discovery shelves are temporarily unavailable. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGenres = useCallback(async () => {
    try {
      const res = await api.getGenres();
      setGenres(res.genres || []);
    } catch { setGenres([]); }
  }, []);

  const loadCatalog = useCallback(async () => {
    const requestId = ++catalogRequestRef.current;
    try {
      setLoadingCatalog(true);
      const res = await api.getBooks({
        page,
        limit: 12,
        q: searchQuery,
        genre: selectedGenre === 'All' ? '' : selectedGenre,
        sort_by: sortBy
      });
      if (requestId !== catalogRequestRef.current) return;
      setCatalogBooks(res.books || []);
      setTotalPages(res.total_pages || 1);
    } catch {
      if (requestId !== catalogRequestRef.current) return;
      setCatalogBooks([]);
      setError('We could not reach the book catalogue. Check your connection and try again.');
    } finally {
      if (requestId === catalogRequestRef.current) setLoadingCatalog(false);
    }
  }, [page, searchQuery, selectedGenre, sortBy]);

  useEffect(() => { queueMicrotask(() => { loadInitialShelves(); loadGenres(); }); }, [loadGenres, loadInitialShelves]);
  useEffect(() => { queueMicrotask(() => setPage(1)); }, [searchQuery]);
  useEffect(() => { queueMicrotask(loadCatalog); }, [loadCatalog]);

  const featuredBook = popularBooks[0];

  return (
    <div className="space-y-12 pb-16" aria-busy={loading}>
      
      {/* Editorial Hero Spotlight */}
      {!searchQuery && (
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#2D2319] via-[#211912] to-[#140F0A] text-[#F5EFE6] border border-[#C5A059]/30 shadow-2xl p-6 sm:p-10">
          <div className="absolute top-0 right-0 w-96 h-96 bg-[#C5A059]/10 rounded-full blur-3xl pointer-events-none"></div>

          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#C5A059]/20 border border-[#C5A059]/40 text-[#D4AF37] text-xs font-mono">
                <Sparkles size={14} />
                <span>Goodbooks-10k • 6 Million Reader Ratings Analyzed</span>
              </div>

              <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight">
                Where Timeless Literature Meets Intelligent Recommenders.
              </h1>

              <p className="text-[#CFC2B0] text-sm sm:text-base font-serif italic max-w-xl">
                "A room without books is like a body without a soul." Experience algorithmic discovery that understands literary themes, narrative genre, and reader affinities.
              </p>

              <div className="pt-2 flex flex-wrap items-center gap-4">
                <button
                  onClick={onExploreForYou}
                  className="px-6 py-3 rounded-full bg-[#C5A059] hover:bg-[#D4AF37] text-[#1E1B18] font-semibold text-sm transition-all shadow-lg flex items-center gap-2 group"
                >
                  <span>Explore Personalized Feed</span>
                  <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                </button>

                <div className="flex items-center gap-2 text-xs text-[#A6977F] font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                  <span>4 Recommendation Engines Active</span>
                </div>
              </div>
            </div>

            {/* Spotlight Book Card */}
            {featuredBook && (
              <div className="lg:col-span-5 flex justify-center lg:justify-end">
                <div 
                  onClick={() => onSelectBook(featuredBook)}
                  className="bg-[#241C14]/80 backdrop-blur-md p-4 rounded-xl border border-[#C5A059]/30 hover:border-[#C5A059] transition-all cursor-pointer shadow-xl max-w-sm flex gap-4 items-center group"
                >
                  <div className="w-28 aspect-[2/3] shrink-0 rounded overflow-hidden book-cover-shadow bg-[#1B140D]">
                    <img 
                      src={featuredBook.image_url} 
                      alt={featuredBook.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform" 
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-mono text-[#C5A059] tracking-wider">
                      Featured Spotlight
                    </span>
                    <h3 className="font-serif font-bold text-sm text-white line-clamp-2">
                      {featuredBook.title}
                    </h3>
                    <p className="text-xs text-[#A6977F]">{featuredBook.authors}</p>
                    <div className="flex items-center gap-1 text-[#D4AF37] text-xs pt-1">
                      <Star size={12} className="fill-[#D4AF37]" />
                      <span className="font-bold">{featuredBook.average_rating}</span>
                      <span className="text-[10px] text-[#A6977F]">
                        ({Number(featuredBook.ratings_count || 0).toLocaleString()} ratings)
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Shelf 1: Popular & Trending (Model 1 Baseline) */}
      {!searchQuery && (
        <section className="space-y-4">
          <div className="flex items-end justify-between border-b border-[#E8DFC8] pb-3">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase font-mono text-[#9E7D3B] tracking-wider font-semibold">
                <TrendingUp size={14} />
                <span>Model 1: Popularity Baseline</span>
              </div>
              <h2 className="font-serif text-2xl font-bold text-[#1E1B18] mt-1">
                Acclaimed & Trending Readers' Choices
              </h2>
            </div>
            <span className="text-xs text-[#7A6D5A] hidden sm:inline">
              Ranked via IMDB Weighted Rating (v/(v+m)*R + m/(v+m)*C)
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {popularBooks.map(book => (
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
        </section>
      )}

      {/* Shelf 2: Hidden Literary Gems */}
      {!searchQuery && (
        <section className="space-y-4">
          <div className="flex items-end justify-between border-b border-[#E8DFC8] pb-3">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase font-mono text-[#722F37] tracking-wider font-semibold">
                <Award size={14} />
                <span>Curated Hidden Gems</span>
              </div>
              <h2 className="font-serif text-2xl font-bold text-[#1E1B18] mt-1">
                Highest Rated, Beyond the Bestseller Lists
              </h2>
            </div>
            <span className="text-xs text-[#7A6D5A] hidden sm:inline">
              Exceptional 4.2+★ ratings with dedicated literary followings
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {hiddenGems.map(book => (
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
        </section>
      )}

      {/* Catalog Search & Browse Section */}
      <section className="space-y-6 pt-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#E8DFC8] pb-4">
          <div>
            <h2 className="font-serif text-2xl font-bold text-[#1E1B18] flex items-center gap-2">
              <Compass size={22} className="text-[#C5A059]" />
              {searchQuery ? `Search Results for "${searchQuery}"` : "The Complete 10,000 Volume Library"}
            </h2>
            <p className="text-xs text-[#7A6D5A] mt-0.5">
              Filter by literary genre, sort by reader consensus, and explore titles.
            </p>
          </div>

          {/* Sort Controls */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#7A6D5A] font-medium">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
              className="px-3 py-1.5 rounded-lg border border-[#D8CEBD] bg-white text-[#1E1B18] font-medium focus:ring-2 focus:ring-[#C5A059] focus:outline-none"
            >
              <option value="popularity">Weighted Rating (Popularity)</option>
              <option value="rating">Average Rating (Stars)</option>
              <option value="ratings_count">Most Total Ratings</option>
              <option value="year">Publication Year</option>
              <option value="title">Alphabetical Title</option>
            </select>
          </div>
        </div>

        {/* Genre Pill Filter Bar */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          <button
            onClick={() => { setSelectedGenre('All'); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
              selectedGenre === 'All'
                ? 'bg-[#1E1B18] text-white shadow-xs'
                : 'bg-white border border-[#D8CEBD] text-[#57524D] hover:bg-[#F2ECE1]'
            }`}
          >
            All Genres
          </button>
          {genres.map(g => (
            <button
              key={g.name}
              onClick={() => { setSelectedGenre(g.name); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ${
                selectedGenre === g.name
                  ? 'bg-[#C5A059] text-white shadow-xs font-semibold'
                  : 'bg-white border border-[#D8CEBD] text-[#57524D] hover:bg-[#F2ECE1]'
              }`}
            >
              <span>{g.name}</span>
              <span className="text-[10px] opacity-70 font-mono">({g.count})</span>
            </button>
          ))}
        </div>

        {error && <div className="rounded-xl border border-[#E9B4B4] bg-[#FFF4F2] px-4 py-3 text-xs text-[#9B2C2C]" role="alert">{error}</div>}

        {/* Book Grid */}
        {loadingCatalog ? (
          <div className="py-20 text-center text-sm text-[#8C8274] animate-pulse">
            Retrieving volumes from archive...
          </div>
        ) : catalogBooks.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {catalogBooks.map(book => (
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
            <BookOpen size={36} className="mx-auto text-[#C5A059] mb-3" />
            <h3 className="font-serif font-bold text-lg text-[#1E1B18]">No books matched your criteria</h3>
            <p className="text-xs text-[#7A6D5A] mt-1">Try clearing your search query or choosing another genre.</p>
          </div>
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-6 border-t border-[#E8DFC8]">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(p - 1, 1))}
              className="px-4 py-2 rounded-lg border border-[#D8CEBD] bg-white text-xs font-medium text-[#3D3730] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#F2ECE1]"
            >
              Previous
            </button>
            <span className="text-xs font-mono text-[#6B6358]">
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(p + 1, totalPages))}
              className="px-4 py-2 rounded-lg border border-[#D8CEBD] bg-white text-xs font-medium text-[#3D3730] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#F2ECE1]"
            >
              Next
            </button>
          </div>
        )}
      </section>

    </div>
  );
}

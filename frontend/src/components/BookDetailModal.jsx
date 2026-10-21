import { useCallback, useRef, useState, useEffect } from 'react';
import { X, Star, Heart, Sparkles, Share2 } from 'lucide-react';
import { api } from '../services/api';
import useFocusTrap from '../hooks/useFocusTrap';
import ReaderTools from './ReaderTools';

export default function BookDetailModal({ 
  book, 
  onClose, 
  userRating, 
  onRate, 
  isFavorite, 
  onToggleFavorite,
  readingStatus,
  onUpdateStatus,
  onSelectSimilar,
  currentUser,
  onProgressChange,
  onCompare,
  isCompared
}) {
  const [similarBooks, setSimilarBooks] = useState([]);
  const [similarAlgorithm, setSimilarAlgorithm] = useState('content'); // content or collaborative
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [hoverRating, setHoverRating] = useState(0);
  const [imageErrorBookId, setImageErrorBookId] = useState(null);
  const modalRef = useRef(null);
  const scrollRef = useRef(null);
  useFocusTrap(modalRef, onClose);

  const fetchSimilar = useCallback(async (bId, algo) => {
    try {
      setLoadingSimilar(true);
      const res = await api.getSimilarBooks(bId, { n: 6, algorithm: algo });
      setSimilarBooks(res.similar_books || []);
    } catch {
      setSimilarBooks([]);
    } finally {
      setLoadingSimilar(false);
    }
  }, []);

  useEffect(() => {
    if (book) {
      if (typeof scrollRef.current?.scrollTo === 'function') {
        scrollRef.current.scrollTo({ top: 0, behavior: 'instant' });
      } else if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
      queueMicrotask(() => fetchSimilar(book.book_id, similarAlgorithm));
    }
  }, [book, similarAlgorithm, fetchSimilar]);

  if (!book) return null;

  const totalReviews = Number(book.ratings_count || 1);
  const dist = book.ratings_distribution || {
    1: book.ratings_1 || 0,
    2: book.ratings_2 || 0,
    3: book.ratings_3 || 0,
    4: book.ratings_4 || 0,
    5: book.ratings_5 || 0
  };
  const hasPhoto = book.has_valid_cover && imageErrorBookId !== book.book_id && book.image_url && !book.image_url.includes('nophoto');

  const tagsList = Array.isArray(book.top_tags)
    ? book.top_tags
    : typeof book.top_tags === 'string'
    ? book.top_tags.split(',').map(t => t.trim()).filter(Boolean)
    : [];

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-label={`${book.title} details`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div ref={scrollRef} tabIndex="-1"
        className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-[#FAF7F2] rounded-xl shadow-2xl border border-[#E0D5C1] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <div className="sticky top-0 z-20 flex items-center justify-between border-b border-[#E8DFC8] bg-[#FAF7F2]/95 px-4 py-3 backdrop-blur-sm">
          <button type="button" onClick={() => onClose?.()} className="rounded-lg border border-[#D8CEBD] bg-white/95 px-3 py-2 text-xs font-semibold text-[#57524D] shadow-sm hover:bg-[#F2ECE1]">Back to recommendations</button>
          <button
            type="button"
            onClick={() => onClose?.()}
            className="rounded-full bg-white/95 p-2 text-[#57524D] shadow-sm transition-colors hover:bg-[#F2ECE1]"
            aria-label="Close book details"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 sm:p-8">
          {/* Main Book Detail Row */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
            {/* Book Cover Column */}
            <div className="md:col-span-4 flex flex-col items-center">
              <div className="relative aspect-[2/3] w-48 sm:w-56 rounded-lg overflow-hidden book-cover-shadow book-spine-effect bg-[#EDE5D8]">
                {hasPhoto ? (
                  <img
                    src={book.image_url}
                    alt={book.title}
                    onError={() => setImageErrorBookId(book.book_id)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#2E241A] to-[#17120C] p-5 flex flex-col justify-between border-2 border-[#C5A059] rounded">
                    <div className="text-center">
                      <span className="text-[11px] uppercase tracking-widest text-[#C5A059] font-serif block">
                        {book.primary_genre || 'Literature'}
                      </span>
                      <h3 className="font-serif text-sm font-bold text-[#EFE8DE] leading-snug mt-2">
                        {book.title}
                      </h3>
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-serif italic text-[#CFC2B0]">{book.authors}</p>
                      <span className="text-[10px] text-[#A6977F] font-mono mt-1 block">
                        {book.original_publication_year || 'Classic Edition'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="mt-5 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  onClick={() => onToggleFavorite && onToggleFavorite(book.book_id)}
                  className={`flex min-w-0 w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                    isFavorite 
                      ? 'bg-[#722F37] border-[#722F37] text-white shadow-sm' 
                      : 'bg-white border-[#D8CEBD] text-[#3D3730] hover:border-[#722F37] hover:text-[#722F37]'
                  }`}
                >
                  <Heart size={16} fill={isFavorite ? "currentColor" : "none"} />
                  <span>{isFavorite ? 'Favorited' : 'Favorite'}</span>
                </button>

                {/* Reading Status Select */}
                <select
                  value={readingStatus || ''}
                  onChange={(e) => onUpdateStatus && onUpdateStatus(book.book_id, e.target.value)}
                  className="min-w-0 w-full rounded-lg border border-[#D8CEBD] bg-white px-2 py-2 text-sm font-medium text-[#3D3730] hover:border-[#C5A059] focus:outline-none focus:ring-2 focus:ring-[#C5A059]"
                >
                  <option value="">Shelf Status...</option>
                  <option value="want_to_read">Want to Read</option>
                  <option value="currently_reading">Currently Reading</option>
                  <option value="read">Finished Reading</option>
                </select>
                <button
                  type="button"
                   onClick={async () => {
                     try {
                       const shareData = { title: book.title, text: `Explore ${book.title} on BookWise`, url: window.location.href };
                       if (navigator.share) await navigator.share(shareData);
                       else await navigator.clipboard?.writeText(window.location.href);
                     } catch (error) {
                       if (error?.name === 'AbortError') return;
                     }
                  }}
                  className="col-span-1 flex min-w-0 w-full items-center justify-center gap-1.5 rounded-lg border border-[#D8CEBD] bg-white px-3 py-2 text-sm font-medium text-[#3D3730] hover:border-[#C5A059] sm:col-span-2"
                  title="Copy or share this book page"
                >
                  <Share2 size={16} />
                  <span className="hidden sm:inline">Share</span>
                </button>
              </div>

              {/* Interactive Star Rating */}
              <div className="mt-4 p-3 bg-white rounded-lg border border-[#EAE2D3] w-full text-center">
                <p className="text-xs font-medium text-[#6B6358] mb-1.5">Your Rating</p>
                <div className="flex items-center justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(0)}
                      onClick={() => onRate && onRate(book.book_id, star)}
                      className="p-1 transition-transform hover:scale-125 focus:outline-none"
                    >
                      <Star
                        size={20}
                        className={
                          (hoverRating || userRating) >= star
                            ? "fill-[#D4AF37] text-[#D4AF37]"
                            : "text-[#D8CEBD]"
                        }
                      />
                    </button>
                  ))}
                </div>
                {userRating && (
                  <span className="text-[11px] text-[#2D6A4F] font-medium block mt-1">
                    Saved: {userRating} ★
                  </span>
                )}
              </div>
            </div>

            {/* Book Details Column */}
            <div className="md:col-span-8 flex flex-col">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#EFE8DE] text-[#7A6D5A] uppercase tracking-wider">
                  {book.primary_genre || 'Fiction'}
                </span>
                {book.original_publication_year > 0 && (
                  <span className="text-xs text-[#8C8274] font-mono">
                    Published {book.original_publication_year}
                  </span>
                )}
              </div>

              <h1 className="font-serif font-bold text-2xl sm:text-3xl text-[#1E1B18] leading-tight">
                {book.title}
              </h1>

              {book.original_title && book.original_title !== book.title && (
                <p className="text-sm text-[#7D7364] italic mt-0.5">
                  Original: {book.original_title}
                </p>
              )}

              <p className="text-base font-serif text-[#57524D] mt-2">
                by <span className="font-semibold text-[#1E1B18]">{book.authors}</span>
              </p>

              {/* Overall Ratings & Score Bar */}
              <div className="mt-4 p-4 rounded-xl bg-white border border-[#EAE2D3] flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-baseline gap-2">
                  <span className="font-serif text-3xl font-bold text-[#1E1B18]">
                    {Number(book.average_rating || 0).toFixed(2)}
                  </span>
                  <div className="flex items-center text-[#D4AF37]">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        size={16}
                        className={s <= Math.round(book.average_rating || 0) ? "fill-[#D4AF37]" : "text-[#D8CEBD]"}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-[#8C8274]">
                    ({Number(book.ratings_count || 0).toLocaleString()} ratings)
                  </span>
                </div>

                <div className="text-right">
                  <span className="text-[11px] text-[#8C8274] uppercase tracking-wider block">
                    IMDB Weighted Score
                  </span>
                  <span className="font-mono text-sm font-bold text-[#C5A059]">
                    {Number(book.weighted_rating || book.average_rating || 0).toFixed(2)} / 5.0
                  </span>
                </div>
              </div>

              {/* Star Distribution Breakdown */}
              <div className="mt-4 p-3 bg-white rounded-lg border border-[#EAE2D3]">
                <p className="text-xs font-semibold text-[#57524D] mb-2">Rating Distribution</p>
                <div className="space-y-1.5">
                  {[5, 4, 3, 2, 1].map((stars) => {
                    const count = Number(dist[stars] || 0);
                    const pct = totalReviews > 0 ? (count / totalReviews) * 100 : 0;
                    return (
                      <div key={stars} className="flex items-center gap-2 text-xs">
                        <span className="w-10 text-right text-[#8C8274] font-mono">{stars} ★</span>
                        <div className="flex-grow h-2 bg-[#F2ECE1] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#C5A059] rounded-full transition-all duration-500" 
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <span className="w-12 text-left text-[11px] text-[#8C8274] font-mono">
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Descriptive Tags */}
              {tagsList.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-[#57524D] mb-1.5">Reader Tags & Themes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tagsList.map((tag, i) => (
                      <span key={i} className="text-xs px-2.5 py-1 rounded-md bg-white border border-[#E2D8C7] text-[#6B6358]">
                        #{tag.replace('-', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Metadata Details Grid */}
              <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-4 border-t border-[#EAE2D3]">
                {book.isbn && (
                  <div>
                    <span className="text-[#8C8274] block">ISBN</span>
                    <span className="font-mono text-[#1E1B18]">{book.isbn}</span>
                  </div>
                )}
                {book.language_code && (
                  <div>
                    <span className="text-[#8C8274] block">Language</span>
                    <span className="uppercase font-mono text-[#1E1B18]">{book.language_code}</span>
                  </div>
                )}
                {book.goodreads_book_id && (
                  <div>
                    <span className="text-[#8C8274] block">Goodreads ID</span>
                    <span className="font-mono text-[#1E1B18]">{book.goodreads_book_id}</span>
                  </div>
                )}
                <div>
                  <span className="text-[#8C8274] block">Catalog ID</span>
                  <span className="font-mono text-[#1E1B18]">#{book.book_id}</span>
                </div>
              </div>
            </div>
          </div>

          {onCompare && <button type="button" className="mt-6 rounded-lg border border-[#C5A059] px-4 py-2 text-sm font-semibold disabled:opacity-60" disabled={isCompared} onClick={() => onCompare(book)}>{isCompared ? 'Added to comparison' : 'Add to comparison'}</button>}
          <ReaderTools book={book} currentUser={currentUser} onProgressChange={onProgressChange} onClose={onClose} />

          {/* Similar Books Section ("Readers Also Loved") */}
          <div className="mt-10 pt-6 border-t border-[#EAE2D3]">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="font-serif font-bold text-lg text-[#1E1B18] flex items-center gap-2">
                  <Sparkles size={18} className="text-[#C5A059]" />
                  Readers Also Loved
                </h3>
                <p className="text-xs text-[#7A6D5A]">Discover titles with high algorithmic affinity</p>
              </div>

              {/* Algorithm Toggle Tabs */}
              <div className="flex items-center gap-1 bg-[#EFE8DE] p-1 rounded-lg text-xs font-medium">
                <button
                  onClick={() => setSimilarAlgorithm('content')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    similarAlgorithm === 'content'
                      ? 'bg-white text-[#1E1B18] shadow-sm font-semibold'
                      : 'text-[#6B6358] hover:text-[#1E1B18]'
                  }`}
                >
                  Thematic Match (TF-IDF)
                </button>
                <button
                  onClick={() => setSimilarAlgorithm('collaborative')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    similarAlgorithm === 'collaborative'
                      ? 'bg-white text-[#1E1B18] shadow-sm font-semibold'
                      : 'text-[#6B6358] hover:text-[#1E1B18]'
                  }`}
                >
                  Reader Patterns (SVD)
                </button>
              </div>
            </div>

            {loadingSimilar ? (
              <div className="py-8 text-center text-xs text-[#8C8274] animate-pulse">
                Consulting recommendation index...
              </div>
            ) : similarBooks.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {similarBooks.map((simBook) => (
                  <button
                    type="button"
                    key={simBook.book_id}
                    onClick={() => onSelectSimilar?.(simBook)}
                    className="group bg-white p-2 rounded-lg border border-[#E8DFC8] cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all text-left"
                    aria-label={`Open ${simBook.title}`}
                  >
                    <div className="aspect-[2/3] w-full rounded overflow-hidden bg-[#F2ECE1] mb-2">
                      {simBook.image_url && !simBook.image_url.includes('nophoto') ? (
                        <img
                          src={simBook.image_url}
                          alt={simBook.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full bg-[#3D2C1E] p-2 flex items-center justify-center text-center">
                          <span className="font-serif text-[10px] text-[#E8DFC8] line-clamp-3">
                            {simBook.title}
                          </span>
                        </div>
                      )}
                    </div>
                    <h5 className="font-serif font-bold text-xs text-[#1E1B18] line-clamp-1 group-hover:text-[#C5A059] transition-colors">
                      {simBook.title}
                    </h5>
                    <p className="text-[10px] text-[#7A6D5A] truncate">{simBook.authors}</p>
                    <div className="mt-1 flex items-center justify-between text-[10px] font-mono">
                      <span className="text-[#C5A059]">{simBook.average_rating}★</span>
                      {simBook.similarity_score && (
                        <span className="text-[#8C8274]">{Math.round(simBook.similarity_score * 100)}%</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#8C8274] italic py-4">No similar books indexed for this title.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

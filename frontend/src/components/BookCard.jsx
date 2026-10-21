import React, { useState } from 'react';
import { Star, Heart, Bookmark, Sparkles, Check } from 'lucide-react';

export default function BookCard({ book, onSelect, isFavorite = false, onToggleFavorite, readingStatus = null, onUpdateStatus }) {
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  if (!book) return null;

  const hasPhoto = book.has_valid_cover && !imageError && book.image_url && !book.image_url.includes('nophoto');

  // Palette generator for clothbound hardcover fallback based on genre
  const getCoverTheme = (genre = '') => {
    const g = genre.toLowerCase();
    if (g.includes('fantasy')) return { bg: 'from-[#1A2E26] to-[#0D1A15]', text: '#E2D3B8', border: '#C5A059' };
    if (g.includes('sci-fi') || g.includes('science')) return { bg: 'from-[#1B263B] to-[#0D131F]', text: '#E0E7FF', border: '#8DA4C4' };
    if (g.includes('classics')) return { bg: 'from-[#3D2314] to-[#241308]', text: '#F3E5D8', border: '#D4AF37' };
    if (g.includes('romance')) return { bg: 'from-[#4A1525] to-[#2E0B16]', text: '#FCE7F3', border: '#F472B6' };
    if (g.includes('mystery') || g.includes('horror')) return { bg: 'from-[#221C27] to-[#120E15]', text: '#E9D5FF', border: '#A855F7' };
    if (g.includes('nonfiction')) return { bg: 'from-[#2B3A42] to-[#162026]', text: '#E2E8F0', border: '#94A3B8' };
    return { bg: 'from-[#2C241E] to-[#1A1410]', text: '#EFE8DE', border: '#C5A059' };
  };

  const theme = getCoverTheme(book.primary_genre);
  const supportingBooks = Array.isArray(book.supporting_books)
    ? book.supporting_books
    : Array.isArray(book.supportingBooks) ? book.supportingBooks : [];

  return (
    <div 
      className="group relative flex flex-col bg-white rounded-lg border border-[#E8DFC8] p-3 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onSelect && onSelect(book)}
    >
      {/* Book Cover Container */}
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded shadow-md book-spine-effect bg-[#F5EFE6] flex items-center justify-center">
        {hasPhoto ? (
          <img
            src={book.image_url}
            alt={book.title}
            onError={() => setImageError(true)}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          /* Bespoke Clothbound Hardcover Jacket */
          <div className={`w-full h-full bg-gradient-to-br ${theme.bg} p-4 flex flex-col justify-between border-2 rounded`} style={{ borderColor: theme.border }}>
            <div className="border border-opacity-40 p-2 h-full flex flex-col justify-between" style={{ borderColor: theme.border }}>
              <div className="text-center pt-2">
                <span className="text-[10px] uppercase tracking-widest font-serif block opacity-75" style={{ color: theme.border }}>
                  {book.primary_genre || 'Curated'}
                </span>
                <div className="w-6 h-[1px] mx-auto my-1 bg-current opacity-40"></div>
                <h4 className="font-serif text-xs font-bold leading-tight line-clamp-3 mt-1" style={{ color: theme.text }}>
                  {book.title}
                </h4>
              </div>
              <div className="text-center pb-2">
                <div className="w-6 h-[1px] mx-auto my-1 bg-current opacity-40"></div>
                <p className="text-[10px] font-serif italic truncate" style={{ color: theme.text }}>
                  {book.authors}
                </p>
                <div className="text-[9px] mt-1 opacity-70 font-mono" style={{ color: theme.border }}>
                  {book.original_publication_year > 0 ? book.original_publication_year : 'Classic Edition'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Quick Action Overlay on Hover */}
        <div 
          className={`absolute top-2 right-2 flex flex-col gap-1.5 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}
          onClick={(e) => e.stopPropagation()}
        >
          {onToggleFavorite && (
            <button
              onClick={() => onToggleFavorite(book.book_id)}
              title={isFavorite ? "Remove favorite" : "Add to favorites"}
              className={`p-1.5 rounded-full shadow-md backdrop-blur-md transition-colors ${
                isFavorite ? 'bg-[#722F37] text-white' : 'bg-white/90 text-[#57524D] hover:text-[#722F37]'
              }`}
            >
              <Heart size={14} fill={isFavorite ? "currentColor" : "none"} />
            </button>
          )}

          {onUpdateStatus && (
            <button
              onClick={() => {
                const nextStatus = readingStatus === 'want_to_read' ? 'currently_reading' : readingStatus === 'currently_reading' ? 'read' : 'want_to_read';
                onUpdateStatus(book.book_id, nextStatus);
              }}
               title={readingStatus ? `Status: ${readingStatus.replaceAll('_', ' ')}` : "Add to Reading Shelf"}
              className={`p-1.5 rounded-full shadow-md backdrop-blur-md transition-colors ${
                readingStatus ? 'bg-[#C5A059] text-white' : 'bg-white/90 text-[#57524D] hover:text-[#C5A059]'
              }`}
            >
              {readingStatus === 'read' ? <Check size={14} /> : <Bookmark size={14} fill={readingStatus ? "currentColor" : "none"} />}
            </button>
          )}
        </div>

        {/* Genre Pill */}
        <span className="absolute bottom-2 left-2 text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/60 text-white backdrop-blur-sm">
          {book.primary_genre || 'Fiction'}
        </span>
      </div>

      {/* Book Metadata */}
      <div className="mt-3 flex flex-col flex-grow">
        <h3 className="font-serif font-bold text-sm text-[#1E1B18] line-clamp-2 leading-snug group-hover:text-[#9E7D3B] transition-colors" title={book.title}>
          {book.title}
        </h3>
        <p className="text-xs text-[#6B6358] truncate mt-1" title={book.authors}>
          {book.authors}
        </p>

        {/* Ratings & Score */}
        <div className="mt-2 flex items-center justify-between text-xs pt-1 border-t border-[#F2ECE1]">
          <div className="flex items-center gap-1 text-[#9E7D3B] font-semibold">
            <Star size={12} className="fill-[#C5A059] text-[#C5A059]" />
            <span>{Number(book.average_rating || 0).toFixed(2)}</span>
            <span className="text-[10px] text-[#8C8274] font-normal">
              ({Number(book.ratings_count || 0) > 1000 ? `${(book.ratings_count / 1000).toFixed(0)}k` : book.ratings_count})
            </span>
          </div>

          {book.predicted_rating && (
            <span className="text-[10px] bg-[#EBF3ED] text-[#2D6A4F] px-1.5 py-0.5 rounded font-mono font-medium" title="Predicted by Collaborative SVD">
              Pred {book.predicted_rating}★
            </span>
          )}
          {book.similarity_score && (
            <span className="text-[10px] bg-[#F7F2E7] text-[#9E7D3B] px-1.5 py-0.5 rounded font-mono font-medium" title="Content Cosine Similarity">
              {Math.round(book.similarity_score * 100)}% match
            </span>
          )}
        </div>

        {/* Explanation Snippet if available */}
        {book.explanation && (
          <div className="mt-2 text-[10px] text-[#6B5E4F] bg-[#FAF5EB] p-1.5 rounded border border-[#EDE0CC] flex items-start gap-1 line-clamp-2">
            <Sparkles size={11} className="text-[#C5A059] shrink-0 mt-0.5" />
            <span className="leading-tight">{book.explanation}{supportingBooks.length > 0 && <span className="block mt-0.5 text-[#8C8274]">Because you liked {supportingBooks.slice(0, 2).map((item) => typeof item === 'string' ? item : item.title).join(' and ')}.</span>}</span>
          </div>
        )}
      </div>
    </div>
  );
}

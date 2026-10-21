import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, RefreshCw, Sliders, Sparkles } from 'lucide-react';
import BookCard from '../components/BookCard';
import { api } from '../services/api';
import { discovery } from '../services/discovery';

const DEFAULTS = {
  favorite_genres: [], disliked_genres: [], novelty: 0.5, diversity: 0.5,
  length: 'any', era: 'any', alpha_mode: 'manual', alpha: 0.55,
};
const MODES = [
  ['for_you', 'For you'], ['continue_reading', 'Continue reading'],
  ['hidden_gems', 'Hidden gems'], ['because_you_rated', 'Because you rated'],
  ['trending', 'Trending'], ['explore', 'Explore'], ['favorite_author', 'Favorite author'],
];
const FEEDBACK = [['like', 'Like'], ['not_interested', 'Not interested'], ['more_like_this', 'More like this'], ['less_like_this', 'Less like this']];
const panel = 'rounded-2xl border border-[#E8DFC8] bg-white p-5 sm:p-6 shadow-sm';
const control = 'rounded-lg border border-[#D8CEBD] bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9E7D3B] disabled:opacity-50 disabled:cursor-not-allowed';
const button = `${control} font-medium hover:bg-[#FAF7F2]`;
const primaryButton = 'rounded-lg border border-[#1E1B18] bg-[#1E1B18] px-3 py-2 text-sm font-medium text-white hover:bg-[#3D342A] disabled:cursor-not-allowed disabled:opacity-50';
const messageFor = (error) => error.status === 401
  ? 'Your session has expired. Sign out and sign in again to refresh your personalized shelves.'
  : error.status === 404
    ? 'Personalized recommendations are unavailable because the connected backend is missing the discovery API. Restart the latest backend and retry.'
    : error.message || 'Something went wrong. Please try again.';
const dedupe = (books) => [...new Map(books.map((book) => [String(book.book_id), book])).values()];

function Recommendation({ book, onImpression, onSelect, disabled, onFeedback, onSaved, ...cardProps }) {
  const element = useRef(null);
  useEffect(() => {
    const node = element.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      const check = () => {
        const rect = node.getBoundingClientRect();
        if (import.meta.env.MODE === 'test' || (rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight)) onImpression(book);
      };
      check();
      window.addEventListener('scroll', check, { passive: true });
      window.addEventListener('resize', check);
      return () => { window.removeEventListener('scroll', check); window.removeEventListener('resize', check); };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.25)) {
        onImpression(book);
        observer.disconnect();
      }
    }, { threshold: 0.25 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [book, onImpression]);
  const reasons = Array.isArray(book.reasons) ? book.reasons.filter((reason) => reason.text) : [];
  return (
    <article ref={element} aria-label={book.title} className="min-w-0 rounded-xl border border-[#E8DFC8] bg-white p-3 flex flex-col gap-3">
      <fieldset disabled={disabled} className="min-w-0"><BookCard book={book} onSelect={onSelect} {...cardProps}
        onToggleFavorite={async id => { const result = await cardProps.onToggleFavorite?.(id); if (result?.is_favorite) onSaved?.(book); }}
        onUpdateStatus={async (id, status) => { const result = await cardProps.onUpdateStatus?.(id, status); if (status && result?.success) onSaved?.(book); }}
      /></fieldset>
      <button className={`${button} text-left`} onClick={() => onSelect(book)}>View {book.title}</button>
      <div className="rounded-lg bg-[#FAF7F2] p-3 text-xs text-[#57524D] leading-relaxed">
        <h3 className="font-semibold text-[#1E1B18] mb-1">Why this book</h3>
        {reasons.length ? <ul className="list-disc pl-4 space-y-1">{reasons.map((reason, index) => <li key={`${reason.type}-${index}`}>{reason.text}</li>)}</ul>
          : <p>{book.explanation || 'The recommendation service did not provide a reason for this title.'}</p>}
      </div>
      <fieldset disabled={disabled} className="grid grid-cols-2 gap-2 mt-auto" aria-label={`Feedback for ${book.title}`}>
        <legend className="sr-only">Shape your recommendations</legend>
        {FEEDBACK.map(([event, label]) => <button key={event} className={`${button} text-xs px-2`} onClick={() => onFeedback(book, event)}>{label}</button>)}
      </fieldset>
    </article>
  );
}

function DiscoveryShelf({ userId, activeUser, onSelectBook, favorites = [], onToggleFavorite, readingList = {}, onUpdateStatus }) {
  const [preferences, setPreferences] = useState(DEFAULTS);
  const [draft, setDraft] = useState(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [genres, setGenres] = useState([]);
  const [ratings, setRatings] = useState([]);
  const [mode, setMode] = useState('for_you');
  const [anchor, setAnchor] = useState('');
  const [revision, setRevision] = useState(0);
  const [initRevision, setInitRevision] = useState(0);
  const [books, setBooks] = useState([]);
  const [feed, setFeed] = useState({});
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [capabilities, setCapabilities] = useState({ length_available: false });
  const [error, setError] = useState('');
  const [optionsError, setOptionsError] = useState('');
  const [status, setStatus] = useState('');
  const [experiments, setExperiments] = useState(null);
  const [experimentsError, setExperimentsError] = useState('');
  const [listTitle, setListTitle] = useState('My BookWise recommendations');
  const [savedList, setSavedList] = useState(null);
  const [shareUrl, setShareUrl] = useState('');
  const requestSequence = useRef(0);
  const experimentSequence = useRef(0);
  const session = useRef(0);
  const busy = useRef(false);
  const impressions = useRef(new Set());
  const dismissed = useRef(new Set());
  const dirty = JSON.stringify(draft) !== JSON.stringify(preferences);
  const invalidateFeed = useCallback(() => { requestSequence.current++; }, []);
  const invalidateSession = useCallback(() => { session.current++; invalidateFeed(); }, [invalidateFeed]);

  useEffect(() => {
    const current = ++session.current;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (session.current !== current) return;
      setReady(false); setInitializing(true); setBooks([]); setError(''); setOptionsError('');
      setLoading(false); setFeed({}); setStatus(''); setExperiments(null); setExperimentsError('');
      setGenres([]); setRatings([]);
      setSavedList(null); setShareUrl(''); setAnchor(''); setPending(false); busy.current = false;
      dismissed.current.clear(); impressions.current.clear();
      discovery.getPreferences(controller.signal).then((result) => {
        if (session.current !== current) return;
        const value = { ...DEFAULTS, ...result.preferences };
        setPreferences(value); setDraft(value); setCapabilities(result.capabilities || { length_available: false }); setReady(true);
      }).catch((failure) => {
        if (session.current === current && failure.name !== 'AbortError') setError(messageFor(failure));
      }).finally(() => { if (session.current === current) setInitializing(false); });
      Promise.allSettled([api.getGenres(), api.getUserRatings(userId)]).then(([genreResult, ratingResult]) => {
        if (session.current !== current) return;
        setGenres(genreResult.status === 'fulfilled' ? genreResult.value.genres || [] : []);
        setRatings(ratingResult.status === 'fulfilled' ? ratingResult.value.ratings || [] : []);
        if (genreResult.status === 'rejected' || ratingResult.status === 'rejected') setOptionsError('Some genres or rated-book choices could not be loaded. Refresh to retry.');
      });
    });
    return () => { invalidateSession(); controller.abort(); };
  }, [userId, initRevision, invalidateSession]);

  const refreshExperiments = useCallback(async () => {
    const current = session.current;
    const sequence = ++experimentSequence.current;
    try {
      const result = await discovery.getExperiments();
      if (current === session.current && sequence === experimentSequence.current) { setExperiments(result); setExperimentsError(''); }
    } catch (failure) {
      if (current === session.current && sequence === experimentSequence.current) setExperimentsError(messageFor(failure));
    }
  }, []);

  const loadFeed = useCallback(async (append = false, nextOffset = 0) => {
    if (!ready) return;
    const sequence = ++requestSequence.current;
    setLoading(true); setError('');
    if (!append) { setBooks([]); setOffset(0); setFeed({}); }
    try {
      const result = await discovery.getFeed({ mode, offset: nextOffset, limit: 12, anchor_book_id: mode === 'because_you_rated' ? anchor : undefined });
      if (sequence !== requestSequence.current) return;
      const incoming = result.recommendations || [];
      setBooks((previous) => dedupe([...(append ? previous : []), ...incoming]).filter((book) => !dismissed.current.has(String(book.book_id))));
      setOffset(nextOffset + incoming.length); setFeed(result);
      if (result.capabilities) setCapabilities(result.capabilities);
    } catch (failure) {
      if (sequence === requestSequence.current) setError(messageFor(failure));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [ready, mode, anchor]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) loadFeed(); });
    return () => { cancelled = true; invalidateFeed(); };
  }, [loadFeed, revision, invalidateFeed]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled && ready) refreshExperiments(); });
    return () => { cancelled = true; };
  }, [ready, revision, refreshExperiments]);

  const impression = useCallback((book) => {
    if (!book.exposure_id || impressions.current.has(book.exposure_id)) return;
    impressions.current.add(book.exposure_id);
    discovery.recordEvent({ book_id: book.book_id, event_type: 'impression', exposure_id: book.exposure_id }).catch(() => {
      // Telemetry failures must not prevent reading or trigger ambiguous write retries.
    });
  }, []);

  const saved = book => discovery.recordEvent({ book_id: book.book_id, event_type: 'save', exposure_id: book.exposure_id }).catch(() => undefined);

  const selectBook = async (book) => {
    const current = session.current;
    try { await discovery.recordEvent({ book_id: book.book_id, event_type: 'click', exposure_id: book.exposure_id }); }
    catch { /* Reading remains available when event collection is unavailable. */ }
    if (current === session.current) onSelectBook?.(book);
  };

  const write = async (operation) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(''); setStatus('');
    const current = session.current;
    try { await operation(() => current === session.current); }
    catch (failure) { if (current === session.current) setError(messageFor(failure)); }
    finally { if (current === session.current) { busy.current = false; setPending(false); } }
  };

  const saveSettings = (event) => {
    event.preventDefault();
    write(async (isCurrent) => {
      const result = await discovery.savePreferences({ ...draft, length: capabilities.length_available ? draft.length : 'any' });
      if (!isCurrent()) return;
      const value = { ...DEFAULTS, ...result.preferences };
      setPreferences(value); setDraft(value); setStatus('Recommendation settings saved. Your shelf is being refreshed.');
      if (result.capabilities) setCapabilities(result.capabilities);
      setRevision((value) => value + 1);
    });
  };

  const feedback = (book, eventType) => write(async (isCurrent) => {
    const negative = eventType === 'not_interested' || eventType === 'less_like_this';
    const previous = books;
    requestSequence.current++; setLoading(false);
    if (negative) { dismissed.current.add(String(book.book_id)); setBooks((items) => items.filter((item) => item.book_id !== book.book_id)); }
    try {
      // “Like” is an explicit save action as well as recommendation feedback.
      // Keep it idempotent so clicking Like on an already-liked book does not
      // accidentally remove it from the user's liked-books shelf.
      if (eventType === 'like' && !favorites.includes(book.book_id)) {
        await onToggleFavorite?.(book.book_id);
      }
      await discovery.recordEvent({ book_id: book.book_id, event_type: eventType, exposure_id: book.exposure_id });
      if (!isCurrent()) return;
      setStatus(`${FEEDBACK.find(([value]) => value === eventType)[1]} saved for ${book.title}. Updating your shelf.`);
      setRevision((value) => value + 1);
    } catch (failure) {
      if (isCurrent() && negative) { dismissed.current.delete(String(book.book_id)); setBooks(previous); }
      throw failure;
    }
  });

  const toggleGenre = (genre, key) => setDraft((previous) => {
    const opposite = key === 'favorite_genres' ? 'disliked_genres' : 'favorite_genres';
    const selected = previous[key].includes(genre);
    return { ...previous, [key]: selected ? previous[key].filter((item) => item !== genre) : [...previous[key], genre], [opposite]: previous[opposite].filter((item) => item !== genre) };
  });

  const saveList = (event) => {
    event.preventDefault();
    write(async (isCurrent) => {
      const result = await discovery.saveList(listTitle.trim(), books.map((book) => book.book_id));
      if (!isCurrent()) return;
      const list = result.list || result;
      const id = list.id ?? list.list_id;
      if (id === undefined || id === null) throw new Error('The list was saved, but its identifier was not returned. Open your saved lists before publishing.');
      setSavedList({ id, title: list.title || listTitle.trim(), count: books.length }); setShareUrl(''); setStatus('List saved privately. Publish a link only when you want to share it.');
    });
  };
  const publish = () => write(async (isCurrent) => {
    const result = await discovery.publishList(savedList.id);
    if (!isCurrent()) return;
    if (!result.share_token) throw new Error('The server did not return a share link. Check your saved lists before trying again.');
    const url = new URL(window.location.href); url.search = ''; url.hash = ''; url.searchParams.set('list', result.share_token);
    setShareUrl(url.toString()); setStatus('Public link published. Anyone with this link can view the list.');
  });
  const revoke = () => write(async (isCurrent) => {
    await discovery.revokeList(savedList.id);
    if (isCurrent()) { setShareUrl(''); setStatus('Share link revoked. This list is private again.'); }
  });
  const genreNames = [...new Set([...genres.map((genre) => typeof genre === 'string' ? genre : genre.name), ...draft.favorite_genres, ...draft.disliked_genres])].filter(Boolean);

  return (
    <div className="space-y-6 pb-16 text-[#1E1B18]">
      <header className={`${panel} flex flex-wrap items-center justify-between gap-4`}>
        <div className="min-w-0 flex-1"><p className="text-xs uppercase tracking-widest text-[#8C7040] mb-2">Your next chapter</p>
          <h1 className="font-serif text-3xl font-bold">Personalized Shelves for {activeUser?.username || 'Reader'}</h1>
          <p className="text-sm text-[#6B6358] mt-2">{feed.ratings_count ?? ratings.length} recorded ratings · A shelf you can shape.</p></div>
        <Sparkles className="text-[#9E7D3B]" size={32} aria-hidden="true" />
      </header>
      <div role="status" aria-live="polite" className="text-sm text-[#2D6A4F]">{status}</div>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}<button className={`${button} ml-3`} disabled={pending || loading || initializing} onClick={() => ready ? loadFeed() : setInitRevision((value) => value + 1)}>Retry</button></div>}
      {initializing && <p role="status">Loading your discovery settings…</p>}
      <details className={panel} open>
        <summary className="cursor-pointer font-serif text-xl font-bold flex items-center gap-2"><Sliders size={19} aria-hidden="true" />Recommendation settings</summary>
        <form onSubmit={saveSettings} className="mt-5"><fieldset disabled={!ready || pending} className="space-y-5">
          <legend className="sr-only">Personalize your recommendations</legend>
          {optionsError && <p role="alert" className="text-sm text-amber-800">{optionsError}</p>}
          <div className="grid md:grid-cols-2 gap-5">
            {[['favorite_genres', 'Favorite genres', 'Find more of what you love.'], ['disliked_genres', 'Genres to avoid', 'Show fewer books in these genres.']].map(([key, label, help]) => (
              <fieldset key={key} className="rounded-xl bg-[#FAF7F2] p-4"><legend className="font-semibold text-sm px-1">{label}</legend><p className="text-xs text-[#6B6358] mb-3">{help}</p>
                <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto">{genreNames.map((genre) => <label key={genre} className="inline-flex items-center gap-2 rounded-full border border-[#D8CEBD] bg-white py-1.5 px-3 text-xs cursor-pointer"><input type="checkbox" className="accent-[#9E7D3B]" checked={draft[key].includes(genre)} onChange={() => toggleGenre(genre, key)} />{genre}</label>)}</div>
                {!genreNames.length && <p className="text-xs">No genre choices available.</p>}
              </fieldset>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[['novelty', 'Novelty', 'Familiar favorites → new discoveries'], ['diversity', 'Diversity', 'Focused shelf → wider variety']].map(([key, label, help]) => <label key={key} className="text-sm font-medium">{label} <span className="float-right font-mono">{Math.round(draft[key] * 100)}%</span><input aria-label={label} type="range" min="0" max="1" step="0.05" value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })} className="w-full mt-3 accent-[#9E7D3B]" /><span className="block text-xs font-normal text-[#6B6358]">{help}</span></label>)}
            <label className="text-sm font-medium">Publication era<select aria-label="Publication era" className={`${control} block w-full mt-2`} value={draft.era} onChange={(event) => setDraft({ ...draft, era: event.target.value })}><option value="any">Any era</option><option value="recent">Recent</option><option value="classic">Classic</option></select></label>
            <label className="text-sm font-medium">Book length<select aria-label="Book length" aria-describedby="length-note" disabled={!capabilities.length_available} className={`${control} block w-full mt-2`} value={capabilities.length_available ? draft.length : 'any'} onChange={(event) => setDraft({ ...draft, length: event.target.value })}><option value="any">Any length</option><option value="short">Short</option><option value="long">Long</option></select><span id="length-note" className="block text-xs font-normal text-[#6B6358] mt-2">{!capabilities.length_available ? 'Length filtering is unavailable: reliable page-count metadata is not available.' : 'Uses the available page-count metadata.'}</span></label>
          </div>
          <div className="grid md:grid-cols-2 gap-5 border-t border-[#E8DFC8] pt-5">
            <label className="text-sm font-medium">Recommendation balance<select aria-label="Recommendation balance" className={`${control} block w-full mt-2`} value={draft.alpha_mode} onChange={(event) => setDraft({ ...draft, alpha_mode: event.target.value })}><option value="manual">Manual</option><option value="experiment">A/B experiment</option><option value="auto">Auto-learn</option></select><span className="block text-xs text-[#6B6358] font-normal mt-2">Manual uses your balance. Experiment compares variants. Auto uses observed feedback when enough evidence is available.</span></label>
            <label className="text-sm font-medium">Similar-reader influence (alpha): {Number(draft.alpha).toFixed(2)}<input aria-label="Collaborative weight (alpha)" type="range" min="0" max="1" step="0.05" disabled={draft.alpha_mode !== 'manual'} value={draft.alpha} onChange={(event) => setDraft({ ...draft, alpha: Number(event.target.value) })} className="w-full mt-3 accent-[#9E7D3B] disabled:opacity-40" /><span className="block text-xs text-[#6B6358] font-normal">{Math.round((1 - draft.alpha) * 100)}% book similarity / {Math.round(draft.alpha * 100)}% similar-reader ratings. Without similar-reader evidence, catalog quality and popularity provide the fallback.</span></label>
          </div>
          <div className="flex flex-wrap gap-3 items-center"><button type="submit" disabled={!dirty} className={primaryButton}>{pending ? 'Saving…' : 'Save settings'}</button><button type="button" disabled={!dirty} className={button} onClick={() => setDraft(preferences)}>Discard changes</button><span className="text-xs text-[#6B6358]">{dirty ? 'Unsaved changes · Save to refresh your shelf.' : 'Your preferences are saved.'}</span></div>
        </fieldset></form>
      </details>
      <section aria-labelledby="shelf-heading" className="space-y-4">
        <div className="flex flex-wrap justify-between gap-3 items-center"><h2 id="shelf-heading" className="font-serif text-2xl font-bold">Curated for your curiosity</h2><button className={button} disabled={!ready || pending || loading} onClick={() => loadFeed()}><RefreshCw size={14} className="inline mr-2" aria-hidden="true" />Refresh shelf</button></div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Recommendation modes">{MODES.map(([value, label]) => <button key={value} aria-pressed={mode === value} disabled={!ready || pending} onClick={() => { if (mode !== value) { requestSequence.current++; setMode(value); } }} className={mode === value ? primaryButton : button}>{label}</button>)}</div>
        {mode === 'because_you_rated' && <label className="block text-sm">Start with a rated book<select aria-label="Start with a rated book" value={anchor} disabled={pending} onChange={(event) => { requestSequence.current++; setAnchor(event.target.value); }} className={`${control} ml-3`}><option value="">Choose automatically</option>{ratings.map((rating) => <option key={rating.book_id ?? rating.book?.book_id} value={rating.book_id ?? rating.book?.book_id}>{rating.book?.title || rating.title || `Book ${rating.book_id}`} ({rating.rating}★)</option>)}</select></label>}
        {(feed.notice || feed.is_cold_start) && <p className="rounded-xl border border-[#E8DFC8] bg-[#FFF8EB] p-4 text-sm text-[#775224]">{feed.notice || 'Your reading history is still growing. Rate more books to help personalize this shelf.'}</p>}
        {feed.alpha !== undefined && <p className="text-xs text-[#6B6358]">Applied alpha: {Number(feed.alpha).toFixed(2)} · Source: {feed.alpha_source || 'Not supplied by service'}</p>}
        <div aria-busy={loading}>
          {books.length > 0 && <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">{books.map((book) => <Recommendation key={book.book_id} book={book} onImpression={impression} onSaved={saved} onSelect={selectBook} disabled={pending} onFeedback={feedback} isFavorite={favorites.includes(book.book_id)} onToggleFavorite={onToggleFavorite} readingStatus={readingList[book.book_id]} onUpdateStatus={onUpdateStatus} />)}</div>}
          {loading && <p role="status" className="py-10 text-center text-sm text-[#6B6358]">Finding your next great read…</p>}
          {!loading && ready && !books.length && !error && <div className={`${panel} text-center py-12`}><BookOpen className="mx-auto mb-3 text-[#9E7D3B]" aria-hidden="true" /><h3 className="font-serif text-xl">No books on this shelf yet</h3><p className="text-sm text-[#6B6358] mt-2">Try another mode, adjust your genres, or rate a few books to give us a starting point.</p></div>}
        </div>
        {feed.has_more && <div className="text-center"><button className={button} disabled={loading || pending} onClick={() => loadFeed(true, offset)}>{loading ? 'Loading…' : 'Load more'}</button><p className="text-xs text-[#6B6358] mt-2">{books.length} unique titles on this shelf</p></div>}
      </section>
      <section className={panel} aria-labelledby="save-list-heading"><h2 id="save-list-heading" className="font-serif text-xl font-bold">Keep this collection</h2><p className="text-sm text-[#6B6358] mt-2">Save the {books.length} currently displayed titles as a private list. Publishing is a separate step.</p>
        <form onSubmit={saveList} className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm grow">List title<input className={`${control} block mt-1 w-full`} value={listTitle} maxLength={100} required disabled={pending} onChange={(event) => setListTitle(event.target.value)} /></label><button className={button} disabled={pending || loading || !books.length || !listTitle.trim()}>Save current recommendations</button></form>
        {savedList && <div className="mt-4 space-y-3 text-sm"><p>Saved: <strong>{savedList.title}</strong> · {savedList.count} titles</p><p className="text-amber-800">A published list is public to anyone with its link. You can revoke access at any time.</p>
          {shareUrl ? <><label className="block">Public list link<input readOnly value={shareUrl} className={`${control} block w-full mt-1`} onFocus={(event) => event.target.select()} /></label><a href={shareUrl} className="underline mr-4">Open shared list</a><button className={button} disabled={pending} onClick={revoke}>Revoke link</button></> : <button className={button} disabled={pending} onClick={publish}>Publish link</button>}
        </div>}
      </section>
      <details className={panel}><summary className="cursor-pointer font-serif text-xl font-bold">A/B experiment observations</summary><div className="mt-4 space-y-3 text-sm">
        <p className="text-[#6B6358]">Observed engagement is descriptive. These counts do not establish statistical significance or a winning variant.</p>
        {experimentsError && <p role="alert" className="text-red-800">{experimentsError}</p>}
        {!experiments && !experimentsError && <p>Loading experiment observations…</p>}
        {experiments && <><p>{experiments.notice}</p><p>Minimum observations: {experiments.minimum_observations ?? 'Not provided'} · {experiments.eligible_for_learning ? 'Eligible for learning' : 'Not yet eligible for learning'}</p><div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Recommendation balance experiment metrics</caption><thead><tr>{['Variant', 'Alpha', 'Impressions', 'Positive events', 'Negative events', 'Engagement rate'].map((heading) => <th scope="col" key={heading} className="p-2 border-b border-[#E8DFC8]">{heading}</th>)}</tr></thead><tbody>{(experiments.variants || []).map((variant) => <tr key={variant.variant}><th scope="row" className="p-2">{variant.variant}</th><td className="p-2">{Number(variant.alpha).toFixed(2)}</td><td className="p-2">{variant.impressions}</td><td className="p-2">{variant.positive_events}</td><td className="p-2">{variant.negative_events}</td><td className="p-2">{variant.engagement_rate == null ? 'Unavailable' : `${(variant.engagement_rate * 100).toFixed(1)}%`}</td></tr>)}</tbody></table></div>{!experiments.variants?.length && <p>No variant observations yet.</p>}</>}
        <button className={button} disabled={!ready || pending} onClick={refreshExperiments}>Refresh observations</button>
      </div></details>
    </div>
  );
}

// Changing accounts must discard every private draft, list, and in-flight result.
export default function ForYouPage(props) {
  return <DiscoveryShelf key={props.userId} {...props} />;
}

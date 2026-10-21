import { useCallback, useEffect, useRef, useState } from 'react';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import ForYouPage from './pages/ForYouPage';
import MyLibraryPage from './pages/MyLibraryPage';
import MLDashboardPage from './pages/MLDashboardPage';
import BookDetailModal from './components/BookDetailModal';
import { api } from './services/api';
import useFocusTrap from './hooks/useFocusTrap';
import ReaderWorkspace from './pages/ReaderWorkspace';
import SharedListPage from './pages/SharedListPage';
import BookComparison from './components/BookComparison';
import { discovery } from './services/discovery';

function AuthDialog({ mode, onModeChange, onSubmit, onClose, loading, error }) {
  const [form, setForm] = useState({ username: '', identifier: '', email: '', password: '' });
  const dialogRef = useRef(null);
  const isRegister = mode === 'register';
  useFocusTrap(dialogRef, onClose);
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="presentation" onMouseDown={onClose}>
      <form ref={dialogRef} role="dialog" aria-modal="true" aria-label={isRegister ? 'Create an account' : 'Welcome back'} tabIndex="-1" className="w-full max-w-md rounded-2xl border border-[#E0D5C1] bg-[#FAF7F2] p-6 shadow-2xl" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#9E7D3B]">Your reading room</p>
            <h2 className="font-serif text-3xl font-bold text-[#1E1B18]">{isRegister ? 'Create an account' : 'Welcome back'}</h2>
            <p className="mt-1 text-xs text-[#7A6D5A]">Save shelves, ratings, and recommendations across devices.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-lg text-[#7A6D5A] hover:bg-[#F0E8DA]" aria-label="Close authentication dialog">×</button>
        </div>
        {isRegister && <label className="mb-3 block text-xs font-medium text-[#57524D]">Username<input name="username" required value={form.username} onChange={update} className="mt-1 w-full rounded-lg border border-[#D8CEBD] bg-white px-3 py-2.5 text-sm" autoComplete="username" /></label>}
        <label className="mb-3 block text-xs font-medium text-[#57524D]">{isRegister ? 'Email' : 'Email or username'}<input name={isRegister ? 'email' : 'identifier'} type={isRegister ? 'email' : 'text'} required value={isRegister ? form.email : form.identifier} onChange={update} className="mt-1 w-full rounded-lg border border-[#D8CEBD] bg-white px-3 py-2.5 text-sm" autoComplete={isRegister ? 'email' : 'username'} /></label>
        <label className="mb-4 block text-xs font-medium text-[#57524D]">Password<input name="password" type="password" minLength={8} required value={form.password} onChange={update} className="mt-1 w-full rounded-lg border border-[#D8CEBD] bg-white px-3 py-2.5 text-sm" autoComplete={isRegister ? 'new-password' : 'current-password'} /></label>
        {error && <p className="mb-4 rounded-lg border border-[#E9B4B4] bg-[#FFF4F2] px-3 py-2 text-xs text-[#9B2C2C]" role="alert">{error}</p>}
        <button disabled={loading} className="w-full rounded-lg bg-[#1E1B18] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#3D3730] disabled:cursor-wait disabled:opacity-60">{loading ? 'Opening your reading room…' : isRegister ? 'Create account' : 'Sign in'}</button>
        <button type="button" onClick={() => onModeChange(isRegister ? 'login' : 'register')} className="mt-4 w-full text-center text-xs font-medium text-[#9E7D3B] hover:underline">{isRegister ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
      </form>
    </div>
  );
}

function OnboardingDialog({ onRate, onClose }) {
  const [books, setBooks] = useState([]);
  const [ratings, setRatings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  useFocusTrap(dialogRef, onClose);

  useEffect(() => {
    let active = true;
    api.getPopularRecommendations({ n: 6, type: 'popular' })
      .then((result) => { if (active) setBooks(result.recommendations || []); })
      .catch(() => { if (active) setError('We could not load starter books. You can rate books from Discover instead.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const rate = async (bookId, rating) => {
    setRatings((current) => ({ ...current, [bookId]: rating }));
    await onRate(bookId, rating);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
        <section ref={dialogRef} role="dialog" aria-modal="true" tabIndex="-1" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#E0D5C1] bg-[#FAF7F2] p-6 shadow-2xl" aria-labelledby="onboarding-title">
        <button
          type="button"
          onClick={() => onClose?.()}
          className="sticky top-0 z-20 ml-auto block rounded-full bg-[#FAF7F2]/95 px-2 py-1 text-lg text-[#7A6D5A] shadow-sm hover:bg-[#F0E8DA]"
          aria-label="Close onboarding"
        >×</button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#9E7D3B]">A better first shelf</p>
            <h2 id="onboarding-title" className="font-serif text-3xl font-bold text-[#1E1B18]">Tell us what you love</h2>
            <p className="mt-1 max-w-xl text-sm text-[#7A6D5A]">Rate a few books to give your recommendations an immediate head start. You can change these ratings anytime.</p>
          </div>
        </div>
        {error && <p className="mt-5 rounded-lg border border-[#E9B4B4] bg-[#FFF4F2] px-3 py-2 text-xs text-[#9B2C2C]" role="alert">{error}</p>}
        {loading ? <p className="py-12 text-center text-sm text-[#7A6D5A]">Finding a few reader favorites…</p> : (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {books.map((book) => (
              <article key={book.book_id} className="rounded-xl border border-[#E5DAC6] bg-white p-3">
                <button type="button" onClick={() => onClose(book)} className="block w-full text-left" aria-label={`Open ${book.title}`}>
                  <img src={book.image_url} alt="" className="mx-auto aspect-[2/3] w-24 rounded object-cover" />
                  <h3 className="mt-3 line-clamp-2 font-serif text-sm font-bold text-[#1E1B18]">{book.title}</h3>
                  <p className="mt-1 line-clamp-1 text-[11px] text-[#7A6D5A]">{book.authors}</p>
                </button>
                <div className="mt-3 flex items-center justify-between gap-1" aria-label={`Rate ${book.title}`}>
                  {[1, 2, 3, 4, 5].map((rating) => <button key={rating} type="button" onClick={() => rate(book.book_id, rating)} className={`text-lg leading-none ${rating <= (ratings[book.book_id] || 0) ? 'text-[#C5A059]' : 'text-[#D8CEBD]'}`} aria-label={`${rating} stars`}>★</button>)}
                </div>
              </article>
            ))}
          </div>
        )}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => onClose()} className="rounded-lg border border-[#D8CEBD] px-4 py-2.5 text-sm font-semibold text-[#57524D] hover:bg-[#F0E8DA]">I&apos;ll do this later</button>
          <button type="button" onClick={() => onClose()} className="rounded-lg bg-[#1E1B18] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3D3730]">Continue to recommendations</button>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [currentTab, setCurrentTab] = useState('home');
  const [sharedToken, setSharedToken] = useState(() => new URLSearchParams(window.location.search).get('list'));
  const [comparisonBooks, setComparisonBooks] = useState([]);
  const [showComparison, setShowComparison] = useState(false);
  const [readerRevision, setReaderRevision] = useState(0);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('bookwise_theme') || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
    catch { return 'light'; }
  });
  const [currentUser, setCurrentUser] = useState(null);
  // Always restore the session through /auth/me so HttpOnly cookie sessions
  // survive a refresh. The in-memory bearer token is only a local fallback.
  const [authChecking, setAuthChecking] = useState(true);
  const [userDataReady, setUserDataReady] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [authDialog, setAuthDialog] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBook, setSelectedBook] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [readingList, setReadingList] = useState({});
  const [userRatings, setUserRatings] = useState({});
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const userDataSequence = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('bookwise_theme', theme); } catch { /* Storage may be disabled. */ }
  }, [theme]);

  const navigate = (tab) => {
    setCurrentTab(tab);
    setSharedToken(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('list');
    window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const showToast = useCallback((message, type = 'info') => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const data = await api.getCurrentUser();
      setCurrentUser(data.user || data);
    } catch (error) {
      if (error.status === 401) api.setToken(null);
      setCurrentUser(null);
    } finally {
      setAuthChecking(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(loadSession); }, [loadSession]);

  const loadUserData = useCallback(async (userId) => {
    const sequence = ++userDataSequence.current;
    if (!userId) { setUserDataReady(false); return; }
    setUserDataReady(false);
    try {
      const [favRes, listRes, rateRes] = await Promise.all([
        api.getUserFavorites(userId), api.getUserReadingList(userId), api.getUserRatings(userId)
      ]);
      if (sequence !== userDataSequence.current) return;
      setFavorites((favRes.favorites || []).map((favorite) => favorite.book_id));
      setReadingList(Object.fromEntries((listRes.reading_list || []).map((item) => [item.book_id, item.status])));
      setUserRatings(Object.fromEntries((rateRes.ratings || []).map((item) => [item.book_id, item.rating])));
    } catch (error) {
      if (sequence !== userDataSequence.current) return;
      if (error.status === 401) setCurrentUser(null);
      showToast('We could not load your shelves yet.', 'error');
    } finally {
      if (sequence === userDataSequence.current) setUserDataReady(true);
    }
  }, [showToast]);

  useEffect(() => { queueMicrotask(() => loadUserData(currentUser?.id)); }, [currentUser?.id, loadUserData]);

  const authenticate = async (form) => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const data = authDialog === 'register' ? await api.register(form) : await api.login(form);
      setCurrentUser(data.user || data);
      setOnboardingDismissed(false);
      setAuthDialog(null);
      showToast(`Welcome, ${(data.user || data).username || 'reader'}!`, 'success');
    } catch (error) {
      setAuthError(error.message || 'Authentication failed. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const signOut = async () => {
    try { await api.logout(); }
    catch { showToast('Sign out failed. Please retry while connected.', 'error'); return; }
    userDataSequence.current++;
    setCurrentUser(null);
    setUserDataReady(false);
    setOnboardingDismissed(false);
    setFavorites([]); setReadingList({}); setUserRatings({});
    setCurrentTab('home');
    setComparisonBooks([]);
    setShowComparison(false);
    closeBook();
    showToast('You have been signed out.', 'info');
  };

  const requireAuth = (action) => {
    if (!currentUser) {
      setAuthDialog('login');
      return;
    }
    return action();
  };

  const attributeEvent = (bookId, event_type, value) => {
    if (selectedBook?.book_id === bookId && selectedBook.exposure_id) {
      discovery.recordEvent({ book_id: bookId, event_type, exposure_id: selectedBook.exposure_id, ...(value === undefined ? {} : { value }) }).catch(() => undefined);
    }
  };

  const handleToggleFavorite = (bookId) => requireAuth(async () => {
    try {
      const result = await api.toggleFavorite(currentUser.id, bookId);
      if (result.is_favorite) attributeEvent(bookId, 'save');
      setFavorites((previous) => result.is_favorite ? [...new Set([...previous, bookId])] : previous.filter((id) => id !== bookId));
      showToast(result.is_favorite ? 'Added to your favorites.' : 'Removed from favorites.', result.is_favorite ? 'success' : 'info');
      return result;
    } catch { showToast('Could not update favorite.', 'error'); }
  });

  const handleUpdateStatus = (bookId, status) => requireAuth(async () => {
    try {
      await api.updateReadingList(currentUser.id, bookId, status || 'remove');
      if (status) attributeEvent(bookId, 'save');
      setReadingList((previous) => {
        const next = { ...previous };
        if (!status) delete next[bookId]; else next[bookId] = status;
        return next;
      });
      showToast(status ? `Moved to ${status.replaceAll('_', ' ')}.` : 'Removed from your shelf.', 'success');
      return { success: true };
    } catch { showToast('Could not update shelf status.', 'error'); }
  });

  const handleRateBook = (bookId, rating) => requireAuth(async () => {
    try {
      await api.saveRating(currentUser.id, bookId, rating);
      attributeEvent(bookId, 'rating', rating);
      setUserRatings((previous) => ({ ...previous, [bookId]: rating }));
      showToast(`Saved your ${rating}★ rating.`, 'success');
    } catch { showToast('Could not save rating.', 'error'); }
  });

  const selectBook = useCallback((book) => {
    if (!book?.book_id) return;
    setSelectedBook(book);
    const url = new URL(window.location.href);
    url.searchParams.set('book', book.book_id);
    window.history.pushState({ bookId: book.book_id }, '', `${url.pathname}${url.search}${url.hash}`);
    if (book?.book_id && currentUser?.id) {
      api.recordFeedback(currentUser.id, book.book_id, 'click').catch(() => undefined);
    }
  }, [currentUser]);
  const closeBook = useCallback(() => {
    setSelectedBook(null);
    const url = new URL(window.location.href); url.searchParams.delete('book');
    window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const addComparison = (book) => {
    if (comparisonBooks.some(item => item.book_id === book.book_id)) return;
    if (comparisonBooks.length >= 4) { showToast('Compare up to four books. Remove one first.', 'error'); return; }
    setComparisonBooks(previous => [...previous, book]);
    showToast('Added to comparison. Use Compare books above the page.', 'success');
  };

  const progressChanged = (bookId, progress) => {
    setReadingList(previous => ({ ...previous, [bookId]: progress.percent >= 100 ? 'read' : 'currently_reading' }));
    setReaderRevision(previous => previous + 1);
  };

  useEffect(() => {
    let active = true;
    const openFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      setSharedToken(params.get('list'));
      const bookId = params.get('book');
      if (!bookId) { setSelectedBook(null); return; }
      api.getBookDetails(bookId).then((book) => { if (active) setSelectedBook(book); }).catch(() => undefined);
    };
    openFromUrl();
    window.addEventListener('popstate', openFromUrl);
    return () => { active = false; window.removeEventListener('popstate', openFromUrl); };
  }, []);

  if (authChecking) return <div className="flex min-h-screen items-center justify-center bg-[#FAF7F2] text-sm text-[#7A6D5A]">Restoring your reading room…</div>;

  const showOnboarding = Boolean(currentUser && userDataReady && !onboardingDismissed && Object.keys(userRatings).length < 3);

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#23201C]">
      {toast && <div className={`fixed bottom-6 right-6 z-50 rounded-xl border px-4 py-2.5 text-xs font-medium shadow-2xl ${toast.type === 'error' ? 'border-[#E9B4B4] bg-[#FFF4F2] text-[#9B2C2C]' : 'border-[#C5A059]/40 bg-[#1E1B18] text-[#F5EFE6]'}`} role="status">{toast.message}</div>}
      <Navbar currentTab={sharedToken ? 'shared' : currentTab} onSelectTab={navigate} searchQuery={searchQuery} onSearchChange={setSearchQuery} currentUser={currentUser} theme={theme} onToggleTheme={() => setTheme(value => value === 'dark' ? 'light' : 'dark')} onSignIn={() => { setAuthError(''); setAuthDialog('login'); }} onRegister={() => { setAuthError(''); setAuthDialog('register'); }} onSignOut={signOut} />
      <main className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
        {comparisonBooks.length > 0 && <div className="mb-5 flex flex-wrap items-center gap-3"><button className="rounded-lg border border-[#C5A059] px-4 py-2 text-sm" onClick={() => setShowComparison(value => !value)}>Compare books ({comparisonBooks.length}/4)</button><span className="text-xs">Open a book to add it to your comparison.</span></div>}
        {showComparison && <BookComparison books={comparisonBooks} onRemove={id => setComparisonBooks(items => items.filter(book => book.book_id !== id))} onClose={() => setShowComparison(false)} />}
        {sharedToken ? <SharedListPage key={sharedToken} token={sharedToken} onSelectBook={selectBook} /> : <>
        {currentTab === 'home' && <HomePage onSelectBook={selectBook} searchQuery={searchQuery} favorites={favorites} onToggleFavorite={handleToggleFavorite} readingList={readingList} onUpdateStatus={handleUpdateStatus} onExploreForYou={() => currentUser ? setCurrentTab('for-you') : setAuthDialog('login')} />}
        {currentTab === 'for-you' && currentUser && <ForYouPage userId={currentUser.id} activeUser={currentUser} onSelectBook={selectBook} favorites={favorites} onToggleFavorite={handleToggleFavorite} readingList={readingList} onUpdateStatus={handleUpdateStatus} onRate={handleRateBook} />}
        {currentTab === 'library' && currentUser && <MyLibraryPage userId={currentUser.id} activeUser={currentUser} onSelectBook={selectBook} favorites={favorites} onToggleFavorite={handleToggleFavorite} readingList={readingList} onUpdateStatus={handleUpdateStatus} />}
        {currentTab === 'dashboard' && <MLDashboardPage currentUser={currentUser} onSelectBook={selectBook} onSignIn={() => setAuthDialog('login')} />}
        {currentTab === 'reader' && currentUser && <ReaderWorkspace key={`${currentUser.id}:${readerRevision}`} onSelectBook={selectBook} />}
        {currentTab !== 'home' && currentTab !== 'dashboard' && !currentUser && <div className="rounded-2xl border border-[#E8DFC8] bg-white p-12 text-center"><h2 className="font-serif text-2xl font-bold">Sign in to continue</h2><p className="mt-2 text-sm text-[#7A6D5A]">Your recommendations and library are private to your account.</p><button onClick={() => setAuthDialog('login')} className="mt-5 rounded-lg bg-[#1E1B18] px-5 py-2.5 text-sm font-semibold text-white">Sign in</button></div>}
        </>}
      </main>
      {selectedBook && <BookDetailModal currentUser={currentUser} onProgressChange={progressChanged} onCompare={addComparison} isCompared={comparisonBooks.some(book => book.book_id === selectedBook.book_id)} book={selectedBook} onClose={closeBook} userRating={userRatings[selectedBook.book_id]} onRate={handleRateBook} isFavorite={favorites.includes(selectedBook.book_id)} onToggleFavorite={handleToggleFavorite} readingStatus={readingList[selectedBook.book_id]} onUpdateStatus={handleUpdateStatus} onSelectSimilar={selectBook} />}
      <footer className="mt-16 border-t border-[#E8DFC8] bg-[#F5EFE6] py-8 text-xs text-[#7A6D5A]"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-4 sm:flex-row sm:px-6 lg:px-8"><span className="font-serif text-base font-bold text-[#1E1B18]">BookWise <em className="font-normal">— intelligent discovery for curious readers</em></span><span className="font-mono text-[11px]">Hybrid ensemble · TF-IDF · SVD</span></div></footer>
      {authDialog && <AuthDialog mode={authDialog} onModeChange={(mode) => { setAuthError(''); setAuthDialog(mode); }} onSubmit={authenticate} onClose={() => setAuthDialog(null)} loading={authLoading} error={authError} />}
      {showOnboarding && !selectedBook && !authDialog && !sharedToken && (
        <OnboardingDialog
          onRate={handleRateBook}
          onClose={(book) => {
            setOnboardingDismissed(true);
            if (book) selectBook(book);
          }}
        />
      )}
    </div>
  );
}

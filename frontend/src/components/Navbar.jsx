import { useEffect, useRef, useState } from 'react';
import { BookOpen, Sparkles, Bookmark, BarChart3, Search, ChevronDown, LogIn, UserPlus, NotebookPen, Moon, Sun } from 'lucide-react';
import { api } from '../services/api';

export default function Navbar({ currentTab, onSelectTab, searchQuery, onSearchChange, currentUser, onSignIn, onRegister, onSignOut, theme = 'light', onToggleTheme }) {
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const searchRef = useRef(null);
  const mobileSearchRef = useRef(null);
  const userMenuRef = useRef(null);

  useEffect(() => {
    if (searchQuery.trim().length < 2) { queueMicrotask(() => setSuggestions([])); return undefined; }
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.getBooks({ q: searchQuery.trim(), limit: 6, sort_by: 'popularity' });
        if (active) setSuggestions(result.books || []);
      } catch { if (active) setSuggestions([]); }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [searchQuery]);

  useEffect(() => {
    const close = (event) => {
      if (![searchRef.current, mobileSearchRef.current].some((element) => element?.contains(event.target))) {
        setSuggestionsOpen(false);
      }
      if (!userMenuRef.current?.contains(event.target)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const selectSuggestion = (book) => {
    onSearchChange(book.title);
    setSuggestionsOpen(false);
    onSelectTab('home');
  };
  const navItems = [
    { id: 'home', label: 'Discover', icon: BookOpen },
    { id: 'for-you', label: 'For You', icon: Sparkles, protected: true },
    { id: 'library', label: 'My Library', icon: Bookmark, protected: true },
    { id: 'reader', label: 'Reading Room', icon: NotebookPen, protected: true },
    { id: 'dashboard', label: 'ML Dashboard', icon: BarChart3 }
  ];
  const renderSuggestions = () => suggestionsOpen && suggestions.length > 0 && (
    <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-[#E5DAC6] bg-white shadow-xl">
      <p className="border-b border-[#F2ECE1] px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-[#8C8274]">Quick results</p>
      {suggestions.map((book) => (
        <button type="button" key={book.book_id} onClick={() => selectSuggestion(book)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[#FAF5EB]">
          <span className="h-10 w-7 shrink-0 overflow-hidden rounded bg-[#F2ECE1]"><img src={book.image_url} alt="" className="h-full w-full object-cover" /></span>
          <span className="min-w-0"><strong className="block truncate font-serif text-xs text-[#1E1B18]">{book.title}</strong><span className="block truncate text-[10px] text-[#7A6D5A]">{book.authors}</span></span>
        </button>
      ))}
    </div>
  );

  return (
    <><header className="sticky top-0 z-40 border-b border-[#E8DFC8] bg-[#FAF7F2]/95 shadow-sm backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-20 items-center justify-between gap-3 py-3">
          <button onClick={() => onSelectTab('home')} className="group flex shrink-0 items-center gap-2 text-left" aria-label="BookWise home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#C5A059] bg-gradient-to-br from-[#2E241A] to-[#1A140F] text-[#D4AF37] transition group-hover:scale-105"><BookOpen size={20} /></span>
            <span className="hidden sm:block"><span className="block font-serif text-2xl font-bold tracking-tight text-[#1E1B18]">Book<span className="text-[#9E7D3B]">Wise</span></span><span className="block text-[10px] italic text-[#7A6D5A]">Discover books you&apos;ll love</span></span>
          </button>
          <div className="relative hidden max-w-md flex-1 md:block" ref={searchRef}>
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8C8274]" size={16} />
            <input value={searchQuery} onChange={(event) => { onSearchChange(event.target.value); setSuggestionsOpen(true); }} onFocus={() => setSuggestionsOpen(true)} placeholder="Search by title, author, or keyword…" className="w-full rounded-full border border-[#D8CEBD] bg-white py-2 pl-10 pr-4 text-sm text-[#1E1B18] outline-none transition focus:border-transparent focus:ring-2 focus:ring-[#C5A059]" aria-label="Search books" />
             {renderSuggestions()}
          </div>
          <nav className="flex items-center gap-1" aria-label="Primary navigation">
            {navItems.map(({ id, label, icon: Icon, protected: isProtected }) => <button key={id} aria-label={label} aria-current={currentTab === id ? 'page' : undefined} onClick={() => onSelectTab(id)} className={`hidden md:flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium transition sm:px-3 ${currentTab === id ? 'bg-[#1E1B18] text-white' : 'text-[#57524D] hover:bg-[#F0E8DA]'} ${isProtected && !currentUser ? 'opacity-60' : ''}`} title={isProtected && !currentUser ? 'Sign in to open your library' : label}><Icon size={16} /><span className="hidden xl:inline">{label}</span></button>)}
            <button type="button" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={onToggleTheme} className="rounded-full border border-[#D8CEBD] p-2.5 text-[#57524D]">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
             {currentUser ? <div ref={userMenuRef} className="relative ml-1"><button type="button" onClick={() => setUserMenuOpen((open) => !open)} className="flex max-w-36 items-center gap-1.5 rounded-full border border-[#D8CEBD] bg-white px-2.5 py-1.5 text-xs font-medium text-[#1E1B18]" aria-expanded={userMenuOpen}><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F2ECE1] text-[#9E7D3B]">{(currentUser.username || 'R').slice(0, 1).toUpperCase()}</span><span className="hidden truncate sm:inline">{currentUser.username}</span><ChevronDown size={13} /></button>{userMenuOpen && <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-[#E5DAC6] bg-white py-2 shadow-xl"><p className="truncate border-b border-[#F2ECE1] px-3 pb-2 text-[11px] text-[#7A6D5A]">{currentUser.email}</p><button type="button" onClick={() => { setUserMenuOpen(false); onSignOut(); }} className="w-full px-3 py-2 text-left text-xs text-[#722F37] hover:bg-[#FFF4F2]">Sign out</button></div>}</div> : <div className="flex items-center gap-1"><button type="button" onClick={onSignIn} className="flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold text-[#57524D] hover:bg-[#F0E8DA]"><LogIn size={15} /> <span className="hidden sm:inline">Sign in</span></button><button type="button" onClick={onRegister} className="hidden items-center gap-1 rounded-lg bg-[#C5A059] px-3 py-2 text-xs font-semibold text-white hover:bg-[#9E7D3B] sm:flex"><UserPlus size={14} /> Join</button></div>}
          </nav>
        </div>
         <div className="relative pb-3 md:hidden" ref={mobileSearchRef}><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8C8274]" size={16} /><input value={searchQuery} onChange={(event) => { onSearchChange(event.target.value); setSuggestionsOpen(true); }} onFocus={() => setSuggestionsOpen(true)} placeholder="Search books, authors, genres…" className="w-full rounded-full border border-[#D8CEBD] bg-white py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-[#C5A059]" aria-label="Search books" />{renderSuggestions()}</div>
      </div>
    </header>
    <nav aria-label="Mobile navigation" className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[#E8DFC8] bg-[#FAF7F2] px-1 pt-2 md:hidden">
      {navItems.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-label={label} aria-current={currentTab === id ? 'page' : undefined} onClick={() => onSelectTab(id)} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-semibold ${currentTab === id ? 'bg-[#1E1B18] text-white' : 'text-[#57524D]'}`}><Icon size={19} aria-hidden="true" /><span>{label}</span></button>)}
    </nav></>
  );
}

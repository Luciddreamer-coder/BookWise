import { useEffect, useState } from 'react';
import { readerApi } from '../services/reader';

export default function SharedListPage({ token, onSelectBook }) {
  const [state, setState] = useState({ token: null, attempt: -1, list: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (!token) return () => { active = false; };
    readerApi.getSharedList(token).then(list => {
      if (active) setState({ token, attempt, list, error: '' });
    }).catch(error => {
      if (active) setState({ token, attempt, list: null, error: [404, 410].includes(error.status) ? 'This shared list is unavailable. Its link may be invalid or revoked.' : error.message || 'Could not load this shared list. Please try again.' });
    });
    return () => { active = false; };
  }, [token, attempt]);

  const loading = Boolean(token) && (state.token !== token || state.attempt !== attempt);
  const error = !token ? 'This shared list is unavailable. Its link may be invalid or revoked.' : state.error;
  return <section className="shared-list space-y-5 rounded-xl border border-[#E8DFC8] bg-white p-6" aria-label="Shared book list" aria-busy={loading}>
    {loading ? <p role="status">Loading shared list…</p> : error ? <div role="alert"><h1 className="font-serif text-2xl font-bold">Shared list unavailable</h1><p className="mt-2">{error}</p>{token && <button className="mt-4 rounded-lg border px-3 py-2" onClick={() => setAttempt(value => value + 1)}>Try again</button>}</div> : <>
      <header><p className="text-sm">Shared reading list</p><h1 className="font-serif text-3xl font-bold">{state.list.title}</h1><p>{state.list.books?.length || 0} books</p></header>
      {!state.list.books?.length && <p>This list has no books.</p>}
      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{(state.list.books || []).map(book => <li key={book.book_id}><button className="h-full w-full rounded-lg border border-[#E8DFC8] p-4 text-left hover:bg-[#F2ECE1]" onClick={() => onSelectBook?.(book)}><span className="block font-serif text-lg font-bold">{book.title}</span><span className="block text-sm">{Array.isArray(book.authors) ? book.authors.join(', ') : book.authors || 'Author unknown'}</span><span className="mt-2 block text-xs">Open book details</span></button></li>)}</ul>
    </>}
  </section>;
}

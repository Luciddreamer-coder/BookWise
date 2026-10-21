import { useEffect, useRef, useState } from 'react';
import { readerApi } from '../services/reader';

const panel = 'rounded-xl border border-[#E8DFC8] bg-white p-4 space-y-3';
const input = 'block w-full rounded-lg border border-[#D8CEBD] bg-white px-3 py-2 text-sm';
const button = 'rounded-lg border border-[#D8CEBD] px-3 py-2 text-sm font-medium hover:bg-[#F2ECE1] disabled:opacity-50';
const authorsOf = book => [...new Set((Array.isArray(book.authors) ? book.authors : String(book.authors || '').split(',')).map(author => author.trim()).filter(Boolean))];

export default function ReaderTools({ book, currentUser, onProgressChange, onClose }) {
  if (!book) return null;
  if (!currentUser) return <section className="reader-tools mt-8" aria-label="Reader tools"><p>Sign in to save progress, private notes, reviews, and shelves.</p></section>;
  return <BookReaderTools key={`${book.book_id}:${currentUser?.user_id ?? currentUser?.id ?? 'guest'}`} book={book} currentUser={currentUser} onProgressChange={onProgressChange} onClose={onClose} />;
}

function BookReaderTools({ book, currentUser, onProgressChange, onClose }) {
  const [data, setData] = useState(null);
  const [shelves, setShelves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState({ percent: 0, current_page: '', total_pages: '' });
  const [note, setNote] = useState({ kind: 'note', text: '', page: '' });
  const [noteQuery, setNoteQuery] = useState('');
  const [review, setReview] = useState({ text: '', visibility: 'private' });
  const [comment, setComment] = useState('');
  const alive = useRef(true);

  async function load(syncForms = false) {
    const [next, shelfData] = await Promise.all([
      readerApi.getBook(book.book_id),
      currentUser ? readerApi.getShelves() : Promise.resolve({ shelves: [] })
    ]);
    if (!alive.current) return;
    setData(next);
    setShelves(shelfData.shelves || []);
    if (syncForms) {
      setProgress({ percent: next.progress?.percent ?? 0, current_page: next.progress?.current_page ?? '', total_pages: next.progress?.total_pages ?? '' });
      setReview(next.review ? { text: next.review.text, visibility: next.review.visibility } : { text: '', visibility: 'private' });
    }
  }

  useEffect(() => {
    alive.current = true;
    load(true).catch(err => { if (alive.current) setError(err.message); }).finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; };
    // The keyed component remounts when the book or signed-in account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function mutate(action, message, after) {
    if (pending) return;
    setPending(true); setError(''); setNotice('');
    try {
      const result = await action();
      if (!alive.current) return;
      after?.(result);
      await load();
      if (alive.current) setNotice(message);
    } catch (err) {
      if (alive.current) setError(err.message);
    } finally {
      if (alive.current) setPending(false);
    }
  }

  function saveProgress(event) {
    event.preventDefault();
    const payload = { percent: Number(progress.percent), current_page: progress.current_page === '' ? null : Number(progress.current_page), total_pages: progress.total_pages === '' ? null : Number(progress.total_pages) };
    if ((payload.current_page === null) !== (payload.total_pages === null)) {
      setError('Provide both current page and total pages, or leave both blank to save a percentage.'); return;
    }
    if (payload.current_page !== null && payload.total_pages !== null && payload.current_page > payload.total_pages) {
      setError('Current page cannot exceed total pages.'); return;
    }
    if (payload.total_pages) payload.percent = payload.current_page / payload.total_pages * 100;
    mutate(() => readerApi.saveProgress(book.book_id, payload), 'Reading progress saved.', result => {
      const saved = result.progress || payload;
      setProgress({ percent: saved.percent, current_page: saved.current_page ?? '', total_pages: saved.total_pages ?? '' });
      onProgressChange?.(book.book_id, saved);
    });
  }

  const userId = currentUser?.user_id ?? currentUser?.id;
  return <section className="reader-tools space-y-4 mt-8" aria-label="Reader tools" aria-busy={loading || pending}>
    <h2 className="font-serif text-xl font-bold">Your reading companion</h2>
    {error && <div role="alert" className="rounded-lg border border-[#E8DFC8] bg-[#FFF9ED] px-3 py-2 text-sm text-[#7A5A18]">{error} {!data && <span className="mt-2 flex flex-wrap gap-2"><button type="button" className={button} disabled={loading || pending} onClick={() => mutate(() => load(true), 'Reader tools loaded.')}>Retry reader tools</button>{onClose && <button type="button" className={button} onClick={onClose}>Back to recommendations</button>}</span>}</div>}
    {notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">Loading reader tools…</p> : !data ? null : <>
      {!currentUser && <p>Sign in to save progress, private notes, reviews, and shelves.</p>}
      {currentUser && <fieldset disabled={pending} className="space-y-4 min-w-0">
        <legend className="sr-only">Personal reading tools</legend>
        <form onSubmit={saveProgress} className={panel}>
          <h3 className="font-serif font-bold">Reading progress</h3>
          <label className="block">Progress (%)<input className={input} type="number" required min="0" max="100" step="any" value={progress.percent} onChange={e => setProgress({ ...progress, percent: e.target.value })} /></label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label>Current page<input className={input} type="number" min="0" max="100000" step="1" value={progress.current_page} onChange={e => setProgress({ ...progress, current_page: e.target.value })} /></label>
            <label>Total pages (optional)<input className={input} type="number" min="1" max="100000" step="1" value={progress.total_pages} onChange={e => setProgress({ ...progress, total_pages: e.target.value })} /></label>
          </div>
          <p className="text-xs">Leave both page counts blank to save a percentage, or provide both to calculate progress from pages.</p>
          <button className={button}>Save progress</button>
        </form>
        <section className={panel} aria-label="Private notes and quotes">
          <h3 className="font-serif font-bold">Private notes & quotes</h3>
          <p className="text-sm">Only you can see these notes and quotes.</p>
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!note.text.trim()) return; mutate(() => readerApi.addNote(book.book_id, { kind: note.kind, text: note.text.trim(), page: note.page === '' ? null : Number(note.page) }), 'Private entry saved.', () => setNote({ kind: 'note', text: '', page: '' })); }}>
            <label className="block">Entry type<select className={input} value={note.kind} onChange={e => setNote({ ...note, kind: e.target.value })}><option value="note">Note</option><option value="quote">Quote</option></select></label>
            <label className="block">Private note or quote<textarea className={input} required maxLength={5000} value={note.text} onChange={e => setNote({ ...note, text: e.target.value })} /></label>
            <label className="block">Entry page (optional)<input className={input} type="number" min="1" max="100000" step="1" value={note.page} onChange={e => setNote({ ...note, page: e.target.value })} /></label>
            <button className={button} disabled={!note.text.trim()}>Save private entry</button>
          </form>
          <label className="block">Search private entries<input type="search" className={input} value={noteQuery} onChange={event => setNoteQuery(event.target.value)} placeholder="Search this book’s notes and quotes" /></label>
          <ul className="space-y-3">{(data.notes || []).filter(entry => entry.text.toLocaleLowerCase().includes(noteQuery.trim().toLocaleLowerCase())).map(entry => <li key={entry.id} className="border-t pt-3">
             <p className="text-xs">{entry.kind === 'quote' ? 'Quote' : 'Note'}{entry.page != null ? ` · Page ${entry.page}` : ''}</p>
             {entry.created_at && <time className="text-xs" dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString()}</time>}
            <p className="whitespace-pre-wrap break-words">{entry.text}</p>
            <button className={button} aria-label={`Delete ${entry.kind} ${entry.id}`} onClick={() => mutate(() => readerApi.deleteNote(entry.id), 'Private entry deleted.')}>Delete</button>
          </li>)}</ul>
          {!data.notes?.length && <p className="text-sm">No private entries yet.</p>}
          {data.notes?.length > 0 && !(data.notes || []).some(entry => entry.text.toLocaleLowerCase().includes(noteQuery.trim().toLocaleLowerCase())) && <p className="text-sm">No entries match your search.</p>}
        </section>
        <form className={panel} onSubmit={e => { e.preventDefault(); if (!review.text.trim()) return; mutate(() => readerApi.saveReview(book.book_id, { ...review, text: review.text.trim() }), review.visibility === 'public' ? 'Review published.' : 'Private review saved.'); }}>
          <h3 className="font-serif font-bold">Your review</h3>
          <label className="block">Review text<textarea className={input} required maxLength={10000} value={review.text} onChange={e => setReview({ ...review, text: e.target.value })} /></label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={review.visibility === 'public'} onChange={e => setReview({ ...review, visibility: e.target.checked ? 'public' : 'private' })} />Publish this review publicly</label>
          <p className="text-sm">Reviews are private by default. A published review is visible with your username. Uncheck and save to make it private again.</p>
          <div className="flex flex-wrap gap-2"><button className={button} disabled={!review.text.trim()}>{review.visibility === 'public' ? 'Save public review' : 'Save private review'}</button>
          {data.review && <button type="button" className={button} onClick={() => mutate(() => readerApi.deleteReview(book.book_id), 'Review deleted.', () => setReview({ text: '', visibility: 'private' }))}>Delete review</button>}</div>
        </form>
        <section className={panel} aria-label="Follow authors">
          <h3 className="font-serif font-bold">Follow the authors</h3>
          {authorsOf(book).map(author => { const followed = data.followed_authors?.includes(author); return <div key={author} className="flex items-center justify-between gap-3"><span>{author}</span><button className={button} onClick={() => mutate(() => followed ? readerApi.unfollowAuthor(author) : readerApi.followAuthor(author), followed ? `Unfollowed ${author}.` : `Following ${author}.`)}>{followed ? 'Unfollow' : 'Follow'} {author}</button></div>; })}
        </section>
        <section className={panel} aria-label="Custom shelves">
          <h3 className="font-serif font-bold">Custom shelves</h3>
          {!shelves.length && <p>Create a custom shelf in your Reader workspace, then add this book here.</p>}
          {shelves.map(shelf => { const included = data.shelves?.some(item => item.id === shelf.id); return <div key={shelf.id} className="flex items-center justify-between gap-3"><span>{shelf.name}</span><button className={button} onClick={() => mutate(() => included ? readerApi.removeFromShelf(shelf.id, book.book_id) : readerApi.addToShelf(shelf.id, book.book_id), included ? 'Book removed from shelf.' : 'Book added to shelf.')}>{included ? 'Remove from' : 'Add to'} {shelf.name}</button></div>; })}
        </section>
      </fieldset>}
      <section className={panel} aria-label="Public reviews"><h3 className="font-serif font-bold">Public reviews</h3>
        {!data.reviews?.length && <p>No public reviews yet.</p>}
        <ul className="space-y-3">{(data.reviews || []).map(item => <li key={item.id}><p className="font-semibold">{item.username}</p><p className="whitespace-pre-wrap break-words">{item.text}</p></li>)}</ul>
      </section>
      <section className={panel} aria-label="Public comments"><h3 className="font-serif font-bold">Public comments</h3>
        {currentUser && <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!comment.trim()) return; mutate(() => readerApi.addComment(book.book_id, comment.trim()), 'Comment posted publicly.', () => setComment('')); }}>
          <label className="block">Public comment<textarea className={input} required maxLength={2000} disabled={pending} value={comment} onChange={e => setComment(e.target.value)} /></label>
          <p className="text-sm">Comments are public and display your username.</p>
          <button className={button} disabled={pending || !comment.trim()}>Post public comment</button>
        </form>}
        {!data.comments?.length && <p>No public comments yet.</p>}
        <ul className="space-y-3">{(data.comments || []).map(item => <li key={item.id}><p className="font-semibold">{item.username}</p><p className="whitespace-pre-wrap break-words">{item.text}</p>{userId != null && String(item.user_id) === String(userId) && <button className={button} disabled={pending} aria-label={`Delete comment ${item.id}`} onClick={() => mutate(() => readerApi.deleteComment(item.id), 'Comment deleted.')}>Delete comment</button>}</li>)}</ul>
      </section>
    </>}
  </section>;
}

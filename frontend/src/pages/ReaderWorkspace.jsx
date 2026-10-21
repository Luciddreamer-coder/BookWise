import { useEffect, useRef, useState } from 'react';
import { readerApi, sharedListUrl } from '../services/reader';

const panel = 'rounded-xl border border-[#E8DFC8] bg-white p-5 space-y-4';
const button = 'rounded-lg border border-[#D8CEBD] px-3 py-2 text-sm font-medium hover:bg-[#F2ECE1] disabled:opacity-50';
const input = 'block w-full rounded-lg border border-[#D8CEBD] bg-white px-3 py-2 text-sm';

function Shelf({ shelf, pending, mutate, onSelectBook }) {
  const [name, setName] = useState(shelf.name);
  return <article className="rounded-lg border border-[#E8DFC8] p-4 space-y-3" aria-label={`Shelf ${shelf.name}`}>
    <h3 className="font-serif text-lg font-bold">{shelf.name}</h3>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (name.trim()) mutate(() => readerApi.renameShelf(shelf.id, name.trim()), 'Shelf renamed.'); }}>
      <label className="grow">Shelf name<input className={input} aria-label={`Rename ${shelf.name}`} value={name} maxLength={100} required disabled={pending} onChange={event => setName(event.target.value)} /></label>
      <button className={button} disabled={pending || !name.trim()}>Rename shelf</button>
      <button type="button" className={button} disabled={pending} onClick={() => mutate(() => readerApi.deleteShelf(shelf.id), 'Shelf deleted.')}>Delete shelf</button>
    </form>
    {!shelf.books?.length && <p className="text-sm">This shelf is empty. Open a book and use its Custom shelves controls to add it.</p>}
    <ul className="space-y-2">{(shelf.books || []).map(book => <li key={book.book_id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
      <button className="text-left underline underline-offset-4" onClick={() => onSelectBook?.(book)}>{book.title}</button>
      <button className={button} disabled={pending} aria-label={`Remove ${book.title} from ${shelf.name}`} onClick={() => mutate(() => readerApi.removeFromShelf(shelf.id, book.book_id), 'Book removed from shelf.')}>Remove book</button>
    </li>)}</ul>
  </article>;
}

export default function ReaderWorkspace({ onSelectBook }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [shelfName, setShelfName] = useState('');
  const [listTitle, setListTitle] = useState('');
  const [sourceShelf, setSourceShelf] = useState('');
  const alive = useRef(true);

  async function load() {
    const [shelves, authors, progress, lists] = await Promise.all([
      readerApi.getShelves(), readerApi.getAuthors(), readerApi.getProgress(), readerApi.getLists()
    ]);
    if (alive.current) setData({ shelves: shelves.shelves || [], authors: authors.authors || [], progress: progress.progress || [], lists: lists.lists || [] });
  }

  useEffect(() => {
    alive.current = true;
    load().catch(err => { if (alive.current) setError(err.message); }).finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; };
  }, []);

  async function mutate(action, message, after) {
    if (pending) return;
    setPending(true); setError(''); setNotice('');
    try {
      await action();
      if (!alive.current) return;
      after?.();
      await load();
      if (alive.current) setNotice(message);
    } catch (err) {
      if (alive.current) setError(err.message);
    } finally {
      if (alive.current) setPending(false);
    }
  }

  const selectedShelf = data?.shelves.find(shelf => String(shelf.id) === sourceShelf);
  const selectedBooks = selectedShelf?.book_ids || selectedShelf?.books?.map(book => book.book_id) || [];
  const continuing = (data?.progress || []).filter(item => item.book && Number(item.percent) < 100);

  return <div className="reader-workspace space-y-6 pb-16" aria-busy={loading || pending}>
    <header className={panel}><h1 className="font-serif text-3xl font-bold">Reader workspace</h1><p>Pick up where you left off, organize your books, and share a hand-picked list.</p></header>
    {error && <div role="alert" className="rounded-lg border border-red-300 p-4 text-red-800">{error} <button className={button} disabled={pending || loading} onClick={() => mutate(load, 'Workspace refreshed.')}>Retry workspace</button></div>}
    {notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">Loading your reading workspace…</p> : !data ? null : <>
      <section className={panel} aria-label="Continue reading">
        <h2 className="font-serif text-xl font-bold">Continue reading</h2>
        {!continuing.length && <p>No books in progress. Open a book to save your reading progress.</p>}
        <ul className="grid sm:grid-cols-2 gap-3">{continuing.map(item => <li key={item.book.book_id} className="rounded-lg border border-[#E8DFC8] p-4 space-y-2">
          <h3 className="font-serif font-bold">{item.book.title}</h3>
          <progress className="w-full" aria-label={`${item.book.title} reading progress`} max="100" value={item.percent} />
           <p>{Math.round(Number(item.percent) * 10) / 10}% read{item.current_page != null ? ` · Page ${item.current_page}${item.total_pages != null ? ` of ${item.total_pages}` : ''}` : ''}</p>
          <button className={button} onClick={() => onSelectBook?.(item.book)}>Resume {item.book.title}</button>
        </li>)}</ul>
      </section>
      <section className={panel} aria-label="Custom shelves">
        <h2 className="font-serif text-xl font-bold">Custom shelves</h2>
        <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (shelfName.trim()) mutate(() => readerApi.createShelf(shelfName.trim()), 'Shelf created.', () => setShelfName('')); }}>
          <label className="grow">New shelf name<input className={input} value={shelfName} maxLength={100} required disabled={pending} onChange={event => setShelfName(event.target.value)} /></label>
          <button className={button} disabled={pending || !shelfName.trim()}>Create shelf</button>
        </form>
        {!data.shelves.length && <p>No custom shelves yet. Create one, then add books from their detail panels.</p>}
        {data.shelves.map(shelf => <Shelf key={`${shelf.id}:${shelf.name}`} shelf={shelf} pending={pending} mutate={mutate} onSelectBook={onSelectBook} />)}
      </section>
      <section className={panel} aria-label="Followed authors">
        <h2 className="font-serif text-xl font-bold">Followed authors</h2>
        {!data.authors.length && <p>Follow authors from a book’s details to keep them here.</p>}
        <ul className="space-y-2">{data.authors.map(author => <li key={author} className="flex flex-wrap items-center justify-between gap-2"><span>{author}</span><button className={button} disabled={pending} onClick={() => mutate(() => readerApi.unfollowAuthor(author), `Unfollowed ${author}.`)}>Unfollow {author}</button></li>)}</ul>
      </section>
      <section className={panel} aria-label="Saved share lists">
        <h2 className="font-serif text-xl font-bold">Saved share lists</h2>
        <p className="text-sm">Save a snapshot of a custom shelf. Lists stay private until you publish a link. Only the list title and books are shared, never your notes or reading progress.</p>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (!listTitle.trim() || !selectedBooks.length || selectedBooks.length > 100) return; mutate(() => readerApi.createList(listTitle.trim(), selectedBooks), 'Private list saved. Publish it when you are ready.', () => setListTitle('')); }}>
          <label className="block">List title<input className={input} required maxLength={100} disabled={pending} value={listTitle} onChange={event => setListTitle(event.target.value)} /></label>
          <label className="block">Books from shelf<select aria-label="Books from shelf" className={input} required disabled={pending} value={sourceShelf} onChange={event => setSourceShelf(event.target.value)}><option value="">Choose a custom shelf</option>{data.shelves.map(shelf => <option key={shelf.id} value={shelf.id}>{shelf.name}</option>)}</select></label>
          {selectedShelf && <p className="text-sm">{selectedBooks.length} books will be saved in this list. Later shelf changes won’t change the saved list.</p>}
          {selectedBooks.length > 100 && <p role="alert">A shared list can contain up to 100 books. Choose a smaller shelf.</p>}
          <button className={button} disabled={pending || !listTitle.trim() || !selectedBooks.length || selectedBooks.length > 100}>Save private list</button>
        </form>
        {!data.lists.length && <p>No saved lists yet.</p>}
        <ul className="space-y-3">{data.lists.map(list => <li key={list.id} className="rounded-lg border border-[#E8DFC8] p-4 space-y-3">
          <h3 className="font-serif font-bold">{list.title}</h3>
          <p className="text-sm">{list.book_ids?.length ?? 0} books · {list.share_token ? 'Published — anyone with the link can view' : 'Private — no public link'}</p>
          {list.share_token && <a className="block break-all underline" href={sharedListUrl(list.share_token)}>{sharedListUrl(list.share_token)}</a>}
          <div className="flex flex-wrap gap-2">
            {list.share_token ? <button className={button} disabled={pending} aria-label={`Revoke link for ${list.title}`} onClick={() => mutate(() => readerApi.revokeList(list.id), 'Share link revoked. The old link no longer opens this list.')}>Revoke share link</button> : <button className={button} disabled={pending} aria-label={`Publish ${list.title}`} onClick={() => mutate(() => readerApi.publishList(list.id), 'List published. Anyone with the link can view its title and books.')}>Publish share link</button>}
            <button className={button} disabled={pending} aria-label={`Delete list ${list.title}`} onClick={() => mutate(() => readerApi.deleteList(list.id), 'Saved list deleted.')}>Delete list</button>
          </div>
        </li>)}</ul>
      </section>
    </>}
  </div>;
}

const present = value => value !== null && value !== undefined && value !== '';
const text = value => Array.isArray(value) ? value.join(', ') || 'Unknown' : present(value) ? String(value) : 'Unknown';
const positiveNumber = value => present(value) && Number.isFinite(Number(value)) && Number(value) > 0;

export default function BookComparison({ books = [], onRemove, onClose }) {
  const rows = [
    ['Authors', book => text(book.authors)],
    ['Genre', book => text(book.primary_genre || book.genres)],
    ['Average rating', book => positiveNumber(book.average_rating) ? `${Number(book.average_rating).toFixed(2)} / 5` : 'Not rated'],
    ['Publication year', book => positiveNumber(book.original_publication_year) ? String(book.original_publication_year) : 'Unknown'],
    ['Pages', book => positiveNumber(book.num_pages ?? book.pages ?? book.page_count) ? String(book.num_pages ?? book.pages ?? book.page_count) : 'Unknown']
  ];
  return <section className="book-comparison rounded-xl border border-[#E8DFC8] bg-white p-5 space-y-4" aria-label="Book comparison">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-serif text-2xl font-bold">Compare books</h2><button className="rounded-lg border px-3 py-2" onClick={() => onClose?.()}>Close comparison</button></header>
    {books.length < 2 && <p>Select at least two books to compare them side by side.</p>}
    {books.length > 0 && <div className="overflow-x-auto" role="region" aria-label="Comparison table" tabIndex="0"><table className="w-full border-collapse text-left text-sm">
      <caption className="pb-3 text-left">Book details side by side. Unknown means the catalogue does not supply that information.</caption>
      <thead><tr><th scope="col" className="p-3 border-b">Title</th>{books.map(book => <th key={book.book_id} scope="col" className="p-3 border-b min-w-44"><span className="block font-serif text-base">{book.title}</span><button className="mt-2 rounded border px-2 py-1 text-xs font-normal" aria-label={`Remove ${book.title} from comparison`} onClick={() => onRemove?.(book.book_id)}>Remove</button></th>)}</tr></thead>
      <tbody>{rows.map(([name, value]) => <tr key={name}><th scope="row" className="p-3 border-b font-medium">{name}</th>{books.map(book => <td key={book.book_id} className="p-3 border-b align-top">{value(book)}</td>)}</tr>)}</tbody>
    </table></div>}
  </section>;
}

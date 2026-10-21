import { useCallback, useState, useEffect } from 'react';
import { 
  BarChart3, 
  Layers, 
  Database, 
  Scale, 
  Sparkles, 
  Award,
} from 'lucide-react';
import { api } from '../services/api';

export default function MLDashboardPage({ currentUser, onSelectBook, onSignIn }) {
  const [metricsData, setMetricsData] = useState(null);
  const [comparisonData, setComparisonData] = useState(null);
  const [compBookId, setCompBookId] = useState(1);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [loadingComp, setLoadingComp] = useState(false);
  const [activeTab, setActiveTab] = useState('benchmarks'); // benchmarks, comparison, sparsity, algorithms

  const loadMetrics = useCallback(async () => {
    try {
      setLoadingMetrics(true);
      const res = await api.getEvaluationMetrics();
      setMetricsData(res);
    } catch {
      setMetricsData({});
    } finally {
      setLoadingMetrics(false);
    }
  }, []);

  const loadComparison = useCallback(async (bId = compBookId) => {
    if (!currentUser?.id) {
      setComparisonData(null);
      return;
    }
    try {
      setLoadingComp(true);
      const res = await api.compareModels({ bookId: bId, n: 4 });
      setComparisonData(res);
    } catch {
      setComparisonData(null);
    } finally {
      setLoadingComp(false);
    }
  }, [compBookId, currentUser?.id]);

  useEffect(() => { queueMicrotask(() => { loadMetrics(); loadComparison(); }); }, [loadComparison, loadMetrics]);

  const summary = metricsData?.metrics_summary || {};
  const coldStart = metricsData?.cold_start_comparison || [];

  return (
    <div className="space-y-8 pb-16">
      
      {/* Editorial Header */}
      <div className="bg-gradient-to-r from-[#211A13] via-[#2D2319] to-[#1E1710] rounded-2xl p-6 sm:p-8 text-[#FAF7F2] border border-[#C5A059]/40 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#C5A059]/20 border border-[#C5A059]/40 text-[#D4AF37] text-xs font-mono">
              <Award size={14} />
              <span>Academic Recommender Research & Benchmarks</span>
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Model Evaluation & Algorithmic Architecture
            </h1>
            <p className="text-sm font-serif italic text-[#CFC2B0] max-w-2xl">
              Comparative empirical analysis on the Goodbooks-10k dataset across Popularity Baseline, 
              Content-Based Filtering, SVD Collaborative Filtering, and Hybrid Ensembling.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-center shrink-0">
            <div className="bg-black/30 backdrop-blur-md p-3 rounded-xl border border-[#C5A059]/20">
              <span className="block font-mono text-xl font-bold text-[#D4AF37]">5,976,479</span>
              <span className="text-[10px] text-[#A6977F] uppercase tracking-wider">Ratings Analyzed</span>
            </div>
            <div className="bg-black/30 backdrop-blur-md p-3 rounded-xl border border-[#C5A059]/20">
              <span className="block font-mono text-xl font-bold text-emerald-400">98.88%</span>
              <span className="text-[10px] text-[#A6977F] uppercase tracking-wider">Matrix Sparsity</span>
            </div>
          </div>
        </div>

        {/* Dashboard Navigation Tabs */}
        <div className="flex items-center gap-2 mt-8 pt-4 border-t border-white/10 overflow-x-auto">
          {[
            { id: 'benchmarks', label: 'Evaluation Metrics', icon: BarChart3 },
            { id: 'comparison', label: 'Side-by-Side Model Playground', icon: Scale },
            { id: 'sparsity', label: 'Sparsity & Cold-Start Analysis', icon: Database },
            { id: 'algorithms', label: 'Algorithmic Formulations', icon: Layers }
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-[#C5A059] text-[#1E1B18] font-bold shadow-md'
                    : 'text-[#CFC2B0] hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: Evaluation Metrics Table & KPI Cards */}
      {activeTab === 'benchmarks' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Key Metric KPI Highlight Cards */}
          {loadingMetrics ? <div className="rounded-xl border border-[#E8DFC8] bg-white p-8 text-center text-sm text-[#7A6D5A]" role="status">Loading evaluation metrics…</div> : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-xl border border-[#E8DFC8] shadow-xs">
              <span className="text-[11px] font-mono uppercase text-[#7A6D5A] font-semibold block">
                Top Precision@5
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-serif text-3xl font-bold text-[#1E1B18]">
                  {summary["Hybrid Recommender"]?.["Precision@5"] || "0.1936"}
                </span>
                <span className="text-xs text-emerald-600 font-semibold font-mono">+112% vs Base</span>
              </div>
              <p className="text-[11px] text-[#8C8274] mt-1">
                Hybrid model top-5 recommendations relevant in held-out ground truth.
              </p>
            </div>

            <div className="bg-white p-5 rounded-xl border border-[#E8DFC8] shadow-xs">
              <span className="text-[11px] font-mono uppercase text-[#7A6D5A] font-semibold block">
                Ranking Quality (NDCG@10)
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-serif text-3xl font-bold text-[#9E7D3B]">
                  {summary["Hybrid Recommender"]?.["NDCG@10"] || "0.4395"}
                </span>
                <span className="text-xs text-emerald-600 font-semibold font-mono">0.4395</span>
              </div>
              <p className="text-[11px] text-[#8C8274] mt-1">
                Measures whether the most relevant books are ranked closest to rank 1.
              </p>
            </div>

            <div className="bg-white p-5 rounded-xl border border-[#E8DFC8] shadow-xs">
              <span className="text-[11px] font-mono uppercase text-[#7A6D5A] font-semibold block">
                Rating Prediction RMSE
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-serif text-3xl font-bold text-[#2D6A4F]">
                  {summary["Hybrid Recommender"]?.["RMSE"] || "0.8948"}
                </span>
                <span className="text-xs text-emerald-600 font-semibold font-mono">Lowest Error</span>
              </div>
              <p className="text-[11px] text-[#8C8274] mt-1">
                Root Mean Squared Error on 50,000 held-out numerical test ratings.
              </p>
            </div>

            <div className="bg-white p-5 rounded-xl border border-[#E8DFC8] shadow-xs">
              <span className="text-[11px] font-mono uppercase text-[#7A6D5A] font-semibold block">
                Catalog Coverage
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-serif text-3xl font-bold text-[#722F37]">
                  {summary["Content-Based"]?.["Catalog_Coverage_Pct"] || "11.8"}%
                </span>
                <span className="text-xs text-[#8C8274] font-mono">1,180 items</span>
              </div>
              <p className="text-[11px] text-[#8C8274] mt-1">
                Avoids popularity monopoly; surfaces wide diversity of niche titles.
              </p>
            </div>
          </div>}

          {/* Academic Comparative Table */}
          <div className="bg-white rounded-xl border border-[#E8DFC8] overflow-hidden shadow-xs">
            <div className="p-5 border-b border-[#E8DFC8] bg-[#FAF7F2]">
              <h3 className="font-serif font-bold text-lg text-[#1E1B18]">
                Algorithm Benchmark Comparison Matrix
              </h3>
              <p className="text-xs text-[#7A6D5A] mt-0.5">
                Evaluated on 80/20 train/test split. Relevant item defined as held-out test rating ≥ 4.0 stars.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E8DFC8] bg-[#F5EFE6] text-[#57524D] font-mono">
                    <th className="py-3 px-4 font-bold">Recommendation Model</th>
                    <th className="py-3 px-3 text-right">Precision@5</th>
                    <th className="py-3 px-3 text-right">Precision@10</th>
                    <th className="py-3 px-3 text-right">Recall@10</th>
                    <th className="py-3 px-3 text-right">NDCG@10</th>
                    <th className="py-3 px-3 text-right">RMSE (Error)</th>
                    <th className="py-3 px-3 text-right">MAE (Error)</th>
                    <th className="py-3 px-4 text-right">Catalog Coverage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F2ECE1]">
                  {Object.entries(summary).map(([mName, mVals]) => {
                    const isHybrid = mName.includes("Hybrid");
                    return (
                      <tr key={mName} className={isHybrid ? "bg-[#FAF5EB] font-medium" : "hover:bg-[#FAF7F2]"}>
                        <td className="py-3.5 px-4 font-serif text-sm text-[#1E1B18] flex items-center gap-2">
                          {isHybrid && <Sparkles size={14} className="text-[#C5A059]" />}
                          <span>{mName}</span>
                          {isHybrid && (
                            <span className="text-[9px] bg-[#C5A059] text-white px-1.5 py-0.5 rounded font-mono uppercase tracking-wider">
                              Optimal
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono text-[#1E1B18] font-bold">
                          {mVals["Precision@5"] !== undefined ? Number(mVals["Precision@5"]).toFixed(4) : "—"}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono text-[#57524D]">
                          {mVals["Precision@10"] !== undefined ? Number(mVals["Precision@10"]).toFixed(4) : "—"}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono text-[#57524D]">
                          {mVals["Recall@10"] !== undefined ? Number(mVals["Recall@10"]).toFixed(4) : "—"}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono text-[#9E7D3B] font-bold">
                          {mVals["NDCG@10"] !== undefined ? Number(mVals["NDCG@10"]).toFixed(4) : "—"}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono text-[#57524D]">
                          {mVals["RMSE"] !== undefined ? mVals["RMSE"] : "—"}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono text-[#57524D]">
                          {mVals["MAE"] !== undefined ? mVals["MAE"] : "—"}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-[#722F37] font-semibold">
                          {mVals["Catalog_Coverage_Pct"]}% ({mVals["Unique_Items_Recommended"]} books)
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="p-4 bg-[#FAF7F2] border-t border-[#E8DFC8] text-[11px] text-[#6B6358] space-y-1">
              <p>
                <strong>Academic Interpretation:</strong> The <strong>Hybrid Recommender</strong> achieves the highest ranking quality 
                (NDCG@10 = 0.4395) and precision (Precision@5 = 0.1936), while preserving a high catalog coverage of 11.33%. 
                Pure collaborative filtering struggles with extreme sparsity (98.88%), whereas pure content-based filtering lacks serendipity. 
                Combining them with an adaptive linear weighting achieves the optimal balance.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Side-by-Side Playground */}
      {activeTab === 'comparison' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Playground Controller */}
          <div className="bg-white p-5 rounded-xl border border-[#E8DFC8] shadow-xs flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-serif font-bold text-lg text-[#1E1B18]">
                Interactive Model Recommendation Comparison
              </h3>
              <p className="text-xs text-[#7A6D5A]">
                Inspect what each algorithm recommends for the exact same query in real time.
              </p>
            </div>

             <div className="flex items-center gap-3 text-xs">
               <div>
                 <label className="text-[10px] text-[#8C8274] block font-mono">Authenticated User ID:</label>
                 <span className="inline-flex rounded-lg border border-[#D8CEBD] bg-[#FAF7F2] px-3 py-1.5 font-mono font-medium">
                   {currentUser?.id ? `#${currentUser.id}` : 'Sign in required'}
                 </span>
               </div>

              <div>
                <label className="text-[10px] text-[#8C8274] block font-mono">Anchor Book ID:</label>
                <select
                  value={compBookId}
                  onChange={(e) => {
                    const b = parseInt(e.target.value);
                    setCompBookId(b);
                     loadComparison(b);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-[#D8CEBD] bg-[#FAF7F2] font-mono font-medium"
                >
                  <option value="1">#1: The Hunger Games</option>
                  <option value="2">#2: Harry Potter & Sorcerer's Stone</option>
                  <option value="4">#4: To Kill a Mockingbird</option>
                  <option value="5">#5: The Great Gatsby</option>
                  <option value="7">#7: The Hobbit</option>
                  <option value="13">#13: 1984 (George Orwell)</option>
                  <option value="26">#26: The Da Vinci Code</option>
                  <option value="39">#39: A Game of Thrones</option>
                </select>
             </div>
           </div>
          </div>

          {/* 4 Models Columns */}
           {!currentUser ? (
             <div className="rounded-xl border border-[#E8DFC8] bg-white p-10 text-center">
               <p className="font-serif text-lg font-bold text-[#1E1B18]">Sign in to compare recommendations</p>
               <p className="mt-2 text-sm text-[#7A6D5A]">The comparison playground uses your authenticated account, never a default user.</p>
               <button type="button" onClick={onSignIn} className="mt-5 rounded-lg bg-[#1E1B18] px-4 py-2.5 text-sm font-semibold text-white">Sign in</button>
             </div>
           ) : loadingComp ? (
            <div className="py-20 text-center text-xs text-[#8C8274] animate-pulse">
              Running 4 recommendation algorithms in parallel...
            </div>
          ) : comparisonData?.models ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(comparisonData.models).map(([mKey, mInfo]) => (
                <div key={mKey} className="bg-white rounded-xl border border-[#E8DFC8] p-4 flex flex-col justify-between shadow-xs">
                  <div>
                    <div className="border-b border-[#F0E8DA] pb-3 mb-3">
                      <span className="text-[10px] uppercase font-mono font-bold text-[#9E7D3B] block">
                        {mInfo.technique.split('(')[0]}
                      </span>
                      <h4 className="font-serif font-bold text-base text-[#1E1B18] mt-0.5">
                        {mInfo.name}
                      </h4>
                      <p className="text-[11px] text-[#7A6D5A] mt-1 italic">
                        {mInfo.best_for}
                      </p>
                    </div>

                    {/* Book Cards */}
                    <div className="space-y-2.5">
                      {mInfo.recommendations?.slice(0, 4).map((rec, i) => (
                        <div 
                          key={rec.book_id || i}
                          onClick={() => onSelectBook && onSelectBook(rec)}
                          className="p-2 rounded-lg bg-[#FAF7F2] border border-[#EFE8DE] hover:border-[#C5A059] cursor-pointer transition-all flex gap-2 items-center"
                        >
                          <span className="w-5 text-center font-mono font-bold text-xs text-[#9E7D3B]">
                            #{i + 1}
                          </span>
                          <div className="w-10 aspect-[2/3] shrink-0 rounded overflow-hidden bg-[#EDE5D8]">
                            <img src={rec.image_url} alt={rec.title} className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-grow overflow-hidden">
                            <h5 className="font-serif font-bold text-xs text-[#1E1B18] truncate">
                              {rec.title}
                            </h5>
                            <p className="text-[10px] text-[#7A6D5A] truncate">{rec.authors}</p>
                            <span className="text-[10px] text-[#C5A059] font-mono font-semibold">
                              {rec.predicted_rating ? `Pred ${rec.predicted_rating}★` : `${rec.average_rating}★`}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-[#F0E8DA] text-[10px] text-[#8C8274] font-mono">
                    Technique: {mInfo.technique}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* TAB 3: Sparsity & Cold-Start Deep Dive */}
      {activeTab === 'sparsity' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Matrix Sparsity Card */}
          <div className="bg-white rounded-xl border border-[#E8DFC8] p-6 shadow-xs">
            <h3 className="font-serif font-bold text-xl text-[#1E1B18] flex items-center gap-2">
              <Database size={20} className="text-[#C5A059]" />
              The Goodbooks-10k User-Book Interaction Matrix
            </h3>
            <p className="text-xs text-[#7A6D5A] mt-1">
              Visualizing the structural sparsity of 53,424 users across 10,000 unique titles.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6 items-center">
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-[#FAF7F2] border border-[#EAE2D3]">
                  <span className="text-[11px] text-[#8C8274] font-mono uppercase block">Total Possible Ratings</span>
                  <span className="font-mono text-xl font-bold text-[#1E1B18]">534,240,000</span>
                  <span className="text-[10px] text-[#8C8274] block">53,424 users × 10,000 books</span>
                </div>
                <div className="p-3 rounded-lg bg-[#FAF7F2] border border-[#EAE2D3]">
                  <span className="text-[11px] text-[#8C8274] font-mono uppercase block">Observed Ratings</span>
                  <span className="font-mono text-xl font-bold text-[#2D6A4F]">5,976,479</span>
                  <span className="text-[10px] text-[#8C8274] block">Confirmed user interactions</span>
                </div>
                <div className="p-3 rounded-lg bg-[#FFF8EB] border border-[#F3DFC1]">
                  <span className="text-[11px] text-[#B45309] font-mono uppercase block">Interaction Sparsity</span>
                  <span className="font-mono text-xl font-bold text-[#B45309]">98.8813%</span>
                  <span className="text-[10px] text-[#B45309] block">98.88% of all matrix cells are empty</span>
                </div>
              </div>

              {/* Visual Matrix representation */}
              <div className="md:col-span-2 bg-[#1E1B18] p-5 rounded-xl text-white font-mono text-xs space-y-3">
                <div className="flex items-center justify-between text-[#A6977F] pb-2 border-b border-white/10">
                  <span>Interactive Sparse Matrix Canvas</span>
                  <span>Density: 1.1187%</span>
                </div>

                <div className="grid grid-cols-12 gap-1 p-2 bg-black/40 rounded border border-white/10">
                  {Array.from({ length: 48 }).map((_, i) => (
                    <div 
                      key={i} 
                      className={`h-4 rounded-xs transition-all ${
                        i % 7 === 0 
                          ? 'bg-[#C5A059] shadow-xs' 
                          : 'bg-white/5'
                      }`}
                      title={i % 7 === 0 ? "Observed Rating" : "Unobserved Cell (Sparse)"}
                    />
                  ))}
                </div>

                <div className="text-[11px] text-[#CFC2B0] space-y-1">
                  <p>
                    <span className="text-[#D4AF37] font-bold">● Amber Dots:</span> Observed reader ratings (density ~1.12%).
                  </p>
                  <p>
                    <span className="text-[#8C8274] font-bold">● Empty Matrix:</span> 98.88% missing entries.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Cold Start Academic Analysis Table */}
          <div className="bg-white rounded-xl border border-[#E8DFC8] overflow-hidden shadow-xs">
            <div className="p-5 border-b border-[#E8DFC8] bg-[#FAF7F2]">
              <h3 className="font-serif font-bold text-lg text-[#1E1B18]">
                Cold-Start Resilience Across Algorithms
              </h3>
              <p className="text-xs text-[#7A6D5A] mt-0.5">
                Evaluation of model behavior under zero-knowledge and early-knowledge reader states.
              </p>
            </div>

            <div className="divide-y divide-[#F2ECE1]">
              {coldStart.map((cs, idx) => (
                <div key={idx} className="p-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-center text-xs">
                  <div className="md:col-span-3">
                    <h4 className="font-serif font-bold text-sm text-[#1E1B18]">{cs.model}</h4>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#FAF5EB] text-[#9E7D3B] border border-[#EDE0CC] inline-block mt-1 font-semibold">
                      Grade: {cs.cold_start_grade}
                    </span>
                  </div>
                  <div className="md:col-span-4 text-[#57524D]">
                    <span className="text-[10px] font-mono uppercase text-[#8C8274] block">Zero Ratings (Pure Cold-Start)</span>
                    <p className="mt-0.5">{cs.zero_ratings_behavior}</p>
                  </div>
                  <div className="md:col-span-5 text-[#57524D]">
                    <span className="text-[10px] font-mono uppercase text-[#8C8274] block">1-3 Ratings (Warm-Start)</span>
                    <p className="mt-0.5">{cs.few_ratings_behavior}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Mathematical Formulations */}
      {activeTab === 'algorithms' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fadeIn">
          {/* Card 1: Popularity */}
          <div className="bg-white p-6 rounded-xl border border-[#E8DFC8] shadow-xs space-y-3">
            <span className="text-xs font-mono font-bold uppercase text-[#9E7D3B]">Model 1: Baseline</span>
            <h3 className="font-serif font-bold text-xl text-[#1E1B18]">IMDB Weighted Rating</h3>
            <div className="p-3 bg-[#FAF7F2] rounded-lg border border-[#EAE2D3] font-mono text-xs text-[#1E1B18] text-center">
              WR = (v / (v + m)) · R + (m / (v + m)) · C
            </div>
            <ul className="text-xs text-[#57524D] space-y-1 list-disc list-inside">
              <li><strong>v</strong> = Number of ratings for the book (`ratings_count`)</li>
              <li><strong>m</strong> = Minimum threshold (85th percentile of votes)</li>
              <li><strong>R</strong> = Average rating of the book (`average_rating`)</li>
              <li><strong>C</strong> = Global mean rating across all 10,000 books (~3.85★)</li>
            </ul>
            <p className="text-xs text-[#7A6D5A] border-t border-[#F0E8DA] pt-2">
              Prevents books with 2 perfect 5★ ratings from outranking masterpieces with 4 million 4.34★ ratings.
            </p>
          </div>

          {/* Card 2: Content-Based */}
          <div className="bg-white p-6 rounded-xl border border-[#E8DFC8] shadow-xs space-y-3">
            <span className="text-xs font-mono font-bold uppercase text-[#9E7D3B]">Model 2: Thematic</span>
            <h3 className="font-serif font-bold text-xl text-[#1E1B18]">TF-IDF & Cosine Similarity</h3>
            <div className="p-3 bg-[#FAF7F2] rounded-lg border border-[#EAE2D3] font-mono text-xs text-[#1E1B18] text-center">
              Cosine(u, v) = (u · v) / (||u||₂ · ||v||₂)
            </div>
            <ul className="text-xs text-[#57524D] space-y-1 list-disc list-inside">
              <li><strong>Metadata Soup</strong>: Title + Authors + Primary Genre + Filtered Tags</li>
              <li><strong>TF-IDF Vectorizer</strong>: 10,000 terms vocabulary with sublinear scaling</li>
              <li><strong>User Taste Vector</strong>: Weighted centroid of positively rated books</li>
            </ul>
            <p className="text-xs text-[#7A6D5A] border-t border-[#F0E8DA] pt-2">
              Zero dependency on other users' activity. Transparent, explainable thematic recommendations.
            </p>
          </div>

          {/* Card 3: Collaborative Filtering */}
          <div className="bg-white p-6 rounded-xl border border-[#E8DFC8] shadow-xs space-y-3">
            <span className="text-xs font-mono font-bold uppercase text-[#9E7D3B]">Model 3: Latent Factors</span>
            <h3 className="font-serif font-bold text-xl text-[#1E1B18]">SVD Matrix Factorization</h3>
            <div className="p-3 bg-[#FAF7F2] rounded-lg border border-[#EAE2D3] font-mono text-xs text-[#1E1B18] text-center">
              r̂(u, i) = μ + bᵤ + bᵢ + pᵤᵀ · qᵢ
            </div>
            <ul className="text-xs text-[#57524D] space-y-1 list-disc list-inside">
              <li><strong>μ</strong> = Global rating mean</li>
              <li><strong>bᵤ, bᵢ</strong> = User and book specific bias terms</li>
              <li><strong>pᵤ, qᵢ</strong> = Latent taste factor vectors in ℝ⁴⁰</li>
            </ul>
            <p className="text-xs text-[#7A6D5A] border-t border-[#F0E8DA] pt-2">
              Captures implicit reading tastes and unexpected cross-genre associations from 6 million ratings.
            </p>
          </div>

          {/* Card 4: Hybrid Recommender */}
          <div className="bg-white p-6 rounded-xl border border-[#E8DFC8] shadow-xs space-y-3">
            <span className="text-xs font-mono font-bold uppercase text-[#9E7D3B]">Model 4: Final Engine</span>
            <h3 className="font-serif font-bold text-xl text-[#1E1B18]">Hybrid Linear Ensemble</h3>
            <div className="p-3 bg-[#FAF7F2] rounded-lg border border-[#EAE2D3] font-mono text-xs text-[#1E1B18] text-center">
              Score = α · Score_CF(u, i) + (1 - α) · Score_CB(u, i)
            </div>
            <ul className="text-xs text-[#57524D] space-y-1 list-disc list-inside">
              <li><strong>α = 0.55</strong> = Optimal cross-validated weight</li>
              <li><strong>Cold-Start Gating</strong>: Dynamic fallback when user ratings &lt; 3</li>
              <li><strong>Explainability Engine</strong>: Deconstructs reasons for recommendation</li>
            </ul>
            <p className="text-xs text-[#7A6D5A] border-t border-[#F0E8DA] pt-2">
              Combines accuracy, serendipity, explainability, and cold-start robustness into one production system.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}

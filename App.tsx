
import React, { useState } from 'react';
import { Layout } from './components/Layout';
import { fetchBGGData } from './services/bggService';
import { generateBlogPost, researchGameWithAI } from './services/geminiService';
import { BGGGameData, GeneratedBlog, CreativeEntry } from './types';

const App: React.FC = () => {
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameData, setGameData] = useState<BGGGameData | null>(null);
  const [blogPost, setBlogPost] = useState<GeneratedBlog | null>(null);
  const [activeTab, setActiveTab] = useState<'articolo' | 'seo' | 'social' | 'schema'>('articolo');
  const [configTab, setConfigTab] = useState<'contenuti' | 'team' | 'info' | 'media'>('contenuti');
  const [copyStatus, setCopyStatus] = useState<{[key: string]: string}>({ html: 'Copia HTML', seo: 'Copia SEO', social: 'Copia Post', schema: 'Copia JSON-LD' });

  const [frogamesLink, setFrogamesLink] = useState('');
  const [publisherInfo, setPublisherInfo] = useState('');
  const [extraImages, setExtraImages] = useState('');
  const [enrichmentNotes, setEnrichmentNotes] = useState('');
  const [designers, setDesigners] = useState<CreativeEntry[]>([]);
  const [artists, setArtists] = useState<CreativeEntry[]>([]);

  const handleFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInput.trim()) return;
    setLoading(true); setError(null); setGameData(null); setBlogPost(null);
    try {
      const data = await fetchBGGData(searchInput);
      updateLocalData(data);
    } catch (bggErr) {
      try {
        const aiData = await researchGameWithAI(searchInput);
        updateLocalData(aiData);
      } catch (aiErr) {
        setError("Gioco non trovato. Prova con il nome inglese o un link BoardGameGeek.");
      }
    } finally { setLoading(false); }
  };

  const updateLocalData = (data: BGGGameData) => {
    setGameData(data);
    setPublisherInfo(data.publishers?.[0] || '');
    setDesigners(data.designers?.map(d => ({ name: d })) || []);
    setArtists(data.artists?.map(a => ({ name: a })) || []);
  };

  const handleGenerate = async () => {
    if (!gameData) return;
    setGenLoading(true); setError(null);
    try {
      const blog = await generateBlogPost(gameData, { 
        imageUrls: extraImages.split('\n').filter(i => i.trim()), 
        shopLink: frogamesLink, designers, artists, publisherInfo, enrichmentNotes
      });
      setBlogPost(blog);
      setActiveTab('articolo');
    } catch (err) {
      setError("Errore durante la generazione dell'analisi narrativa.");
    } finally { setGenLoading(false); }
  };

  const handleCopy = (type: 'html' | 'seo' | 'social' | 'schema', text: any) => {
    if (!text) return;
    const finalCopy = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
    navigator.clipboard.writeText(finalCopy);
    setCopyStatus(prev => ({ ...prev, [type]: 'Copiato!' }));
    setTimeout(() => setCopyStatus(prev => ({ ...prev, [type]: type === 'html' ? 'Copia HTML' : type === 'seo' ? 'Copia SEO' : type === 'social' ? 'Copia Post' : 'Copia JSON-LD' })), 2000);
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 pb-24">
        {error && (
          <div className="mb-8 bg-rose-50 border-2 border-rose-200 p-6 rounded-3xl text-rose-700 font-bold animate-in fade-in">
            {error}
          </div>
        )}

        <div className="grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-5 space-y-6">
            <section className="bg-slate-950 rounded-3xl p-8 shadow-2xl border-4 border-slate-900">
              <h3 className="text-indigo-400 font-black uppercase tracking-widest text-[10px] mb-6">1. Ricerca Gioco</h3>
              <form onSubmit={handleFetch} className="space-y-4">
                <input
                  type="text" placeholder="Nome gioco o link BGG..."
                  className="w-full bg-slate-900 text-white px-6 py-4 rounded-xl font-bold border-2 border-slate-800 focus:border-indigo-500 outline-none transition-all"
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                />
                <button type="submit" disabled={loading} className="w-full bg-indigo-600 text-white py-4 rounded-xl font-black uppercase text-xs hover:bg-indigo-500 transition-all flex items-center justify-center gap-3">
                  {loading ? <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div> : 'Recupera Dati'}
                </button>
              </form>
            </section>

            {gameData && (
              <section className="bg-white rounded-[2.5rem] border-4 border-slate-950 shadow-2xl overflow-hidden animate-in slide-in-from-left">
                <div className="bg-indigo-600 p-6 flex items-center gap-6 text-white border-b-4 border-slate-950">
                  <div className="flex-1 min-w-0">
                    <h2 className="font-black text-lg uppercase truncate">{gameData.name}</h2>
                    <p className="text-[10px] font-bold opacity-75 uppercase tracking-widest">{gameData.yearPublished} • {gameData.minPlayers}-{gameData.maxPlayers} Players</p>
                  </div>
                </div>

                <div className="p-8 space-y-6">
                  <div className="flex bg-slate-100 p-1 rounded-2xl">
                    <ConfigTab active={configTab === 'contenuti'} onClick={() => setConfigTab('contenuti')} label="✍️ Analisi" />
                    <ConfigTab active={configTab === 'team'} onClick={() => setConfigTab('team')} label="🎨 Team" />
                    <ConfigTab active={configTab === 'info'} onClick={() => setConfigTab('info')} label="📦 Info" />
                    <ConfigTab active={configTab === 'media'} onClick={() => setConfigTab('media')} label="🖼️ Link" />
                  </div>

                  {configTab === 'contenuti' && (
                    <div className="space-y-3">
                      <label className="text-[11px] font-black uppercase text-indigo-600 tracking-wider">Note Tecniche (Esempi e Conseguenze)</label>
                      <textarea 
                        rows={12} 
                        value={enrichmentNotes} 
                        onChange={(e)=>setEnrichmentNotes(e.target.value)} 
                        placeholder={`Inserisci dettagli reali per l'IA:
• Cosa succede se un giocatore sbaglia una mossa?
• Racconta un turno difficile o una scelta sofferta.
• Descrivi la tensione a metà partita.
• Cosa cambia tra la 1ª e la 5ª partita?`} 
                        className="w-full bg-slate-50 border-2 border-slate-200 rounded-2xl p-5 text-sm font-bold text-slate-900 focus:border-indigo-500 outline-none" 
                      />
                    </div>
                  )}

                  {configTab === 'team' && (
                    <div className="space-y-6">
                      <CreativeList label="Game Designers" list={designers} onUpdate={setDesigners} />
                      <CreativeList label="Artisti" list={artists} onUpdate={setArtists} />
                    </div>
                  )}

                  {configTab === 'info' && (
                    <div className="space-y-4">
                      <InputGroup label="Editore" value={publisherInfo} onChange={setPublisherInfo} placeholder="Casa editrice..." />
                    </div>
                  )}

                  {configTab === 'media' && (
                    <div className="space-y-4">
                      <InputGroup label="URL Frogames" value={frogamesLink} onChange={setFrogamesLink} placeholder="https://www.frogames.it/..." />
                      <textarea rows={3} value={extraImages} onChange={(e)=>setExtraImages(e.target.value)} placeholder="Immagini extra (URL per riga)" className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl p-4 text-xs font-bold text-slate-900 outline-none" />
                    </div>
                  )}

                  <button 
                    onClick={handleGenerate} 
                    disabled={genLoading} 
                    className="w-full bg-slate-950 text-white py-6 rounded-[2rem] font-black text-sm hover:bg-indigo-600 transition-all uppercase tracking-widest shadow-2xl flex items-center justify-center gap-4"
                  >
                    {genLoading ? <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div> : 'Genera Analisi (1200 parole)'}
                  </button>
                </div>
              </section>
            )}
          </div>

          <div className="lg:col-span-7">
            {blogPost ? (
              <div className="space-y-6">
                <div className="flex bg-white p-2 rounded-2xl shadow-xl border-4 border-slate-950 overflow-x-auto gap-2">
                  <TabBtn active={activeTab === 'articolo'} onClick={() => setActiveTab('articolo')} label="Analisi Narrativa" />
                  <TabBtn active={activeTab === 'seo'} onClick={() => setActiveTab('seo')} label="Dati SEO" />
                  <TabBtn active={activeTab === 'schema'} onClick={() => setActiveTab('schema')} label="Schema (Google)" />
                  <TabBtn active={activeTab === 'social'} onClick={() => setActiveTab('social')} label="Social" />
                </div>

                <div className="animate-in fade-in">
                  {activeTab === 'articolo' && (
                    <div className="bg-white rounded-[3.5rem] shadow-2xl border-4 border-slate-950 overflow-hidden">
                      <div className="bg-slate-950 px-10 py-5 flex justify-between items-center text-white font-black text-[10px] uppercase">
                        <span>Preview Contenuto</span>
                        <button onClick={() => handleCopy('html', blogPost.content)} className="bg-indigo-600 px-6 py-2 rounded-full">
                          {copyStatus.html}
                        </button>
                      </div>
                      <div className="p-10 md:p-20 blog-preview-area bg-white text-slate-900 max-h-[1200px] overflow-y-auto">
                        <h1 className="text-4xl md:text-5xl font-black mb-12 uppercase border-b-[12px] border-indigo-600 pb-12">{blogPost.title}</h1>
                        <div dangerouslySetInnerHTML={{ __html: blogPost.content || '' }} />
                      </div>
                    </div>
                  )}

                  {activeTab === 'schema' && (
                    <div className="bg-slate-950 rounded-[2.5rem] shadow-2xl p-12 border-4 border-slate-900">
                      <div className="bg-indigo-900/30 border border-indigo-500/50 p-6 rounded-2xl mb-8">
                        <p className="text-indigo-300 text-xs font-bold leading-relaxed">
                          ⚠️ <strong>NOTA:</strong> Questo codice è invisibile per i tuoi lettori. Va copiato e incollato nell'intestazione (header) del tuo sito. Serve a Google per mostrare il gioco nei risultati di ricerca in modo avanzato.
                        </p>
                      </div>
                      <div className="flex justify-between items-center mb-6">
                        <h4 className="font-black uppercase text-xl text-indigo-400">JSON-LD Structured Data</h4>
                        <button onClick={() => handleCopy('schema', blogPost.jsonLd)} className="bg-indigo-600 text-white px-6 py-2 rounded-full text-[10px] font-black uppercase">
                          {copyStatus.schema}
                        </button>
                      </div>
                      <pre className="bg-slate-900 text-green-400 p-8 rounded-2xl text-[11px] font-mono overflow-x-auto border border-slate-800 shadow-inner max-h-[600px]">
                        {typeof blogPost.jsonLd === 'string' ? blogPost.jsonLd : JSON.stringify(blogPost.jsonLd, null, 2)}
                      </pre>
                    </div>
                  )}

                  {activeTab === 'seo' && (
                    <div className="bg-white rounded-[2.5rem] shadow-2xl p-12 space-y-10 border-4 border-slate-950">
                      <div className="flex justify-between items-center">
                        <h4 className="font-black uppercase text-xl text-slate-900">Ottimizzazione Motori di Ricerca</h4>
                        <button onClick={() => handleCopy('seo', `Title: ${blogPost.seoTitle}\nDesc: ${blogPost.metaDescription}\nSlug: ${blogPost.slug}`)} className="bg-indigo-600 text-white px-6 py-2 rounded-full text-[10px] font-black uppercase">
                          {copyStatus.seo}
                        </button>
                      </div>
                      <SEODisplay label="Meta Title" value={blogPost.seoTitle} />
                      <SEODisplay label="Meta Description" value={blogPost.metaDescription} />
                      <SEODisplay label="URL Slug" value={blogPost.slug} />
                    </div>
                  )}

                  {activeTab === 'social' && (
                    <div className="bg-white rounded-[2.5rem] shadow-2xl p-12 border-4 border-slate-950">
                      <div className="flex justify-between items-center mb-8">
                        <h4 className="font-black uppercase text-xl text-slate-900">Copy Telegram / Social</h4>
                        <button onClick={() => handleCopy('social', blogPost.telegramPost)} className="bg-sky-500 text-white px-6 py-2 rounded-full text-[10px] font-black uppercase">
                          {copyStatus.social}
                        </button>
                      </div>
                      <div className="bg-slate-900 text-white p-10 rounded-3xl font-mono text-sm leading-relaxed whitespace-pre-wrap border-8 border-slate-800">
                        {blogPost.telegramPost || "Post non disponibile."}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : genLoading ? (
              <div className="bg-white rounded-[3.5rem] py-60 text-center shadow-2xl border-4 border-slate-950 flex flex-col items-center">
                <div className="w-20 h-20 border-[12px] border-indigo-600 border-t-transparent rounded-full animate-spin mb-10"></div>
                <h3 className="text-4xl font-black text-slate-900 uppercase italic px-10">Analisi Profonda (1200 parole)...</h3>
                <p className="text-slate-400 font-bold uppercase text-[10px] mt-4 tracking-widest">Eliminando le frasi vuote...</p>
              </div>
            ) : (
              <div className="bg-slate-100 rounded-[3.5rem] border-4 border-dashed border-slate-300 py-60 text-center">
                <p className="text-sm font-black uppercase text-slate-400 tracking-[0.4em]">In attesa del prossimo gioco</p>
              </div>
            )}
          </div>
        </div>
      </div>
      
      <style>{`
        .blog-preview-area h2 { font-size: 2.2rem; font-weight: 900; color: #0f172a; margin: 4.5rem 0 1.5rem; text-transform: uppercase; letter-spacing: -1.5px; line-height: 1.1; border-left: 8px solid #6366f1; padding-left: 1.2rem; }
        .blog-preview-area h3 { font-size: 1.4rem; font-weight: 800; color: #1e293b; margin: 2rem 0 1rem; text-transform: uppercase; }
        .blog-preview-area p { font-size: 1.15rem; line-height: 1.85; color: #334155; margin-bottom: 2rem; text-align: justify; }
        .blog-preview-area ul { list-style: disc; padding-left: 2rem; margin-bottom: 2rem; }
        .blog-preview-area li { font-size: 1.1rem; color: #334155; margin-bottom: 0.8rem; }
        .blog-preview-area .final-cta { text-align: center; padding: 4.5rem 3rem; background: #6366f1; border-radius: 3rem; margin: 5.5rem 0; color: white; font-size: 1.4rem; font-weight: 900; }
        .blog-preview-area .final-cta a { display: inline-block; margin-top: 1.5rem; background: white; color: #6366f1 !important; padding: 1.3rem 3.5rem; border-radius: 1rem; font-weight: 900; text-decoration: none; text-transform: uppercase; font-size: 1.05rem; }
        .blog-preview-area strong { color: #0f172a; font-weight: 800; }
      `}</style>
    </Layout>
  );
};

const CreativeList = ({ label, list, onUpdate }: any) => {
  const add = () => onUpdate([...list, { name: '' }]);
  const remove = (i: number) => onUpdate(list.filter((_:any,idx:number)=>idx!==i));
  const edit = (i: number, val: string) => {
    const n = [...list]; n[i].name = val; onUpdate(n);
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center"><label className="text-[11px] font-black uppercase text-indigo-600 tracking-wider">{label}</label><button onClick={add} className="text-[9px] font-black bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full">+ AGGIUNGI</button></div>
      {list.map((it:any, i:number)=>(
        <div key={i} className="flex gap-2">
          <input value={it.name} onChange={(e)=>edit(i, e.target.value)} className="flex-1 bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:border-indigo-500 outline-none transition-all shadow-sm" />
          <button onClick={()=>remove(i)} className="bg-rose-50 text-rose-600 px-4 rounded-xl font-bold">×</button>
        </div>
      ))}
    </div>
  );
};

const ConfigTab = ({ active, onClick, label }: any) => (
  <button onClick={onClick} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-tighter transition-all ${active ? 'bg-white text-slate-950 shadow-md rounded-xl scale-105' : 'text-slate-500 hover:text-slate-800'}`}>
    {label}
  </button>
);

const InputGroup = ({ label, value, onChange, placeholder }: any) => (
  <div className="space-y-1">
    <label className="text-[10px] font-black uppercase text-slate-500 ml-1">{label}</label>
    <input value={value} onChange={(e)=>onChange(e.target.value)} placeholder={placeholder} className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-5 py-4 text-sm font-bold text-slate-900 focus:border-indigo-500 outline-none transition-all shadow-sm" />
  </div>
);

const TabBtn = ({ active, onClick, label }: any) => (
  <button onClick={onClick} className={`flex-1 py-4 px-6 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${active ? 'bg-slate-950 text-white shadow-xl scale-[1.02]' : 'text-slate-400 hover:bg-slate-50'}`}>
    {label}
  </button>
);

const SEODisplay = ({ label, value }: any) => (
  <div className="space-y-2">
    <span className="text-[10px] font-black text-indigo-600 uppercase block ml-1">{label}</span>
    <div className="bg-slate-50 border-2 border-slate-200 p-6 rounded-2xl font-bold text-slate-900 text-sm shadow-inner min-h-[3rem] flex items-center">
      {value || "..."}
    </div>
  </div>
);

export default App;


import { GoogleGenAI, Type } from "@google/genai";
import { BGGGameData, OptionalLinks, GeneratedBlog } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const BLOG_STRATEGY = `
SEI UN ANALISTA TECNICO DI GIOCHI DA TAVOLO. La tua missione è scrivere un'analisi narrativa profonda. 
NON stai scrivendo marketing, NON stai scrivendo una biografia, NON stai vendendo nulla.
Il lettore deve finire l'articolo capendo COME si gioca, PERCHÉ è interessante e COSA lo rende unico.

REGOLE NON NEGOZIABILI:
1. NIENTE FRASI VUOTE: Vietato usare "straordinario", "rivoluzionario", "fondamentale" o "importante" senza un esempio concreto (es. "Se occupi quello spazio, blocchi l'accesso alle risorse vitali per il prossimo turno del giocatore alla tua sinistra").
2. SPIEGA LE CONSEGUENZE: Ogni regola descritta deve mostrare il suo effetto al tavolo. Non dire "è un piazzamento lavoratori", dì "occupare questa zona impedisce agli altri di nutrirsi, costringendoli a perdere punti vittoria".
3. SCENA DI PARTITA REALE: Racconta una decisione concreta: "Sei al terzo round, la riserva è quasi vuota e devi scegliere se rischiare l'attacco o accumulare risorse...".
4. TONO ANALITICO: Documentario tecnico. Niente tono da Wikipedia.
5. DENSITÀ: Ogni paragrafo deve rispondere a: Cosa succede? Perché conta? Cosa cambia nella partita?
6. LUNGHEZZA: Minimo 900-1200 parole dense di contenuto. Niente riempitivi.

STRUTTURA OBBLIGATORIA (H2):
- <h2>Cos’è [Nome Gioco]</h2>: Definizione chiara + tipo di gioco + identità.
- <h2>Da dove nasce il gioco</h2>: Origine progettuale, idea degli autori, perché è stato creato.
- <h2>Il cuore del sistema</h2>: Meccaniche spiegate attraverso le loro conseguenze reali al tavolo.
- <h2>Un turno tipo</h2>: Descrizione di una decisione concreta e sofferta durante una partita.
- <h2>Cosa lo rende diverso</h2>: Confronto tecnico con titoli simili.
- <h2>Esperienza al tavolo</h2>: Tensione, interazione, ritmo e sensazioni dei giocatori.
- <h2>Curva di apprendimento</h2>: Analisi onesta tra prima partita e livello esperto.
- <h2>Per chi è questo gioco</h2>: Target reale, onesto e senza filtri.
- <h2>FAQ</h2>: Solo domande verificabili e utili.
- <h2>Chiusura</h2>: Sintesi tecnica e invito all’azione.
`;

const cleanJsonResponse = (text: string | undefined): string => {
  if (!text) return "{}";
  let cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1) return cleaned.substring(start, end + 1);
  return cleaned;
};

export const researchGameWithAI = async (idOrUrl: string): Promise<BGGGameData> => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `Analisi professionale dati gioco da tavolo: ${idOrUrl}. 
    Cerca su Google Search i dati ufficiali. Restituisci SOLO un JSON con questi campi esatti (camelCase): 
    id, name, description, yearPublished, minPlayers, maxPlayers, playingTime, designers (array), artists (array), publishers (array), mechanics (array). 
    Sii preciso su nomi di autori e editori.`,
    config: { tools: [{ googleSearch: {} }], responseMimeType: "application/json" }
  });
  const data = JSON.parse(cleanJsonResponse(response.text));
  return {
    ...data,
    image: '',
    thumbnail: '',
    minAge: '14',
    categories: [],
    rank: 'N/A',
    averageRating: '0',
    comments: []
  };
};

export const generateBlogPost = async (data: BGGGameData, extras: OptionalLinks): Promise<GeneratedBlog> => {
  const publisher = extras.publisherInfo || (data.publishers && data.publishers[0]) || "Non specificato";
  const designers = extras.designers.length > 0 ? extras.designers.map(d => d.name).join(', ') : (data.designers ? data.designers.join(', ') : "Autore Ignoto");
  const artists = extras.artists.length > 0 ? extras.artists.map(a => a.name).join(', ') : (data.artists ? data.artists.join(', ') : "Artista Ignoto");
  
  const prompt = `
    SCRIVI UN'ANALISI NARRATIVA PROFONDA DI 1200 PAROLE sul gioco: "${data.name}".
    
    ${BLOG_STRATEGY}

    DATI TECNICI:
    - Editore: ${publisher}
    - Autori: ${designers}
    - Artisti: ${artists}
    - Giocatori: ${data.minPlayers}-${data.maxPlayers}
    - Durata: ${data.playingTime} min
    - Meccaniche: ${data.mechanics ? data.mechanics.join(', ') : "Strategia"}

    NOTE DALL'AUTORE (Scene di partita):
    "${extras.enrichmentNotes || 'Descrivi la tensione e le scelte difficili.'}"

    LINK SHOP: ${extras.shopLink || 'https://www.frogames.it/'}

    Ritorna JSON con: title, slug, seoTitle, metaDescription, excerpt, content (HTML denso), telegramPost, jsonLd.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: prompt,
    config: { 
      tools: [{ googleSearch: {} }], 
      responseMimeType: "application/json"
    }
  });

  return JSON.parse(cleanJsonResponse(response.text));
};

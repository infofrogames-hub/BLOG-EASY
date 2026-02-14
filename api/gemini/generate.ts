// api/gemini/generate.ts (SERVER - Vercel)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenerativeAI } from "@google/generative-ai";

const BLOG_STRATEGY = `
SEI UN ANALISTA TECNICO DI GIOCHI DA TAVOLO. La tua missione è scrivere un'analisi narrativa profonda. 
NON stai scrivendo marketing, NON stai scrivendo una biografia, NON stai vendendo nulla.
Il lettore deve finire l'articolo capendo COME si gioca, PERCHÉ è interessante e COSA lo rende unico.

REGOLE NON NEGOZIABILI:
1. NIENTE FRASI VUOTE: Vietato usare "straordinario", "rivoluzionario", "fondamentale" o "importante" senza un esempio concreto.
2. SPIEGA LE CONSEGUENZE: Ogni regola descritta deve mostrare il suo effetto al tavolo.
3. SCENA DI PARTITA REALE: Racconta una decisione concreta.
4. TONO ANALITICO: Documentario tecnico. Niente tono da Wikipedia.
5. DENSITÀ: Ogni paragrafo deve rispondere a: Cosa succede? Perché conta? Cosa cambia nella partita?
6. LUNGHEZZA: Minimo 900-1200 parole dense di contenuto. Niente riempitivi.

STRUTTURA OBBLIGATORIA (H2):
- <h2>Cos’è [Nome Gioco]</h2>
- <h2>Da dove nasce il gioco</h2>
- <h2>Il cuore del sistema</h2>
- <h2>Un turno tipo</h2>
- <h2>Cosa lo rende diverso</h2>
- <h2>Esperienza al tavolo</h2>
- <h2>Curva di apprendimento</h2>
- <h2>Per chi è questo gioco</h2>
- <h2>FAQ</h2>
- <h2>Chiusura</h2>
`;

const cleanJsonResponse = (text: string | undefined): string => {
  if (!text) return "{}";
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1) return cleaned.substring(start, end + 1);
  return cleaned;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    const { data, extras } = (req.body ?? {}) as any;
    if (!data || !extras) return res.status(400).json({ error: "Missing data/extras" });

    const publisher = extras.publisherInfo || (data.publishers && data.publishers[0]) || "Non specificato";
    const designers =
      extras.designers?.length > 0
        ? extras.designers.map((d: any) => d.name).join(", ")
        : (data.designers ? data.designers.join(", ") : "Autore Ignoto");
    const artists =
      extras.artists?.length > 0
        ? extras.artists.map((a: any) => a.name).join(", ")
        : (data.artists ? data.artists.join(", ") : "Artista Ignoto");

    const prompt = `
SCRIVI UN'ANALISI NARRATIVA PROFONDA DI 1200 PAROLE sul gioco: "${data.name}".

${BLOG_STRATEGY}

DATI TECNICI:
- Editore: ${publisher}
- Autori: ${designers}
- Artisti: ${artists}
- Giocatori: ${data.minPlayers}-${data.maxPlayers}
- Durata: ${data.playingTime} min
- Meccaniche: ${data.mechanics ? data.mechanics.join(", ") : "Strategia"}

NOTE DALL'AUTORE (Scene di partita):
"${extras.enrichmentNotes || "Descrivi la tensione e le scelte difficili."}"

LINK SHOP: ${extras.shopLink || "https://www.frogames.it/"}

Ritorna JSON con: title, slug, seoTitle, metaDescription, excerpt, content (HTML denso), telegramPost, jsonLd.
`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const out = JSON.parse(cleanJsonResponse(text));
    return res.status(200).json(out);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
}

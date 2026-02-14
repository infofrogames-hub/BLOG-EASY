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

// --- Helpers robusti (JSON) ---
// 1) prova a usare direttamente JSON puro (con responseMimeType)
// 2) se Gemini ti risponde con testo "sporco", estrai la prima { ... } bilanciata

function stripCodeFences(s: string) {
  return s.replace(/```json/gi, "").replace(/```/g, "").trim();
}

function extractFirstJsonObject(text: string): string | null {
  const cleaned = stripCodeFences(text);
  const start = cleaned.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) return cleaned.slice(start, i + 1);
  }
  return null;
}

function safeParseJson(text: string) {
  try {
    return { ok: true as const, value: JSON.parse(text) };
  } catch (e: any) {
    return { ok: false as const, error: e?.message ?? "JSON.parse error" };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    const { data, extras } = (req.body ?? {}) as any;
    if (!data || !extras) return res.status(400).json({ error: "Missing data/extras" });

    if (!data?.name) return res.status(400).json({ error: "Missing data.name" });

    const publisher =
      extras.publisherInfo || (data.publishers && data.publishers[0]) || "Non specificato";

    const designers =
      extras.designers?.length > 0
        ? extras.designers.map((d: any) => d.name).join(", ")
        : data.designers
          ? data.designers.join(", ")
          : "Autore Ignoto";

    const artists =
      extras.artists?.length > 0
        ? extras.artists.map((a: any) => a.name).join(", ")
        : data.artists
          ? data.artists.join(", ")
          : "Artista Ignoto";

    const shopLink = extras.shopLink || "https://www.frogames.it/";
    const enrichmentNotes = extras.enrichmentNotes || "Descrivi la tensione e le scelte difficili.";

    const prompt = `RISPOSTA: restituisci SOLO JSON valido. Niente testo, niente markdown, niente commenti.
Se un dato è sconosciuto, usa stringa vuota "" o array [].

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
"${enrichmentNotes}"

LINK SHOP: ${shopLink}

Ritorna JSON con: title, slug, seoTitle, metaDescription, excerpt, content (HTML denso), telegramPost, jsonLd.
`;

    const genAI = new GoogleGenerativeAI(apiKey);

    // ✅ FIX: forziamo risposta JSON "vera" + riduciamo variabilità
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 6000,
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // 1) prova parse diretto
    const direct = safeParseJson(text);
    if (direct.ok) return res.status(200).json(direct.value);

    // 2) fallback: estrai il primo oggetto JSON bilanciato
    const raw = extractFirstJsonObject(text);
    if (!raw) {
      return res.status(500).json({
        error: `Gemini returned non-JSON output: ${direct.error}`,
        hint: "Se persiste, passa a 'struttura->render HTML lato server' (soluzione definitiva).",
        debug: { rawFirst2000: text.slice(0, 2000) },
      });
    }

    const extracted = safeParseJson(raw);
    if (!extracted.ok) {
      return res.status(500).json({
        error: `JSON.parse failed: ${extracted.error}`,
        hint:
          "Gemini ha prodotto JSON non valido (tipico: virgolette non escapate dentro content). " +
          "Con responseMimeType di solito si risolve; se persiste, passa a 'struttura->render HTML lato server'.",
        debug: {
          rawFirst4000: text.slice(0, 4000),
          extractedFirst4000: raw.slice(0, 4000),
        },
      });
    }

    return res.status(200).json(extracted.value);
  } catch (e: any) {
    console.error("GEMINI /generate ERROR:", e?.message, e?.stack);
    return res.status(500).json({
      error: e?.message ?? "Server error",
      hint:
        "Controlla GEMINI_API_KEY, body {data, extras}, e se vedi JSON.parse error è quasi sempre colpa di virgolette non escapate dentro content (HTML).",
    });
  }
}

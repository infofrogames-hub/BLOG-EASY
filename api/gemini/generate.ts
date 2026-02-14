// api/gemini/generate.ts (SERVER - Vercel)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ---------------- helpers ----------------

function stripCodeFences(s: string) {
  return String(s || "").replace(/```json/g, "").replace(/```/g, "").trim();
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

function clampLen(s: string, max: number) {
  const str = String(s || "");
  return str.length <= max ? str : str.slice(0, max - 1).trimEnd() + "…";
}

function slugify(input: string) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function htmlEscape(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function ensureArray(x: any) {
  return Array.isArray(x) ? x : [];
}

function isNonEmptyString(x: any) {
  return typeof x === "string" && x.trim().length > 0;
}

// ---------------- HTML renderer (struttura bloccata) ----------------
// QUI è dove “Gemini non ti impiccia”: l’HTML lo fai TU, sempre uguale.
function renderHtml(draft: any, shopLink: string) {
  const sections = ensureArray(draft?.sections);

  const toc = sections
    .map((s: any) => `<a class="fg-toc__a" href="#${htmlEscape(s.id)}">${htmlEscape(s.h2)}</a>`)
    .join("");

  const sectionsHtml = sections
    .map((s: any) => {
      const paras = ensureArray(s?.paragraphs)
        .filter((p: any) => isNonEmptyString(p))
        .map((p: string) => `<p>${htmlEscape(p)}</p>`)
        .join("");

      return `
        <section id="${htmlEscape(s.id)}" class="fg-sec">
          <h2>${htmlEscape(s.h2)}</h2>
          ${s.hook ? `<p><em>${htmlEscape(s.hook)}</em></p>` : ""}
          ${paras}
        </section>
      `;
    })
    .join("");

  const ctaUrl = (draft?.shopLink || shopLink) as string;

  return `
<article class="fg-blog">
  <style>
    .fg-blog{font-family:inherit;line-height:1.75;max-width:900px;margin:0 auto;padding:16px}
    .fg-hero{border:1px solid rgba(0,0,0,.12);border-radius:16px;padding:14px;margin-bottom:16px}
    .fg-kicker{opacity:.8;font-size:.95rem}
    .fg-title{margin:.2rem 0 .4rem;font-size:1.85rem;line-height:1.15}
    .fg-excerpt{margin:0}
    .fg-btn{display:inline-block;margin-top:10px;padding:10px 14px;border-radius:12px;border:1px solid rgba(0,0,0,.18);text-decoration:none;font-weight:800}
    .fg-toc{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 18px}
    .fg-toc__a{font-size:.92rem;text-decoration:none;border:1px solid rgba(0,0,0,.14);padding:6px 10px;border-radius:999px}
    .fg-sec{margin:18px 0}
    .fg-sec h2{margin:0 0 8px;font-size:1.35rem}
    .fg-sec p{margin:.65rem 0}
  </style>

  <header class="fg-hero">
    <div class="fg-kicker">Blog FroGames • Analisi narrativa (struttura bloccata)</div>
    <h1 class="fg-title">${htmlEscape(draft?.title || "")}</h1>
    <p class="fg-excerpt">${htmlEscape(draft?.excerpt || "")}</p>
    <a class="fg-btn" href="${htmlEscape(ctaUrl)}" rel="nofollow">Scoprilo su FroGames</a>
  </header>

  <nav class="fg-toc" aria-label="Indice">${toc}</nav>

  ${sectionsHtml}

  <footer class="fg-sec">
    <a class="fg-btn" href="${htmlEscape(shopLink)}" rel="nofollow">Vai allo shop FroGames</a>
  </footer>
</article>
`.trim();
}

// ---------------- main handler ----------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    const { data, extras } = (req.body ?? {}) as any;
    if (!data || !extras) return res.status(400).json({ error: "Missing data/extras" });

    const GAME_NAME = String(data.name || "").trim();
    if (!GAME_NAME) return res.status(400).json({ error: "Missing data.name" });

    const shopLink = extras.shopLink || "https://www.frogames.it/";
    const publisher = extras.publisherInfo || (data.publishers && data.publishers[0]) || "";
    const designers =
      extras.designers?.length > 0
        ? extras.designers.map((d: any) => d.name).join(", ")
        : (data.designers ? data.designers.join(", ") : "");
    const artists =
      extras.artists?.length > 0
        ? extras.artists.map((a: any) => a.name).join(", ")
        : (data.artists ? data.artists.join(", ") : "");

    const notes = String(extras.enrichmentNotes || "").trim();

    // ✅ Prompt: Gemini deve restituire SOLO JSON (niente HTML).
    // ✅ Struttura bloccata via sections[] con id fissi.
    const prompt = `
RISPOSTA: restituisci SOLO JSON valido. Niente markdown, niente commenti.
Se non sai qualcosa: usa "" o [].
NON inventare dettagli “specifici” (scalabilità, “in due funziona”, ecc.) se non sono nei DATI/NOTE.

OBIETTIVO:
Scrivi un'analisi narrativa densa (900–1200 parole) in stile documentario tecnico.
Ogni paragrafo: cosa succede? perché conta? cosa cambia al tavolo?

DATI:
- Gioco: "${GAME_NAME}"
- Editore: ${publisher}
- Autori: ${designers}
- Artisti: ${artists}
- Giocatori: ${data.minPlayers}-${data.maxPlayers}
- Durata: ${data.playingTime} min
- Meccaniche: ${data.mechanics ? data.mechanics.join(", ") : ""}

NOTE (se presenti, usale come “spinta” per esempi/scena):
"""${notes}"""

OUTPUT JSON (campi obbligatori):
{
  "title": string,
  "slug": string,
  "seoTitle": string,          // <= 70, usa “–” e MAI “:”
  "metaDescription": string,   // <= 160
  "excerpt": string,           // 1–2 frasi
  "telegramPost": string,
  "jsonLd": object | null,
  "sections": [
    { "id":"cos-e", "h2":"Cos’è ${GAME_NAME}", "hook":string, "paragraphs":[string,...] },
    { "id":"origine", "h2":"Da dove nasce il gioco", "hook":string, "paragraphs":[string,...] },
    { "id":"cuore", "h2":"Il cuore del sistema", "hook":string, "paragraphs":[string,...] },
    { "id":"turno-tipo", "h2":"Un turno tipo", "hook":string, "paragraphs":[string,...] },
    { "id":"diverso", "h2":"Cosa lo rende diverso", "hook":string, "paragraphs":[string,...] },
    { "id":"tavolo", "h2":"Esperienza al tavolo", "hook":string, "paragraphs":[string,...] },
    { "id":"curva", "h2":"Curva di apprendimento", "hook":string, "paragraphs":[string,...] },
    { "id":"target", "h2":"Per chi è questo gioco", "hook":string, "paragraphs":[string,...] },
    { "id":"faq", "h2":"FAQ", "hook":string, "paragraphs":[string,...] },
    { "id":"chiusura", "h2":"Chiusura", "hook":string, "paragraphs":[string,...] }
  ]
}

REGOLE SEO:
- seoTitle <= 70, metaDescription <= 160
- Inserisci naturalmente “gioco da tavolo” 1 volta in excerpt o nella prima sezione.

NON scrivere HTML.
`.trim();

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
      generationConfig: {
        temperature: 0.35,
        topP: 0.9,
        maxOutputTokens: 7000,
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const rawJson = extractFirstJsonObject(text) ?? stripCodeFences(text);
    const parsed = JSON.parse(rawJson);

    // ✅ clamp & normalize SEO
    parsed.title = parsed.title || GAME_NAME;
    parsed.slug = parsed.slug || slugify(parsed.title);
    parsed.seoTitle = clampLen(String(parsed.seoTitle || parsed.title).replace(/:/g, "–"), 70);
    parsed.metaDescription = clampLen(String(parsed.metaDescription || parsed.excerpt || ""), 160);

    // ✅ server-side HTML (struttura fissa)
    const html = renderHtml({ ...parsed, shopLink }, shopLink);

    return res.status(200).json({
      ...parsed,
      contentHtml: html,
      debug: { model: "gemini-2.5-pro" },
    });
  } catch (e: any) {
    console.error("GEMINI /generate ERROR:", e?.message, e?.stack);
    return res.status(500).json({
      error: e?.message ?? "Server error",
      hint: "Se vedi JSON.parse error: aggiungi log raw output o abbassa temperature. Se manca data.name: controlla il body.",
    });
  }
}

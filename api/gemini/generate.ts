// api/gemini/generate.ts (SERVER - Vercel)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ----------------- CONFIG -----------------

const BLOG_STRATEGY = `
SEI UN ANALISTA TECNICO DI GIOCHI DA TAVOLO. La tua missione è scrivere un'analisi narrativa profonda.
NON stai scrivendo marketing, NON stai scrivendo una biografia, NON stai vendendo nulla.
Il lettore deve finire l'articolo capendo COME si gioca, PERCHÉ è interessante e COSA lo rende unico.

REGOLE NON NEGOZIABILI:
1) NIENTE FRASI VUOTE: vietato usare parole tipo "straordinario" senza esempio concreto.
2) SPIEGA LE CONSEGUENZE: ogni regola descritta deve mostrare l'effetto al tavolo.
3) SCENA DI PARTITA REALE: racconta una decisione concreta con dilemma.
4) TONO ANALITICO: documentario tecnico, niente Wikipedia.
5) DENSITÀ: ogni paragrafo risponde a: cosa succede? perché conta? cosa cambia in partita?

IMPORTANTISSIMO:
- Output SOLO JSON valido.
- NON produrre HTML nel JSON.
- NON aggiungere testo fuori dal JSON.
`;

// ----------------- HELPERS (JSON safe) -----------------

function stripCodeFences(s: string) {
  return String(s || "").replace(/```json/gi, "").replace(/```/g, "").trim();
}

// Estrae il primo oggetto JSON bilanciando graffe (robusto anche se c’è testo prima/dopo)
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
  return null; // troncato => non trova chiusura
}

function safeParseJson(raw: string) {
  try {
    return { ok: true as const, value: JSON.parse(raw) };
  } catch (e: any) {
    return { ok: false as const, error: e?.message ?? "JSON.parse error" };
  }
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

function clampLen(s: string, max: number) {
  const str = String(s || "");
  if (!str) return "";
  return str.length <= max ? str : str.slice(0, max - 1).trimEnd() + "…";
}

function htmlEscape(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ----------------- HTML RENDERER (structure locked) -----------------

function renderHtml(draft: any, shopLink: string) {
  const title = draft?.title || "";
  const excerpt = draft?.excerpt || "";
  const sections = Array.isArray(draft?.sections) ? draft.sections : [];
  const faq = Array.isArray(draft?.faq) ? draft.faq : [];

  const toc = sections
    .filter((s: any) => s?.id && s?.h2)
    .map((s: any) => `<a class="fg-toc__a" href="#${htmlEscape(s.id)}">${htmlEscape(s.h2)}</a>`)
    .join("");

  const heroCtaUrl =
    (draft?.ctas || []).find((c: any) => c?.placement === "hero")?.url || shopLink;

  const sectionsHtml = sections
    .map((s: any, idx: number) => {
      const openAttr = idx === 0 ? " open" : "";
      const paras = (Array.isArray(s?.paragraphs) ? s.paragraphs : [])
        .filter((p: any) => typeof p === "string" && p.trim())
        .map((p: string) => `<p>${htmlEscape(p)}</p>`)
        .join("");

      const faqHtml =
        s?.id === "faq" && faq.length
          ? `<div class="fg-faq">
              ${faq
                .slice(0, 8)
                .filter((f: any) => f?.q && f?.a)
                .map(
                  (f: any) => `
                  <details class="fg-faq__item">
                    <summary class="fg-faq__q">${htmlEscape(f.q)}</summary>
                    <div class="fg-faq__a"><p>${htmlEscape(f.a)}</p></div>
                  </details>`
                )
                .join("")}
            </div>`
          : "";

      return `
<section id="${htmlEscape(s.id)}" class="fg-sec">
  <details class="fg-acc"${openAttr}>
    <summary class="fg-acc__sum">
      <span class="fg-acc__h2">${htmlEscape(s.h2 || "")}</span>
      <span class="fg-acc__hook">${htmlEscape(s.hook || "")}</span>
    </summary>
    <div class="fg-acc__body">
      ${paras}
      ${faqHtml}
    </div>
  </details>
</section>
      `.trim();
    })
    .join("\n");

  return `
<article class="fg-blog">
  <style>
    .fg-blog{font-family:inherit;line-height:1.7;max-width:900px;margin:0 auto;padding:16px}
    .fg-hero{border:1px solid rgba(0,0,0,.12);border-radius:16px;padding:14px;margin-bottom:16px}
    .fg-kicker{opacity:.8;font-size:.95rem}
    .fg-title{margin:.2rem 0 .4rem;font-size:1.7rem;line-height:1.2}
    .fg-excerpt{margin:0}
    .fg-btn{display:inline-block;margin-top:10px;padding:10px 14px;border-radius:12px;border:1px solid rgba(0,0,0,.18);text-decoration:none;font-weight:800}
    .fg-toc{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 18px}
    .fg-toc__a{font-size:.92rem;text-decoration:none;border:1px solid rgba(0,0,0,.14);padding:6px 10px;border-radius:999px}
    .fg-sec{margin:12px 0}
    .fg-acc{border:1px solid rgba(0,0,0,.12);border-radius:14px;overflow:hidden}
    .fg-acc__sum{cursor:pointer;padding:12px 12px;list-style:none}
    .fg-acc__sum::-webkit-details-marker{display:none}
    .fg-acc__h2{display:block;font-weight:900}
    .fg-acc__hook{display:block;opacity:.85;margin-top:4px}
    .fg-acc__body{padding:0 12px 12px}
    .fg-faq{margin-top:10px}
    .fg-faq__item{border:1px solid rgba(0,0,0,.12);border-radius:14px;padding:10px 12px;margin:10px 0}
    .fg-faq__q{cursor:pointer;font-weight:900}
    .fg-faq__a p{margin:.6rem 0 0}
  </style>

  <header class="fg-hero">
    <div class="fg-kicker">Blog FroGames • Mini-documentario da tavolo</div>
    <h1 class="fg-title">${htmlEscape(title)}</h1>
    <p class="fg-excerpt">${htmlEscape(excerpt)}</p>
    <a class="fg-btn" href="${htmlEscape(heroCtaUrl)}" rel="nofollow">Scoprilo su FroGames</a>
  </header>

  <nav class="fg-toc" aria-label="Indice">${toc}</nav>

  ${sectionsHtml}

  <footer class="fg-sec">
    <a class="fg-btn" href="${htmlEscape(shopLink)}" rel="nofollow">Vai allo shop FroGames</a>
  </footer>
</article>
  `.trim();
}

// ----------------- GEMINI CALL (with retry) -----------------

async function callGeminiJson(genAI: GoogleGenerativeAI, prompt: string) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-pro",
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 8000,
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent(prompt);
  return result.response.text();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    const { data, extras } = (req.body ?? {}) as any;
    if (!data || !extras) return res.status(400).json({ error: "Missing data/extras" });
    if (!data?.name) return res.status(400).json({ error: "Missing data.name" });

    const shopLink = extras.shopLink || "https://www.frogames.it/";
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

    // Prompt con LIMITI anti-troncamento
    const basePrompt = `
${BLOG_STRATEGY}

GIOCO: "${data.name}"

DATI TECNICI (contesto, non inventare oltre):
- Editore: ${publisher}
- Autori: ${designers}
- Artisti: ${artists}
- Giocatori: ${data.minPlayers}-${data.maxPlayers}
- Durata: ${data.playingTime} min
- Meccaniche: ${data.mechanics ? data.mechanics.join(", ") : "Strategia"}

NOTE (per scena di partita):
"${extras.enrichmentNotes || "Descrivi tensione e scelte difficili. Non inventare facts specifici non forniti."}"

OBIETTIVO:
Genera SOLO JSON valido con questo schema (Niente HTML!):

{
  "title": string,
  "slug": string,
  "seoTitle": string (<=70, usa “–” mai “:”),
  "metaDescription": string (<=160),
  "excerpt": string (1-2 frasi),
  "sections": [
    {
      "id": "hero"|"origin"|"system"|"turn"|"different"|"table"|"learning"|"target"|"faq"|"closing",
      "h2": string,
      "hook": string (1 frase breve),
      "paragraphs": string[] (paragrafi brevi)
    }
  ],
  "faq": [{ "q": string, "a": string }] (0-8, SOLO se sei sicuro; altrimenti []),
  "ctas": [
    { "label": "Scoprilo su FroGames", "url": "${shopLink}", "placement": "hero" },
    { "label": "Vai allo shop FroGames", "url": "${shopLink}", "placement": "closing" }
  ]
}

LIMITI PER EVITARE OUTPUT TRONCATO:
- sections deve essere ESATTAMENTE 10 elementi (uno per id, nell’ordine sopra).
- Ogni section.paragraphs: 2–4 paragrafi massimo.
- Ogni paragrafo: massimo ~350 caratteri.
- FAQ massimo 5.
- NON aggiungere testo fuori dal JSON.
    `.trim();

    const genAI = new GoogleGenerativeAI(apiKey);

    // 1) try
    let text = await callGeminiJson(genAI, basePrompt);

    // parse attempt: prova diretto, poi estratto
    const tryParse = (t: string) => {
      const direct = safeParseJson(stripCodeFences(t));
      if (direct.ok) return direct.value;

      const extracted = extractFirstJsonObject(t);
      if (!extracted) return null;

      const parsed = safeParseJson(extracted);
      return parsed.ok ? parsed.value : null;
    };

    let out = tryParse(text);

    // 2) retry una volta (più corto) se troncato/non-JSON
    if (!out) {
      const retryPrompt = basePrompt + `

SE IL JSON RISCHIA DI ESSERE TROPPO LUNGO:
- riduci a 2 paragrafi per sezione
- mantieni comunque 10 sezioni
- NON superare i limiti
- output SOLO JSON
`;
      text = await callGeminiJson(genAI, retryPrompt);
      out = tryParse(text);
    }

    if (!out) {
      return res.status(500).json({
        error: "Gemini returned non-JSON output (likely truncated).",
        hint: "Aumenta maxOutputTokens o riduci paragrafi per sezione. Nel dubbio: usa retry e limiti più stretti.",
        debug: { rawFirst2000: stripCodeFences(text).slice(0, 2000) },
      });
    }

    // clamps SEO
    out.title = out.title || data.name;
    out.slug = out.slug || slugify(out.title || data.name);
    out.seoTitle = clampLen(String(out.seoTitle || out.title).replace(/:/g, "–"), 70);
    out.metaDescription = clampLen(String(out.metaDescription || out.excerpt || ""), 160);

    // safety arrays
    if (!Array.isArray(out.sections)) out.sections = [];
    if (!Array.isArray(out.faq)) out.faq = [];
    if (!Array.isArray(out.ctas)) out.ctas = [];

    const contentHtml = renderHtml(out, shopLink);

    // ✅ COMPATIBILITÀ: molte UI vecchie leggono "content" e non "contentHtml"
    return res.status(200).json({
      ...out,
      content: contentHtml,   // <-- aggiunto: così la UI mostra subito
      contentHtml,            // <-- manteniamo anche il nuovo campo
      debug: { model: "gemini-2.5-pro" },
    });
  } catch (e: any) {
    console.error("GEMINI /generate ERROR:", e?.message, e?.stack);
    return res.status(500).json({
      error: e?.message ?? "Server error",
      hint: "Controlla GEMINI_API_KEY e body {data, extras}.",
    });
  }
}

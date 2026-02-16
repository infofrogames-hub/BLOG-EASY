// api/gemini/generate.ts (SERVER - Vercel)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { XMLParser } from "fast-xml-parser";

export const config = { runtime: "nodejs" };

// ----------------- CONFIG -----------------

const BLOG_STRATEGY = `
SEI UN ANALISTA TECNICO DI GIOCHI DA TAVOLO. Scrivi come mini-documentario: scene, scelte, conseguenze.
NON marketing. NON biografia. NON Wikipedia.

REGOLE NON NEGOZIABILI:
1) NIENTE FRASI VUOTE: vietato usare parole tipo "straordinario" senza esempio concreto.
2) SPIEGA LE CONSEGUENZE: ogni regola descritta deve mostrare l'effetto al tavolo.
3) SCENA DI PARTITA REALE: racconta una decisione concreta con dilemma.
4) TONO ANALITICO: denso, preciso, leggibile.
5) ANTI-INVENZIONI: se un dettaglio NON è nel RESEARCH, non lo dire.

IMPORTANTISSIMO:
- Output SOLO JSON valido.
- NON produrre HTML nel JSON.
- NON aggiungere testo fuori dal JSON.
`.trim();

// ----------------- HELPERS -----------------

function stripCodeFences(s: string) {
  return String(s || "").replace(/```json/gi, "").replace(/```/g, "").trim();
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

function buildBggHeaders() {
  // ✅ usa il nome variabile che hai davvero su Vercel
  const token = (process.env.GG_XML_API_TOKEN || "").trim();

  const headers: Record<string, string> = {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
    accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
  };

  if (token) headers.authorization = `Bearer ${token}`;
  return { headers, hasToken: !!token };
}

function stripHtml(html: string) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#10;/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toArray<T>(x: T | T[] | undefined | null): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function isNonEmptyString(x: any) {
  return typeof x === "string" && x.trim().length > 0;
}

function extractBggId(idOrUrl: string): string | null {
  const s = String(idOrUrl || "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return s;

  const m1 = s.match(/boardgame\/(\d+)/i);
  if (m1?.[1]) return m1[1];

  const m2 = s.match(/[?&]id=(\d+)/i);
  if (m2?.[1]) return m2[1];

  return null;
}

async function buildRawResearchFromBgg(idOrUrl: string) {
  const bggId = extractBggId(idOrUrl);
  if (!bggId) return null;

  const url = `https://boardgamegeek.com/xmlapi2/thing?id=${encodeURIComponent(bggId)}&stats=1`;
  const { headers, hasToken } = buildBggHeaders();

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20_000);

  try {
    const r = await fetch(url, { headers, signal: ac.signal });
    const xml = await r.text().catch(() => "");

    if (!r.ok) {
      return {
        ok: false as const,
        status: r.status,
        hasToken,
        bodyFirst300: xml.slice(0, 300),
      };
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
    });

    const parsed = parser.parse(xml);
    const item = parsed?.items?.item;
    if (!item) return null;

    const names = toArray(item.name);
    const primaryName =
      names.find((n: any) => n?.["@_type"] === "primary")?.["@_value"] ||
      names[0]?.["@_value"] ||
      "";

    const description = stripHtml(item.description || "");
    const yearPublished = String(item.yearpublished?.["@_value"] || "");
    const minPlayers = Number(item.minplayers?.["@_value"] || 0) || 0;
    const maxPlayers = Number(item.maxplayers?.["@_value"] || 0) || 0;
    const playingTime = Number(item.playingtime?.["@_value"] || 0) || 0;

    const links = toArray(item.link);

    const designers = links
      .filter((l: any) => l?.["@_type"] === "boardgamedesigner")
      .map((l: any) => l?.["@_value"])
      .filter(isNonEmptyString);

    const artists = links
      .filter((l: any) => l?.["@_type"] === "boardgameartist")
      .map((l: any) => l?.["@_value"])
      .filter(isNonEmptyString);

    const publishers = links
      .filter((l: any) => l?.["@_type"] === "boardgamepublisher")
      .map((l: any) => l?.["@_value"])
      .filter(isNonEmptyString);

    const mechanics = links
      .filter((l: any) => l?.["@_type"] === "boardgamemechanic")
      .map((l: any) => l?.["@_value"])
      .filter(isNonEmptyString);

    const rawResearchText = [
      `Titolo: ${primaryName}`,
      yearPublished ? `Anno: ${yearPublished}` : "",
      minPlayers && maxPlayers ? `Giocatori: ${minPlayers}-${maxPlayers}` : "",
      playingTime ? `Durata: ${playingTime} min` : "",
      publishers.length ? `Editore/i: ${publishers.join(", ")}` : "",
      designers.length ? `Autore/i: ${designers.join(", ")}` : "",
      artists.length ? `Artista/i: ${artists.join(", ")}` : "",
      mechanics.length ? `Meccaniche: ${mechanics.join(", ")}` : "",
      description ? `Descrizione: ${description}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 20000);

    return {
      ok: true as const,
      bggId,
      primaryName,
      yearPublished,
      minPlayers,
      maxPlayers,
      playingTime,
      designers,
      artists,
      publishers,
      mechanics,
      rawResearchText,
    };
  } finally {
    clearTimeout(t);
  }
}

// ----------------- HTML RENDERER -----------------

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
                .slice(0, 6)
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
    .fg-blog{font-family:inherit;line-height:1.7;max-width:920px;margin:0 auto;padding:18px}
    .fg-hero{border:1px solid rgba(0,0,0,.10);border-radius:18px;padding:16px 16px 14px;margin-bottom:16px;background:rgba(0,0,0,.02)}
    .fg-kicker{opacity:.8;font-size:.92rem;letter-spacing:.2px}
    .fg-title{margin:.25rem 0 .5rem;font-size:1.75rem;line-height:1.18}
    .fg-excerpt{margin:.1rem 0 0}
    .fg-btn{display:inline-block;margin-top:12px;padding:10px 14px;border-radius:12px;border:1px solid rgba(0,0,0,.16);text-decoration:none;font-weight:900}
    .fg-toc{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 18px}
    .fg-toc__a{font-size:.92rem;text-decoration:none;border:1px solid rgba(0,0,0,.14);padding:6px 10px;border-radius:999px}
    .fg-sec{margin:12px 0}
    .fg-acc{border:1px solid rgba(0,0,0,.10);border-radius:16px;overflow:hidden;background:#fff}
    .fg-acc__sum{cursor:pointer;padding:14px 14px;list-style:none}
    .fg-acc__sum::-webkit-details-marker{display:none}
    .fg-acc__h2{display:block;font-weight:950}
    .fg-acc__hook{display:block;opacity:.78;margin-top:4px}
    .fg-acc__body{padding:2px 14px 14px}
    .fg-acc__body p{margin:.7rem 0}
    .fg-faq{margin-top:10px}
    .fg-faq__item{border:1px solid rgba(0,0,0,.10);border-radius:14px;padding:10px 12px;margin:10px 0;background:rgba(0,0,0,.02)}
    .fg-faq__q{cursor:pointer;font-weight:950}
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

// ----------------- GEMINI CALL -----------------

async function callGeminiJson(genAI: GoogleGenerativeAI, prompt: string) {
  const candidates = [
    process.env.GEMINI_MODEL,
    "gemini-2.0-pro",
    "gemini-1.5-pro",
    "gemini-1.5-pro-latest",
  ].filter(Boolean) as string[];

  let lastErr: any = null;

  for (const modelName of candidates) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0.2, topP: 0.9, maxOutputTokens: 5000 },
      });

      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 25_000);

      try {
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          // @ts-ignore
          signal: ac.signal,
        });
        return { text: result.response.text(), model: modelName };
      } finally {
        clearTimeout(t);
      }
    } catch (e: any) {
      lastErr = e;
      continue;
    }
  }

  throw new Error(`Gemini call failed on all models. Last error: ${lastErr?.message || String(lastErr)}`);
}

// ----------------- HANDLER -----------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    const body = (req.body ?? {}) as any;
    const data = body.data ?? {};
    const extras = body.extras ?? {};

    const idOrUrl: string | undefined = extras.idOrUrl || body.idOrUrl || data.idOrUrl;

    if (!data?.name) {
      if (!idOrUrl) return res.status(400).json({ error: "Missing data.name or idOrUrl" });

      const bgg = await buildRawResearchFromBgg(idOrUrl);
      if (!bgg || !bgg.ok) {
        const hint401 =
          bgg?.status === 401
            ? "Token BGG mancante o non valido (GG_XML_API_TOKEN). Verifica env su Vercel e fai Redeploy."
            : "Non riesco a leggere i dati da BGG (rate limit o errore).";
        return res.status(502).json({
          error: "BGG fetch failed",
          status: bgg?.status || 0,
          hint: hint401,
          debug: { hasToken: bgg?.hasToken, bodyFirst300: bgg?.bodyFirst300 },
        });
      }

      data.name = bgg.primaryName;
      data.minPlayers = bgg.minPlayers || 0;
      data.maxPlayers = bgg.maxPlayers || 0;
      data.playingTime = bgg.playingTime || 0;
      data.designers = bgg.designers || [];
      data.artists = bgg.artists || [];
      data.publishers = bgg.publishers || [];
      data.mechanics = bgg.mechanics || [];

      extras.rawResearchText = bgg.rawResearchText;
    }

    let rawResearchText =
      (extras.rawResearchText && String(extras.rawResearchText)) ||
      (extras.enrichmentNotes && String(extras.enrichmentNotes)) ||
      "";

    if (!rawResearchText.trim() && idOrUrl) {
      const bgg = await buildRawResearchFromBgg(idOrUrl);
      if (bgg && bgg.ok) rawResearchText = bgg.rawResearchText;
    }

    if (!rawResearchText.trim()) {
      return res.status(400).json({
        error: "Missing research",
        hint: "Passa extras.rawResearchText oppure passa extras.idOrUrl (link BGG) e lo ricavo io.",
      });
    }

    const shopLink = extras.shopLink || "https://www.frogames.it/";
    const publisher = extras.publisherInfo || (data.publishers && data.publishers[0]) || "";

    const designers =
      extras.designers?.length > 0
        ? extras.designers.map((d: any) => d.name).join(", ")
        : data.designers
          ? (Array.isArray(data.designers) ? data.designers.join(", ") : String(data.designers))
          : "";

    const artists =
      extras.artists?.length > 0
        ? extras.artists.map((a: any) => a.name).join(", ")
        : data.artists
          ? (Array.isArray(data.artists) ? data.artists.join(", ") : String(data.artists))
          : "";

    const basePrompt = `
${BLOG_STRATEGY}

GIOCO: "${data.name}"

DATI TECNICI (contesto: NON inventare oltre a questo + RESEARCH):
- Editore: ${publisher}
- Autori: ${designers}
- Artisti: ${artists}
- Giocatori: ${data.minPlayers || 0}-${data.maxPlayers || 0}
- Durata: ${data.playingTime || 0} min
- Meccaniche: ${Array.isArray(data.mechanics) ? data.mechanics.join(", ") : ""}

RESEARCH (questa è la tua unica verità; non aggiungere dettagli fuori da qui):
"""${rawResearchText}"""

NOTE (solo per “scena di partita” se coerente col research):
"${extras.enrichmentNotes || ""}"

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
      "paragraphs": string[] (2-3 paragrafi, max ~330 caratteri ciascuno)
    }
  ],
  "faq": [{ "q": string, "a": string }] (0-6, SOLO se il RESEARCH lo supporta; altrimenti []),
  "ctas": [
    { "label": "Scoprilo su FroGames", "url": "${shopLink}", "placement": "hero" },
    { "label": "Vai allo shop FroGames", "url": "${shopLink}", "placement": "closing" }
  ]
}

LIMITI:
- sections deve essere ESATTAMENTE 10 elementi nell’ordine: hero, origin, system, turn, different, table, learning, target, faq, closing
- NON aggiungere testo fuori dal JSON
`.trim();

    const genAI = new GoogleGenerativeAI(apiKey);

    const tryParse = (t: string) => {
      const direct = safeParseJson(stripCodeFences(t));
      if (direct.ok) return direct.value;

      const extracted = extractFirstJsonObject(t);
      if (!extracted) return null;

      const parsed = safeParseJson(extracted);
      return parsed.ok ? parsed.value : null;
    };

    let result = await callGeminiJson(genAI, basePrompt);
    let out = tryParse(result.text);

    if (!out) {
      const retryPrompt = basePrompt + `
SE STAI SBORDANDO:
- fai 2 paragrafi per sezione
- hook più corti
- faq massimo 3
- output SOLO JSON
`;
      result = await callGeminiJson(genAI, retryPrompt);
      out = tryParse(result.text);
    }

    if (!out) {
      return res.status(500).json({
        error: "Gemini returned non-JSON output (likely truncated or malformed).",
        debug: { modelTried: result.model, rawFirst2000: stripCodeFences(result.text).slice(0, 2000) },
      });
    }

    out.title = out.title || data.name;
    out.slug = out.slug || slugify(out.title || data.name);
    out.seoTitle = clampLen(String(out.seoTitle || out.title).replace(/:/g, "–"), 70);
    out.metaDescription = clampLen(String(out.metaDescription || out.excerpt || ""), 160);

    if (!Array.isArray(out.sections)) out.sections = [];
    if (!Array.isArray(out.faq)) out.faq = [];
    if (!Array.isArray(out.ctas))
      out.ctas = [
        { label: "Scoprilo su FroGames", url: shopLink, placement: "hero" },
        { label: "Vai allo shop FroGames", url: shopLink, placement: "closing" },
      ];

    const contentHtml = renderHtml(out, shopLink);

    return res.status(200).json({
      ...out,
      content: contentHtml,
      contentHtml,
      debug: { model: result.model },
    });
  } catch (e: any) {
    console.error("GEMINI /generate ERROR:", e?.message, e?.stack);
    return res.status(500).json({
      error: e?.message ?? "Server error",
      hint: "Controlla GEMINI_API_KEY e GG_XML_API_TOKEN su Vercel (Production) + Redeploy.",
    });
  }
}

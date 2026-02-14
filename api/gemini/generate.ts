// api/gemini/generate.ts (SERVER - Vercel)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenerativeAI } from "@google/generative-ai";

// -------------- helpers --------------

function stripCodeFences(s: string) {
  return s.replace(/```json/g, "").replace(/```/g, "").trim();
}

function extractFirstJsonObject(text: string): string | null {
  const cleaned = stripCodeFences(text);
  const start = cleaned.indexOf("{");
  if (start === -1) return null;

  // scan bilanciamento parentesi
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) return cleaned.slice(start, i + 1);
  }
  return null;
}

function safeJsonParse(raw: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "JSON.parse error" };
  }
}

function slugify(input: string) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // accenti
    .replace(/[^\w\s-]/g, "") // rimuove simboli
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function clampLen(s: string, max: number) {
  if (!s) return "";
  const str = String(s);
  return str.length <= max ? str : str.slice(0, max - 1).trimEnd() + "…";
}

function htmlEscape(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isNonEmptyString(x: any) {
  return typeof x === "string" && x.trim().length > 0;
}

function ensureArray(x: any) {
  return Array.isArray(x) ? x : [];
}

// -------------- minimal validation (no deps) --------------
type ValidationIssue = { path: string; message: string };

function validateDraftLoose(draft: any): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const requiredTop = ["title", "slug", "seoTitle", "metaDescription", "excerpt"];
  for (const k of requiredTop) {
    if (!isNonEmptyString(draft?.[k])) issues.push({ path: k, message: "Missing/empty" });
  }

  // seo rules
  if (isNonEmptyString(draft?.seoTitle)) {
    if (draft.seoTitle.length > 70) issues.push({ path: "seoTitle", message: "Too long (>70)" });
    if (draft.seoTitle.includes(":")) issues.push({ path: "seoTitle", message: 'Contains ":" (use –)' });
  }
  if (isNonEmptyString(draft?.metaDescription)) {
    if (draft.metaDescription.length > 160)
      issues.push({ path: "metaDescription", message: "Too long (>160)" });
    if (draft.metaDescription.includes(":"))
      issues.push({ path: "metaDescription", message: 'Contains ":" (use –)' });
  }

  // pullQuotes
  if (!Array.isArray(draft?.pullQuotes) || draft.pullQuotes.length < 2) {
    issues.push({ path: "pullQuotes", message: "Need 2–3 pullQuotes" });
  }

  // facts evidence
  const facts = ensureArray(draft?.facts);
  if (facts.length < 6) issues.push({ path: "facts", message: "Need 6–12 facts" });
  for (let i = 0; i < facts.length; i++) {
    const f = facts[i];
    if (!isNonEmptyString(f?.fact)) issues.push({ path: `facts[${i}].fact`, message: "Missing" });
    if (!isNonEmptyString(f?.evidence_snippet))
      issues.push({ path: `facts[${i}].evidence_snippet`, message: "Missing" });
  }

  // sections
  const sections = ensureArray(draft?.sections);
  const expectedIds = [
    "hero",
    "origin",
    "system",
    "turn",
    "different",
    "table",
    "learning",
    "target",
    "faq",
    "closing",
  ];
  if (sections.length !== 10) issues.push({ path: "sections", message: "Must be 10 sections" });

  const ids = new Set(sections.map((s: any) => s?.id));
  for (const id of expectedIds) {
    if (!ids.has(id)) issues.push({ path: "sections", message: `Missing section id: ${id}` });
  }

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (!isNonEmptyString(s?.id)) issues.push({ path: `sections[${i}].id`, message: "Missing" });
    if (!isNonEmptyString(s?.h2)) issues.push({ path: `sections[${i}].h2`, message: "Missing" });
    if (!isNonEmptyString(s?.hook)) issues.push({ path: `sections[${i}].hook`, message: "Missing" });
    const paras = ensureArray(s?.paragraphs);
    if (paras.length < 1) issues.push({ path: `sections[${i}].paragraphs`, message: "Empty" });
  }

  // ctas
  const ctas = ensureArray(draft?.ctas);
  if (ctas.length < 2) issues.push({ path: "ctas", message: "Need 2 CTAs (hero+closing)" });

  return issues;
}

// -------------- HTML renderer (struttura fissa) --------------
// - tutto nel DOM
// - <details> SEO-safe
// - FAQ renderizzata SOLO dentro la sezione "faq" e SOLO se evidence_snippet presente (anti-invenzioni)
function renderHtml(draft: any, shopLink: string) {
  const sections = ensureArray(draft?.sections);
  const pullQuotes = ensureArray(draft?.pullQuotes);

  const faqItemsRaw = ensureArray(draft?.faq);
  const faqItems = faqItemsRaw
    .filter(
      (f: any) => isNonEmptyString(f?.q) && isNonEmptyString(f?.a) && isNonEmptyString(f?.evidence_snippet)
    )
    .slice(0, 8);

  const nav = sections
    .map((s: any) => `<a class="fg-toc__a" href="#${htmlEscape(s.id)}">${htmlEscape(s.h2)}</a>`)
    .join("");

  const quotesHtml =
    pullQuotes.length > 0
      ? `<div class="fg-quotes">
          ${pullQuotes
            .slice(0, 3)
            .map((q: string) => `<div class="fg-quote">${htmlEscape(q)}</div>`)
            .join("")}
        </div>`
      : "";

  const ctaHeroUrl =
    (draft?.ctas?.find?.((c: any) => c?.placement === "hero")?.url as string) || shopLink;

  const sectionsHtml = sections
    .map((s: any, idx: number) => {
      const paras = ensureArray(s?.paragraphs)
        .map((p: string) => `<p>${htmlEscape(p)}</p>`)
        .join("");

      const h3Blocks = ensureArray(s?.h3Blocks)
        .map((b: any) => {
          const bparas = ensureArray(b?.paragraphs)
            .map((p: string) => `<p>${htmlEscape(p)}</p>`)
            .join("");
          return `<h3>${htmlEscape(b?.h3 || "")}</h3>${bparas}`;
        })
        .join("");

      const openAttr = idx === 0 ? " open" : "";

      // FAQ: solo dentro questa sezione, e solo se evidence presente
      const faqHtml =
        s?.id === "faq" && faqItems.length > 0
          ? `<div class="fg-faq">
              ${faqItems
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
            <span class="fg-acc__h2">${htmlEscape(s.h2)}</span>
            <span class="fg-acc__hook">${htmlEscape(s.hook || "")}</span>
          </summary>
          <div class="fg-acc__body">
            ${paras}
            ${h3Blocks}
            ${faqHtml}
          </div>
        </details>
      </section>
      `;
    })
    .join("");

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
    .fg-quotes{display:grid;gap:10px;margin:14px 0}
    .fg-quote{border-left:4px solid rgba(0,0,0,.18);padding:8px 12px;border-radius:10px;background:rgba(0,0,0,.03)}
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
    <h1 class="fg-title">${htmlEscape(draft?.title || "")}</h1>
    <p class="fg-excerpt">${htmlEscape(draft?.excerpt || "")}</p>
    <a class="fg-btn" href="${htmlEscape(ctaHeroUrl)}" rel="nofollow">Scoprilo su FroGames</a>
  </header>

  ${quotesHtml}

  <nav class="fg-toc" aria-label="Indice">
    ${nav}
  </nav>

  ${sectionsHtml}

  <footer class="fg-sec">
    <a class="fg-btn" href="${htmlEscape(shopLink)}" rel="nofollow">Vai allo shop FroGames</a>
  </footer>
</article>
  `.trim();
}

// -------------- main handler --------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    const { data, extras } = (req.body ?? {}) as any;
    if (!data || !extras) return res.status(400).json({ error: "Missing data/extras" });

    const publisher = extras.publisherInfo || (data.publishers && data.publishers[0]) || "";
    const designers =
      extras.designers?.length > 0
        ? extras.designers.map((d: any) => d.name).join(", ")
        : data.designers
          ? data.designers.join(", ")
          : "";
    const artists =
      extras.artists?.length > 0
        ? extras.artists.map((a: any) => a.name).join(", ")
        : data.artists
          ? data.artists.join(", ")
          : "";

    const shopLink = extras.shopLink || "https://www.frogames.it/";

    // ✅ RESEARCH: accetta più nomi (così non ti impicci col frontend)
    const rawResearchText =
      (extras.rawResearchText && String(extras.rawResearchText)) ||
      (extras.researchText && String(extras.researchText)) ||
      (extras.research && String(extras.research)) ||
      (extras.raw && String(extras.raw)) ||
      (extras.enrichmentNotes && String(extras.enrichmentNotes)) ||
      "";

    const GAME_NAME = String(data.name || "").trim();

    if (!GAME_NAME) return res.status(400).json({ error: "Missing data.name" });

    // ✅ Non bloccare con errore “rawResearchText”: blocca solo se è davvero vuoto
    if (!rawResearchText.trim()) {
      return res.status(400).json({
        error:
          "Research vuoto. Devi inviare un testo grezzo dentro extras.rawResearchText (oppure extras.researchText).",
        expectedBodyExample: {
          data: { name: "SETI" },
          extras: { rawResearchText: "Incolla qui il tuo testo grezzo..." },
        },
      });
    }

    const STRATEGY = `
SEI UN DOCUMENTARISTA DI BOARDGAME CULTURE.
Non scrivere una biografia, non scrivere marketing, non scrivere Wikipedia.
Scrivi come un mini-documentario: scene, svolte, scelte, conseguenze.

DIVIETI ASSOLUTI:
- Vietato: "innegabile", "straordinario", "fondamentale", "ha ispirato", "rivoluzionario" senza scena concreta.
- Vietato inventare dati (scalabilità, durata, difficoltà, “in due funziona”) se non presenti nel RESEARCH.
- Vietato citare fonti esterne, BGG, marketplace, competitor.
- Vietato HTML. Output SOLO JSON.

REGOLE DI SCRITTURA:
- Ogni sezione inizia con 1 riga-hook cinematografica (1 frase breve).
- Ogni paragrafo risponde a: cosa succede? perché conta? cosa cambia al tavolo?
- Inserisci almeno 1 SCENA DI PARTITA concreta (turno tipo) con dilemma reale.
- Usa meno numeri, più conseguenze.
- Paragrafi brevi (max ~350-450 caratteri).

SEO:
- seoTitle <= 70 caratteri, usa “–” e MAI “:”
- metaDescription <= 160
- includi naturalmente “gioco da tavolo” + 2 varianti coerenti (senza spam)

STRUTTURA SEZIONI (ID FISSI, 10):
hero, origin, system, turn, different, table, learning, target, faq, closing

EVIDENCE RULE (ANTI-INVENZIONI):
- facts[] deve SEMPRE avere evidence_snippet copiato dal RESEARCH (10–25 parole).
- faq[]: scrivi una FAQ SOLO se puoi allegare evidence_snippet dal RESEARCH. Se non hai evidence, lascia faq[] vuoto.

OUTPUT JSON FINALE (campi obbligatori):
title, slug, seoTitle, metaDescription, excerpt, pullQuotes[], facts[], sections[], faq[], ctas[]
`.trim();

    const prompt = `
RISPOSTA: restituisci SOLO JSON valido. Niente testo extra, niente markdown.
Se non sai una cosa: usa "" o [].
Non inventare niente che non sia supportato dal RESEARCH.

GIOCO: "${GAME_NAME}"

DATI TECNICI (usali SOLO come contesto, NON inventare oltre questi):
- Editore: ${publisher}
- Autori: ${designers}
- Artisti: ${artists}
- Giocatori: ${data.minPlayers}-${data.maxPlayers}
- Durata: ${data.playingTime} min
- Meccaniche: ${data.mechanics ? data.mechanics.join(", ") : ""}

RESEARCH (testo grezzo, è la tua unica verità):
"""${rawResearchText}"""

LINK SHOP (CTA): ${shopLink}

${STRATEGY}

GENERAZIONE (obbligatoria):
1) facts[]: 6-12 elementi. Ogni fact ha evidence_snippet (10–25 parole copiate dal RESEARCH) + confidence.
2) sections[]: 10 sezioni con gli ID fissi. Ogni sezione: h2, hook (1 frase), paragraphs[] brevi. Se serve: h3Blocks[].
3) faq[]: 0-8. SOLO se evidence_snippet esiste nel RESEARCH.
4) pullQuotes[]: 2-3 frasi max 120 caratteri.
5) ctas[]: 2 CTA (hero + closing) verso LINK SHOP.

IMPORTANTE:
- slug = slugify(title o GAME_NAME)
- seoTitle/metaDescription rispettano i limiti e NON contengono ":" (usa “–”)
`.trim();

    const genAI = new GoogleGenerativeAI(apiKey);

    // Config per ridurre output “random” e aumentare compliance JSON
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
      generationConfig: {
        temperature: 0.4,
        topP: 0.9,
        maxOutputTokens: 6000,
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const rawJson = extractFirstJsonObject(text);
    if (!rawJson) {
      return res.status(500).json({
        error: "No JSON object found in Gemini response",
        debug: { raw: text.slice(0, 4000) },
      });
    }

    const parsed = safeJsonParse(rawJson);
    if (!parsed.ok) {
      return res.status(500).json({
        error: "JSON parse failed",
        parseError: parsed.error,
        debug: { raw: rawJson.slice(0, 4000) },
      });
    }

    const out = parsed.value ?? {};

    // hard clamps (seo safety)
    out.title = out.title || GAME_NAME;
    out.slug = out.slug || slugify(out.title || GAME_NAME);

    // Normalizza “:” -> “–” e tronca
    out.seoTitle = clampLen(String(out.seoTitle || out.title || GAME_NAME).replace(/:/g, "–"), 70);
    out.metaDescription = clampLen(String(out.metaDescription || out.excerpt || ""), 160);

    // Garantisce array
    out.pullQuotes = ensureArray(out.pullQuotes).slice(0, 3);
    if (out.pullQuotes.length < 2) {
      out.pullQuotes = [clampLen(out.title, 120), clampLen(out.seoTitle, 120)].slice(0, 2);
    }

    out.facts = ensureArray(out.facts).slice(0, 12);
    out.sections = ensureArray(out.sections);
    out.faq = ensureArray(out.faq);
    out.ctas = ensureArray(out.ctas);

    // Fallback CTA se mancano
    const hasHeroCta = out.ctas.some((c: any) => c?.placement === "hero" && isNonEmptyString(c?.url));
    const hasClosingCta = out.ctas.some((c: any) => c?.placement === "closing" && isNonEmptyString(c?.url));
    if (!hasHeroCta) out.ctas.push({ label: "Scoprilo su FroGames", url: shopLink, placement: "hero" });
    if (!hasClosingCta) out.ctas.push({ label: "Vai allo shop FroGames", url: shopLink, placement: "closing" });

    // keep 2 (hero + closing)
    out.ctas = [
      out.ctas.find((c: any) => c?.placement === "hero") || {
        label: "Scoprilo su FroGames",
        url: shopLink,
        placement: "hero",
      },
      out.ctas.find((c: any) => c?.placement === "closing") || {
        label: "Vai allo shop FroGames",
        url: shopLink,
        placement: "closing",
      },
    ];

    // Loose validation: se mancano pezzi chiave, torna error con issues + raw debug
    const issues = validateDraftLoose(out);
    if (issues.length > 0) {
      return res.status(500).json({
        error: "Draft validation failed (loose)",
        issues,
        debug: { rawModelOutput: text.slice(0, 4000) },
      });
    }

    // Render HTML fisso lato server
    const html = renderHtml(out, shopLink);

    // Risposta: JSON + html pronto (HTML generato dal renderer, NON dal modello)
    return res.status(200).json({
      ...out,
      contentHtml: html,
      debug: { model: "gemini-2.5-pro" },
    });
  } catch (e: any) {
    console.error("GEMINI /generate ERROR:", e?.message, e?.stack);
    return res.status(500).json({
      error: e?.message ?? "Server error",
      hint: "Controlla GEMINI_API_KEY, body {data, extras}, e che extras.rawResearchText (o researchText) non sia vuoto.",
    });
  }
}

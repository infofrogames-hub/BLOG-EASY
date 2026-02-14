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

  // semplice scan bilanciamento parentesi
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) {
      return cleaned.slice(start, i + 1);
    }
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
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // accenti
    .replace(/[^\w\s-]/g, "")       // rimuove simboli
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function clampLen(s: string, max: number) {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

function htmlEscape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// -------------- HTML renderer (struttura fissa) --------------

function renderHtml(draft: any, shopLink: string) {
  const sections = Array.isArray(draft.sections) ? draft.sections : [];
  const faq = Array.isArray(draft.faq) ? draft.faq : [];
  const pullQuotes = Array.isArray(draft.pullQuotes) ? draft.pullQuotes : [];

  // Accordion SEO-safe via <details> (tutto nel DOM, zero JS, stabile)
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

  const sectionsHtml = sections
    .map((s: any, idx: number) => {
      const paras = (s.paragraphs ?? []).map((p: string) => `<p>${htmlEscape(p)}</p>`).join("");
      const h3Blocks = (s.h3Blocks ?? [])
        .map((b: any) => {
          const bparas = (b.paragraphs ?? []).map((p: string) => `<p>${htmlEscape(p)}</p>`).join("");
          return `<h3>${htmlEscape(b.h3)}</h3>${bparas}`;
        })
        .join("");

      // prima sezione aperta di default
      const openAttr = idx === 0 ? " open" : "";

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
          </div>
        </details>
      </section>
      `;
    })
    .join("");

  const faqHtml =
    faq.length > 0
      ? `<section id="faq" class="fg-sec">
          <h2>FAQ</h2>
          <div class="fg-faq">
            ${faq
              .slice(0, 8)
              .map((f: any) => {
                return `
                <details class="fg-faq__item">
                  <summary class="fg-faq__q">${htmlEscape(f.q)}</summary>
                  <div class="fg-faq__a"><p>${htmlEscape(f.a)}</p></div>
                </details>`;
              })
              .join("")}
          </div>
        </section>`
      : "";

  const ctaUrl = (draft.ctas?.find?.((c: any) => c.placement === "hero")?.url || shopLink) as string;

  return `
<article class="fg-blog">
  <style>
    .fg-blog{font-family:inherit;line-height:1.7;max-width:900px;margin:0 auto;padding:16px}
    .fg-hero{border:1px solid rgba(0,0,0,.12);border-radius:16px;padding:14px;margin-bottom:16px}
    .fg-kicker{opacity:.8;font-size:.95rem}
    .fg-title{margin:.2rem 0 .4rem;font-size:1.7rem;line-height:1.2}
    .fg-excerpt{margin:0}
    .fg-btn{display:inline-block;margin-top:10px;padding:10px 14px;border-radius:12px;border:1px solid rgba(0,0,0,.18);text-decoration:none;font-weight:700}
    .fg-toc{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 18px}
    .fg-toc__a{font-size:.92rem;text-decoration:none;border:1px solid rgba(0,0,0,.14);padding:6px 10px;border-radius:999px}
    .fg-quotes{display:grid;gap:10px;margin:14px 0}
    .fg-quote{border-left:4px solid rgba(0,0,0,.18);padding:8px 12px;border-radius:10px;background:rgba(0,0,0,.03)}
    .fg-sec{margin:12px 0}
    .fg-acc{border:1px solid rgba(0,0,0,.12);border-radius:14px;overflow:hidden}
    .fg-acc__sum{cursor:pointer;padding:12px 12px;list-style:none}
    .fg-acc__sum::-webkit-details-marker{display:none}
    .fg-acc__h2{display:block;font-weight:800}
    .fg-acc__hook{display:block;opacity:.85;margin-top:4px}
    .fg-acc__body{padding:0 12px 12px}
    .fg-faq__item{border:1px solid rgba(0,0,0,.12);border-radius:14px;padding:10px 12px;margin:10px 0}
    .fg-faq__q{cursor:pointer;font-weight:800}
    .fg-faq__a p{margin:.6rem 0 0}
  </style>

  <header class="fg-hero">
    <div class="fg-kicker">Blog FroGames • Mini-documentario da tavolo</div>
    <h1 class="fg-title">${htmlEscape(draft.title || "")}</h1>
    <p class="fg-excerpt">${htmlEscape(draft.excerpt || "")}</p>
    <a class="fg-btn" href="${htmlEscape(ctaUrl)}" rel="nofollow">Scoprilo su FroGames</a>
  </header>

  ${quotesHtml}

  <nav class="fg-toc" aria-label="Indice">
    ${nav}
  </nav>

  ${sectionsHtml}

  ${faqHtml}

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
        : (data.designers ? data.designers.join(", ") : "");
    const artists =
      extras.artists?.length > 0
        ? extras.artists.map((a: any) => a.name).join(", ")
        : (data.artists ? data.artists.join(", ") : "");

    const shopLink = extras.shopLink || "https://www.frogames.it/";

    // Se hai “rawResearchText” vero, passalo qui. Al momento usi enrichmentNotes:
    const rawResearchText =
      (extras.rawResearchText && String(extras.rawResearchText)) ||
      (extras.enrichmentNotes && String(extras.enrichmentNotes)) ||
      "";

    const GAME_NAME = String(data.name || "").trim();

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

STRUTTURA SEZIONI (ID FISSI):
hero, origin, system, turn, different, table, learning, target, faq, closing

FAQ RULE:
- Scrivi una FAQ SOLO se puoi allegare evidence_snippet copiato dal RESEARCH.
- Se non hai evidence, non inventare: lascia faq[] vuoto.

OUTPUT JSON FINALE: BlogDraft (campi: title, slug, seoTitle, metaDescription, excerpt, pullQuotes, facts, sections, faq, ctas)
`.trim();

    const prompt = `
RISPOSTA: restituisci SOLO JSON valido. Niente testo extra, niente markdown.
Se non sai una cosa: usa "" o [].
Non inventare niente che non sia supportato dal RESEARCH.

GIOCO: "${GAME_NAME}"

DATI TECNICI (se utili, ma NON inventare oltre questi):
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

GENERAZIONE:
1) Crea facts[] (6-12) con evidence_snippet (10–25 parole copiate dal RESEARCH) e confidence.
2) Crea sections[] (10 sezioni con gli id fissi) con hook + paragraphs brevi.
3) Crea faq[] SOLO se hai evidence_snippet nel RESEARCH.
4) Crea pullQuotes[] (2-3) max 120 caratteri.
5) ctas[]: 2 CTA (hero + closing) verso LINK SHOP.

NOTA: slug = slugify(title o GAME_NAME). seoTitle/metaDescription rispettano i limiti.
`.trim();

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const rawJson = extractFirstJsonObject(text);
    if (!rawJson) {
      return res.status(500).json({
        error: "No JSON object found in Gemini response",
        debug: { raw: text.slice(0, 2000) },
      });
    }

    const parsed = safeJsonParse(rawJson);
    if (!parsed.ok) {
      return res.status(500).json({
        error: "JSON parse failed",
        parseError: parsed.error,
        debug: { raw: rawJson.slice(0, 2000) },
      });
    }

    const out = parsed.value;

    // hard clamps (seo safety)
    out.title = out.title || GAME_NAME;
    out.slug = out.slug || slugify(out.title || GAME_NAME);
    out.seoTitle = clampLen(String(out.seoTitle || out.title || GAME_NAME).replace(/:/g, "–"), 70);
    out.metaDescription = clampLen(String(out.metaDescription || out.excerpt || ""), 160);

    // Render HTML fisso lato server
    const html = renderHtml(out, shopLink);

    // Risposta: JSON + html pronto
    return res.status(200).json({
      ...out,
      contentHtml: html, // <— questo sostituisce “content HTML denso” scritto dal modello
      debug: { model: "gemini-2.5-pro" },
    });
  } catch (e: any) {
    console.error("GEMINI /generate ERROR:", e?.message, e?.stack);
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
}

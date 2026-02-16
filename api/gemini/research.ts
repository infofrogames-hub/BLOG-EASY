// api/gemini/research.ts (SERVER - Vercel)
// Ricava dati reali da BoardGameGeek XML API2
// Input: { idOrUrl: string } (BGG URL o ID numerico)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { XMLParser } from "fast-xml-parser";

export const config = { runtime: "nodejs" };

function isNonEmptyString(x: any) {
  return typeof x === "string" && x.trim().length > 0;
}

function toArray<T>(x: T | T[] | undefined | null): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
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

function clamp(s: string, max: number) {
  const str = String(s || "");
  return str.length <= max ? str : str.slice(0, max - 1).trimEnd() + "…";
}

async function fetchBggThingXml(bggId: string) {
  const url = `https://boardgamegeek.com/xmlapi2/thing?id=${encodeURIComponent(bggId)}&stats=1`;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15_000);

  try {
    const r = await fetch(url, {
      headers: { "user-agent": "frogames-bot/1.0 (+https://frogames.it)" },
      signal: ac.signal,
    });

    if (!r.ok) {
      return {
        ok: false as const,
        status: r.status,
        text: await r.text().catch(() => ""),
      };
    }

    const xml = await r.text();
    return { ok: true as const, xml };
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { idOrUrl } = (req.body ?? {}) as { idOrUrl?: string };
    if (!idOrUrl) return res.status(400).json({ error: "Missing idOrUrl" });

    const bggId = extractBggId(idOrUrl);
    if (!bggId) {
      return res.status(400).json({
        error: "Invalid idOrUrl",
        hint: "Passa un ID numerico BGG oppure un link tipo https://boardgamegeek.com/boardgame/275044/glow",
      });
    }

    const fetched = await fetchBggThingXml(bggId);
    if (!fetched.ok) {
      return res.status(502).json({
        error: "BGG fetch failed",
        status: fetched.status,
        hint: "BGG può rate-limitare o essere lento. Riprova tra poco.",
      });
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
    });

    const parsed = parser.parse(fetched.xml);
    const item = parsed?.items?.item;
    if (!item) return res.status(404).json({ error: "BGG item not found", debug: { bggId } });

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

    const averageRating = String(item?.statistics?.ratings?.average?.["@_value"] || "") || "0";

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
      .join("\n");

    return res.status(200).json({
      id: String(bggId),
      name: primaryName,
      description,
      yearPublished,
      minPlayers,
      maxPlayers,
      playingTime,
      designers,
      artists,
      publishers,
      mechanics,
      image: "",
      thumbnail: "",
      minAge: "14",
      categories: [],
      rank: "N/A",
      averageRating,
      comments: [],
      rawResearchText: clamp(rawResearchText, 20000),
    });
  } catch (e: any) {
    console.error("GEMINI /research ERROR:", e?.message, e?.stack);
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
}

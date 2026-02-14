// api/gemini/research.ts (SERVER - Vercel)
// Usa GEMINI_API_KEY dalle Env Vars di Vercel

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";

const cleanJsonResponse = (text: string | undefined): string => {
  if (!text) return "{}";
  let cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
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

    const { idOrUrl } = (req.body ?? {}) as { idOrUrl?: string };
    if (!idOrUrl) return res.status(400).json({ error: "Missing idOrUrl" });

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-1.5-pro",
      contents: `Analisi professionale dati gioco da tavolo: ${idOrUrl}.
Cerca su Google Search i dati ufficiali.
Restituisci SOLO un JSON con questi campi esatti (camelCase):
id, name, description, yearPublished, minPlayers, maxPlayers, playingTime, designers (array), artists (array), publishers (array), mechanics (array).
Sii preciso su nomi di autori e editori.`,
      config: { tools: [{ googleSearch: {} }], responseMimeType: "application/json" },
    });

    const data = JSON.parse(cleanJsonResponse(response.text));

    // Normalizzazione + default come facevi tu
    const out = {
      ...data,
      image: "",
      thumbnail: "",
      minAge: "14",
      categories: [],
      rank: "N/A",
      averageRating: "0",
      comments: [],
    };

    return res.status(200).json(out);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
}

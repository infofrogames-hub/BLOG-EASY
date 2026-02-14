// api/gemini/research.ts (SERVER - Vercel)
// Usa GEMINI_API_KEY dalle Env Vars di Vercel

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenerativeAI } from "@google/generative-ai";

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
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    }

    const { idOrUrl } = (req.body ?? {}) as { idOrUrl?: string };
    if (!idOrUrl) {
      return res.status(400).json({ error: "Missing idOrUrl" });
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // ✅ Modello compatibile (evita il 404 su v1beta)
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const prompt = `Analisi professionale dati gioco da tavolo: ${idOrUrl}.
Restituisci SOLO un JSON con questi campi esatti (camelCase):
id, name, description, yearPublished, minPlayers, maxPlayers, playingTime, designers (array), artists (array), publishers (array), mechanics (array).
Sii preciso su nomi di autori e editori.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const data = JSON.parse(cleanJsonResponse(text));

    const out = {
      ...data,
      image: "",
      thumbnail: "",
      minAge: "14",
      categories: [],
      rank: "N/A",
      averageRating: "0",
      comments: []
    };

    return res.status(200).json(out);
  } catch (e: any) {
    console.error("GEMINI /research ERROR:", e?.message, e?.stack);
    return res.status(500).json({
      error: e?.message ?? "Server error"
    });
  }
}

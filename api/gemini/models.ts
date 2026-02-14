// api/gemini/models.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const r = await fetch(url);

    const text = await r.text();
    // rimandiamo raw così vediamo ESATTAMENTE cosa risponde Google (anche errori)
    return res.status(r.status).setHeader("content-type", "application/json").send(text);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
}

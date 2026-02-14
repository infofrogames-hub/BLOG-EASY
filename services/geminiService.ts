// services/geminiService.ts (FRONTEND)
// Qui NON deve esistere nessuna API key. Solo fetch verso le API server.

import { BGGGameData, OptionalLinks, GeneratedBlog } from "../types";

type ApiError = { error?: string };

const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await r.json().catch(() => ({}))) as any;

  if (!r.ok) {
    const msg = (data as ApiError)?.error || `Request failed (${r.status})`;
    throw new Error(msg);
  }

  return data as T;
};

export const researchGameWithAI = async (idOrUrl: string): Promise<BGGGameData> => {
  return postJson<BGGGameData>("/api/gemini/research", { idOrUrl });
};

export const generateBlogPost = async (data: BGGGameData, extras: OptionalLinks): Promise<GeneratedBlog> => {
  return postJson<GeneratedBlog>("/api/gemini/generate", { data, extras });
};

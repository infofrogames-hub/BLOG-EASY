// api/gemini/schema.ts
import { z } from "zod";

export const Confidence = z.enum(["high", "medium", "low"]);

export const FactSchema = z.object({
  fact: z.string().min(10),
  evidence_snippet: z.string().min(10),
  confidence: Confidence,
});

export const FaqSchema = z.object({
  q: z.string().min(5),
  a: z.string().min(10),
  evidence_snippet: z.string().min(10),
  confidence: Confidence,
});

export const H3BlockSchema = z.object({
  h3: z.string().min(3),
  paragraphs: z.array(z.string().min(20)).min(1),
});

export const SectionId = z.enum([
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
]);

export const SectionSchema = z.object({
  id: SectionId,
  h2: z.string().min(3),
  hook: z.string().min(10),
  paragraphs: z.array(z.string().min(20)).min(1),
  h3Blocks: z.array(H3BlockSchema).optional(),
});

export const CtaSchema = z.object({
  label: z.string().min(2),
  url: z.string().url(),
  placement: z.enum(["hero", "closing"]),
});

export const BlogDraftSchema = z.object({
  title: z.string().min(3),
  slug: z.string().min(3),
  seoTitle: z.string().min(10).max(70),
  metaDescription: z.string().min(50).max(160),
  excerpt: z.string().min(20),
  pullQuotes: z.array(z.string().min(10).max(120)).min(2).max(3),
  facts: z.array(FactSchema).min(6).max(12),
  sections: z.array(SectionSchema).length(10),
  faq: z.array(FaqSchema).max(8),
  ctas: z.array(CtaSchema).min(2).max(2),
});

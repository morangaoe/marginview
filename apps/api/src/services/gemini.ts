/**
 * AI service — uses the Anthropic Claude API.
 *
 * Despite the filename (kept for minimal import churn), this now calls Claude,
 * not Gemini. The provider column in the DB is "claude".
 */
import Anthropic from "@anthropic-ai/sdk";
import { query } from "../db/pool";
import { HttpError } from "../utils/http";
import { decrypt } from "./crypto";
import { getOrgTier } from "./billing";
import { TIER_AI_LIMITS } from "./plans";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const FALLBACK_LIMIT = Number(process.env.AI_MONTHLY_LIMIT ?? 200);

export interface ResolvedKey { apiKey: string; model: string; source: "org" | "platform" }

export async function resolveAI(orgId: string): Promise<ResolvedKey | null> {
  const [row] = await query<{ key_ciphertext: string; model: string | null }>(
    "select key_ciphertext, model from org_integrations where organization_id = $1 and provider = 'claude'",
    [orgId],
  );
  if (row) return { apiKey: decrypt(row.key_ciphertext), model: row.model || DEFAULT_MODEL, source: "org" };
  if (process.env.ANTHROPIC_API_KEY) return { apiKey: process.env.ANTHROPIC_API_KEY, model: DEFAULT_MODEL, source: "platform" };
  return null;
}

// Keep old name as alias so existing imports still work
export const resolveGemini = resolveAI;

/** Low-level Claude call. Returns parsed JSON and token counts. */
export async function callClaude<T>(
  k: ResolvedKey,
  opts: { system?: string; prompt: string; schema?: object },
): Promise<{ data: T; tokensIn: number; tokensOut: number }> {
  const client = new Anthropic({ apiKey: k.apiKey });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: k.model,
      max_tokens: 1024,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: "user", content: opts.prompt }],
    });
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403) {
      throw new HttpError(400, "The Claude API key was rejected. Check the key in Settings.");
    }
    if (err?.status === 429) {
      throw new HttpError(429, "The AI provider is rate limiting requests. Try again in a minute.");
    }
    if (err?.error?.type === "timeout" || err?.name === "APIConnectionTimeoutError") {
      throw new HttpError(504, "The AI service took too long. Try again shortly.");
    }
    throw new HttpError(502, "The AI service is unreachable. Try again shortly.");
  }

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && "text" in textBlock ? textBlock.text : undefined;
  if (!text) throw new HttpError(502, "The AI returned an empty answer.");

  // Claude returns text. Extract JSON from the response — it may be wrapped in markdown fences.
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  const jsonStr = (jsonMatch[1] ?? text).trim();

  try {
    return {
      data: JSON.parse(jsonStr) as T,
      tokensIn: response.usage?.input_tokens ?? 0,
      tokensOut: response.usage?.output_tokens ?? 0,
    };
  } catch {
    throw new HttpError(502, "The AI returned an unreadable answer.");
  }
}

// Keep old name as alias
export const callGemini = callClaude;

/** Resolves the key, enforces the monthly quota on the platform key, calls, records usage. */
async function resolveWithQuota(orgId: string): Promise<ResolvedKey> {
  const k = await resolveAI(orgId);
  if (!k) throw new HttpError(503, "AI isn't configured. Add a Claude API key in Settings, or ask your admin.");

  if (k.source === "platform") {
    // Tier-based AI limits: each plan gets a different monthly quota.
    let limit = FALLBACK_LIMIT;
    try {
      const { effectiveTier } = await getOrgTier(orgId);
      limit = TIER_AI_LIMITS[effectiveTier] ?? FALLBACK_LIMIT;
    } catch { /* billing lookup failed — fall back to env default */ }

    const [{ n }] = await query<{ n: string }>(
      "select count(*)::text as n from ai_usage where organization_id = $1 and source = 'platform' and created_at >= date_trunc('month', now())",
      [orgId],
    );
    if (Number(n) >= limit) {
      throw new HttpError(429, `You've used your ${limit} included AI requests this month. Add your own Claude key in Settings or upgrade.`);
    }
  }
  return k;
}

function recordUsage(orgId: string, kind: string, source: string, tokensIn: number, tokensOut: number) {
  return query(
    "insert into ai_usage (organization_id, kind, source, tokens_in, tokens_out) values ($1,$2,$3,$4,$5)",
    [orgId, kind, source, tokensIn, tokensOut],
  ).catch(() => undefined); // metering must never fail the request
}

export async function askAI<T>(
  orgId: string,
  kind: string,
  opts: { system?: string; prompt: string; schema?: object },
): Promise<T> {
  const k = await resolveWithQuota(orgId);
  const out = await callClaude<T>(k, opts);
  await recordUsage(orgId, kind, k.source, out.tokensIn, out.tokensOut);
  return out.data;
}

export interface ChatTurn { role: "user" | "assistant"; content: string }

/** Free-text multi-turn chat. Same key resolution, quota, and metering as askAI. */
export async function askAIChat(
  orgId: string,
  kind: string,
  opts: { system: string; messages: ChatTurn[]; maxTokens?: number },
): Promise<string> {
  const k = await resolveWithQuota(orgId);
  const client = new Anthropic({ apiKey: k.apiKey });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: k.model,
      max_tokens: opts.maxTokens ?? 1200,
      system: opts.system,
      messages: opts.messages,
    });
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403) throw new HttpError(400, "The Claude API key was rejected. Check the key in Settings.");
    if (err?.status === 429) throw new HttpError(429, "The AI provider is rate limiting requests. Try again in a minute.");
    throw new HttpError(502, "The AI service is unreachable. Try again shortly.");
  }
  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  if (!text) throw new HttpError(502, "The AI returned an empty answer.");
  await recordUsage(orgId, kind, k.source, response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0);
  return text;
}

// Keep old name as alias so existing callers work without changes
export const askGemini = askAI;

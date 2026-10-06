import { query } from "../db/pool";
import { HttpError } from "../utils/http";
import { decrypt } from "./crypto";

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MONTHLY_LIMIT = Number(process.env.AI_MONTHLY_LIMIT ?? 200);

export interface ResolvedKey { apiKey: string; model: string; source: "org" | "platform" }

export async function resolveGemini(orgId: string): Promise<ResolvedKey | null> {
  const [row] = await query<{ key_ciphertext: string; model: string | null }>(
    "select key_ciphertext, model from org_integrations where organization_id = $1 and provider = 'gemini'",
    [orgId],
  );
  if (row) return { apiKey: decrypt(row.key_ciphertext), model: row.model || DEFAULT_MODEL, source: "org" };
  if (process.env.GEMINI_API_KEY) return { apiKey: process.env.GEMINI_API_KEY, model: DEFAULT_MODEL, source: "platform" };
  return null;
}

/** Low-level call. Errors never include the key or the upstream response body. */
export async function callGemini<T>(
  k: ResolvedKey,
  opts: { system?: string; prompt: string; schema: object },
): Promise<{ data: T; tokensIn: number; tokensOut: number }> {
  // BUG FIX: distinguish timeout from network errors so merchants get
  // an actionable message instead of a generic "unreachable".
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(k.model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": k.apiKey },
        body: JSON.stringify({
          ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
          contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: opts.schema, temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(25_000),
      },
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new HttpError(504, "The AI service took too long. Try again shortly.");
    }
    throw new HttpError(502, "The AI service is unreachable. Try again shortly.");
  }

  if (res.status === 400 || res.status === 403) throw new HttpError(400, "The Gemini key was rejected. Check the key and model.");
  if (res.status === 429) throw new HttpError(429, "The AI provider is rate limiting requests. Try again in a minute.");
  if (!res.ok) throw new HttpError(502, `The AI service returned an error (${res.status}).`);

  const body: any = await res.json();
  const text: string | undefined = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new HttpError(502, "The AI returned an empty answer.");
  try {
    return {
      data: JSON.parse(text) as T,
      tokensIn: body?.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: body?.usageMetadata?.candidatesTokenCount ?? 0,
    };
  } catch {
    throw new HttpError(502, "The AI returned an unreadable answer.");
  }
}

/** Resolves the key, enforces the monthly quota on the platform key, calls, records usage. */
export async function askGemini<T>(
  orgId: string,
  kind: string,
  opts: { system?: string; prompt: string; schema: object },
): Promise<T> {
  const k = await resolveGemini(orgId);
  if (!k) throw new HttpError(503, "AI isn't configured. Add a Gemini key in Settings, or ask your admin.");

  if (k.source === "platform") {
    const [{ n }] = await query<{ n: string }>(
      "select count(*)::text as n from ai_usage where organization_id = $1 and source = 'platform' and created_at >= date_trunc('month', now())",
      [orgId],
    );
    if (Number(n) >= MONTHLY_LIMIT) {
      throw new HttpError(429, `You've used your ${MONTHLY_LIMIT} included AI requests this month. Add your own Gemini key in Settings or upgrade.`);
    }
  }
  const out = await callGemini<T>(k, opts);
  await query(
    "insert into ai_usage (organization_id, kind, source, tokens_in, tokens_out) values ($1,$2,$3,$4,$5)",
    [orgId, kind, k.source, out.tokensIn, out.tokensOut],
  ).catch(() => undefined); // metering must never fail the request
  return out.data;
}

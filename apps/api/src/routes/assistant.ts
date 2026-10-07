import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { askAIChat, type ChatTurn } from "../services/gemini";
import { getOrgTier } from "../services/billing";
import { APP_GUIDE, ASSISTANT_PERSONA } from "../services/assistantGuide";
import { HttpError } from "../utils/http";
import { recordEvent } from "../services/errorLog";

export const assistantRouter = Router();
assistantRouter.use(requireAuth);

const askSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  productVariantId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  /** The app route the user is looking at, e.g. /app/pricing. Used only as context. */
  page: z.string().max(200).optional(),
});

const STOP_WORDS = new Set([
  "a", "about", "and", "are", "for", "from", "give", "how", "i", "is", "it", "me", "my", "of",
  "on", "please", "show", "tell", "the", "there", "this", "to", "what", "which", "with", "you",
]);

function formatMoney(cents: number | string | null, currency: string) {
  if (cents === null) return "not set";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(cents) / 100);
  } catch {
    return `${(Number(cents) / 100).toFixed(2)} ${currency}`;
  }
}

function stockLabel(quantity: number, reorderLevel: number) {
  if (quantity <= 0) return "out of stock";
  if (quantity <= reorderLevel) return "low stock";
  return "healthy stock";
}

function answerPortfolio(question: string, products: any[]) {
  const out = products.filter((p) => p.quantity <= 0);
  const low = products.filter((p) => p.quantity > 0 && p.quantity <= p.reorder_level);
  const healthy = products.length - out.length - low.length;
  const summary = `Your catalog has ${products.length} product${products.length === 1 ? "" : "s"}: ${out.length} out of stock, ${low.length} low, and ${healthy} healthy.`;
  const wantsStock = /stock|inventory|catalog|product|sku|reorder/i.test(question);
  if (!wantsStock || products.length === 0) {
    return `${summary}${products.length ? " Ask about a product by name or SKU for its price, cost, margin, stock, or competitor prices." : " Add products in Inventory to get started."}`;
  }
  const rows = products.slice(0, 5).map((p) =>
    `${p.product_name} (${p.sku}): ${p.quantity} on hand, ${stockLabel(p.quantity, p.reorder_level)}.`,
  );
  return `${summary}\n${rows.join("\n")}${products.length > rows.length ? `\nShowing 5 of ${products.length} products.` : ""}`;
}

function answerProduct(question: string, product: any, competitors: any[]) {
  const cost = Number(product.cost_cents);
  const price = product.price_cents === null ? null : Number(product.price_cents);
  const margin = price && price > 0 ? ((price - cost) / price) * 100 : null;
  const stock = `${product.quantity} on hand (${stockLabel(product.quantity, product.reorder_level)}, reorder at ${product.reorder_level})`;
  const pricing = `Cost ${formatMoney(cost, product.currency)}; selling price ${formatMoney(price, product.currency)}${margin === null ? "" : `; gross margin ${margin.toFixed(1)}%`}.`;
  const competitorText = competitors.length
    ? competitors.map((c) => `${c.competitor_name}: ${formatMoney(c.price_cents, c.currency)}${c.validation_flag === "out_of_band" ? " (flagged out of band)" : ""}`).join("; ")
    : "No competitor prices recorded yet.";
  if (/competitor|compare|market/i.test(question)) {
    return `${product.product_name} (${product.sku}): ${competitorText}`;
  }
  if (/stock|inventory|on hand|reorder|quantity/i.test(question)) {
    return `${product.product_name} (${product.sku}) has ${stock}.`;
  }
  if (/margin|profit|cost|price|selling/i.test(question)) {
    return `${product.product_name} (${product.sku}): ${pricing}`;
  }
  return `${product.product_name} (${product.sku}): ${pricing} Stock: ${stock}. ${competitorText}`;
}


function buildWorkspaceContext(opts: {
  inventory: any[];
  selected: any[];
  competitorsByVariant: Map<string, any[]>;
  page?: string;
  role: string;
  tier: string;
  tierStatus: string;
}) {
  const { inventory, selected, competitorsByVariant } = opts;
  const money = (cents: number | string | null, currency: string) => formatMoney(cents, currency);
  const marginOf = (p: any) => {
    const price = p.price_cents === null ? null : Number(p.price_cents);
    return price && price > 0 ? ((price - Number(p.cost_cents)) / price) * 100 : null;
  };
  const line = (p: any) => {
    const m = marginOf(p);
    return `${p.product_name} | SKU ${p.sku} | ${p.category} | cost ${money(p.cost_cents, p.currency)} | price ${money(p.price_cents, p.currency)}` +
      ` | margin ${m === null ? "n/a" : `${m.toFixed(1)}%`} | ${p.quantity} on hand, reorder at ${p.reorder_level} (${stockLabel(p.quantity, p.reorder_level)})`;
  };

  const out = inventory.filter((p) => p.quantity <= 0);
  const low = inventory.filter((p) => p.quantity > 0 && p.quantity <= p.reorder_level);
  const withMargin = inventory.map((p) => ({ p, m: marginOf(p) })).filter((e) => e.m !== null) as { p: any; m: number }[];
  const avgMargin = withMargin.length ? withMargin.reduce((t, e) => t + e.m, 0) / withMargin.length : null;
  const lowestMargin = [...withMargin].sort((a, b) => a.m - b.m).slice(0, 5).map((e) => e.p);
  const unpriced = inventory.filter((p) => p.price_cents === null).length;

  const parts: string[] = [
    `User role: ${opts.role}. Plan: ${opts.tier} (${opts.tierStatus}). User is currently on page: ${opts.page || "unknown"}.`,
    `Catalog: ${inventory.length} products${inventory.length >= 500 ? " (list capped at 500)" : ""}; ${out.length} out of stock; ${low.length} low stock; ${unpriced} without a selling price; average margin ${avgMargin === null ? "n/a" : `${avgMargin.toFixed(1)}%`}.`,
  ];
  if (out.length) parts.push(`Out of stock:\n${out.slice(0, 10).map(line).join("\n")}`);
  if (low.length) parts.push(`Low stock:\n${low.slice(0, 10).map(line).join("\n")}`);
  if (lowestMargin.length) parts.push(`Lowest margins:\n${lowestMargin.map(line).join("\n")}`);
  if (selected.length) {
    parts.push(
      `Products matching the question:\n` +
        selected.map((p) => {
          const comps = competitorsByVariant.get(p.variant_id) ?? [];
          const ctext = comps.length
            ? comps.map((c) => `${c.competitor_name} ${money(c.price_cents, c.currency)}${c.validation_flag && c.validation_flag !== "ok" ? ` [${c.validation_flag}]` : ""}${c.observed_at ? ` (checked ${new Date(c.observed_at).toISOString().slice(0, 10)})` : ""}`).join("; ")
            : "none recorded";
          return `${line(p)}\n   competitor prices: ${ctext}`;
        }).join("\n"),
    );
  }
  if (inventory.length) {
    parts.push(`Product list (first 40):\n${inventory.slice(0, 40).map(line).join("\n")}`);
  } else {
    parts.push("The workspace has no products yet (Inventory > Add product or Import CSV).");
  }
  return parts.join("\n\n");
}

async function aiAnswer(opts: {
  orgId: string;
  conversationId: string;
  question: string;
  context: string;
}): Promise<string> {
  const prior = await query<{ role: string; content: string }>(
    `select role, content from (
       select role, content, created_at from ai_messages
        where conversation_id = $1 order by created_at desc limit 11
     ) m order by created_at asc`,
    [opts.conversationId],
  );
  // The current question was already inserted; drop it from history and re-append with context.
  const history: ChatTurn[] = prior
    .slice(0, -1)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  while (history.length && history[0].role !== "user") history.shift();

  const system = `${ASSISTANT_PERSONA}\n\n<APP_GUIDE>\n${APP_GUIDE}\n</APP_GUIDE>`;
  const final: ChatTurn = {
    role: "user",
    content: `<WORKSPACE_DATA>\n${opts.context}\n</WORKSPACE_DATA>\n\nUser question:\n${opts.question}`,
  };
  // Merge consecutive same-role turns defensively (the API requires alternation).
  const turns: ChatTurn[] = [];
  for (const t of [...history, final]) {
    const last = turns[turns.length - 1];
    if (last && last.role === t.role) last.content += `\n\n${t.content}`;
    else turns.push({ ...t });
  }
  return askAIChat(opts.orgId, "assistant", { system, messages: turns });
}

assistantRouter.post("/ask", async (req, res) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { question, productVariantId, conversationId, page } = parsed.data;
  const { organizationId, id: userId, role } = req.user!;

  const client = await pool.connect();
  try {
    let activeConversationId = conversationId;
    if (activeConversationId) {
      const existing = await client.query(
        `select id from ai_conversations where id = $1 and organization_id = $2 and user_id = $3`,
        [activeConversationId, organizationId, userId],
      );
      if (!existing.rowCount) return res.status(404).json({ error: "Conversation not found." });
    } else {
      const [conversation] = (await client.query(
        `insert into ai_conversations (organization_id, user_id, product_variant_id)
         values ($1, $2, $3) returning id`,
        [organizationId, userId, productVariantId ?? null],
      )).rows;
      activeConversationId = conversation.id;
    }

    await client.query(
      `insert into ai_messages (conversation_id, role, content) values ($1, 'user', $2)`,
      [activeConversationId, question],
    );

    const inventory = await query(
      `select v.id as variant_id, v.sku, p.name as product_name, coalesce(p.category, 'Other') as category,
              v.unit_cost_cents as cost_cents, v.current_price_cents as price_cents, v.currency,
              coalesce(sum(il.on_hand), 0)::int as quantity,
              coalesce(max(il.reorder_point), 0)::int as reorder_level
         from product_variants v
         join products p on p.id = v.product_id
         left join inventory_levels il on il.product_variant_id = v.id
        where p.organization_id = $1 and p.deleted_at is null and v.deleted_at is null
          and ($2::uuid is null or v.id = $2::uuid)
        group by v.id, p.id
        order by p.created_at desc, p.name, v.sku
        limit 500`,
      [organizationId, productVariantId ?? null],
    );

    const terms = question.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 1 && !STOP_WORDS.has(word)) ?? [];
    const ranked = inventory
      .map((product: any) => {
        const searchable = `${product.sku} ${product.product_name} ${product.category}`.toLowerCase();
        const score = terms.reduce((total, term) => total + (searchable.includes(term) ? (product.sku.toLowerCase() === term ? 3 : 1) : 0), 0);
        return { product, score };
      })
      .filter((entry: { product: any; score: number }) => entry.score > 0)
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score);

    let selected = productVariantId
      ? inventory
      : ranked.length > 0
        ? ranked.filter((entry: { score: number }) => entry.score === ranked[0].score).map((entry: { product: any }) => entry.product)
        : [];
    if (selected.length > 5) selected = selected.slice(0, 5);

    if (productVariantId && selected.length === 0) {
      return res.status(404).json({ error: "Product not found in this workspace." });
    }

    const competitorsByVariant = new Map<string, any[]>();
    if (selected.length) {
      const rows = await query(
        `select distinct on (cp.id) cp.product_variant_id, cp.competitor_name, ps.price_cents, ps.currency,
                ps.validation_flag, ps.observed_at
           from competitor_products cp
           join scraping_sources ss on ss.id = cp.scraping_source_id
           join price_snapshots ps on ps.competitor_product_id = cp.id
          where cp.product_variant_id = any($1::uuid[]) and ss.organization_id = $2
          order by cp.id, ps.observed_at desc`,
        [selected.map((p: any) => p.variant_id), organizationId],
      );
      for (const r of rows as any[]) {
        const list = competitorsByVariant.get(r.product_variant_id) ?? [];
        list.push(r);
        competitorsByVariant.set(r.product_variant_id, list);
      }
    }

    // Rule-based answer: used as the fallback when no AI provider is available.
    let answer: string;
    let referencedRecords: Record<string, unknown>;
    if (selected.length === 1) {
      answer = answerProduct(question, selected[0], competitorsByVariant.get(selected[0].variant_id) ?? []);
      referencedRecords = { variantIds: [selected[0].variant_id], source: "products, inventory, and competitor snapshots" };
    } else if (selected.length > 1) {
      answer = selected.map((product: any) => `${product.product_name} (${product.sku}): ${product.quantity} on hand, ${stockLabel(product.quantity, product.reorder_level)}.`).join("\n");
      referencedRecords = { variantIds: selected.map((product: any) => product.variant_id), source: "products and inventory" };
    } else {
      answer = answerPortfolio(question, inventory);
      referencedRecords = { source: "workspace product and inventory records" };
    }

    let usedAi = false;
    try {
      const tierState = await getOrgTier(organizationId).catch(() => ({ tier: "unknown", status: "unknown" }) as any);
      const context = buildWorkspaceContext({
        inventory, selected, competitorsByVariant, page, role,
        tier: tierState.effectiveTier ?? tierState.tier, tierStatus: tierState.status,
      });
      answer = await aiAnswer({ orgId: organizationId, conversationId: activeConversationId!, question, context });
      usedAi = true;
      referencedRecords = { ...referencedRecords, source: "your workspace data and the Marginview guide" };
    } catch (err) {
      // Quota, missing key, or provider outage must not break the assistant: keep the rule-based answer.
      const reason = err instanceof HttpError ? err.message : "The AI service is unavailable.";
      void recordEvent({
        source: "ai",
        level: err instanceof HttpError ? "warn" : "error",
        message: `Assistant fell back to rule-based answer: ${(err as Error)?.message ?? String(err)}`,
        stack: (err as Error)?.stack,
        path: "/api/assistant/ask",
        userId,
        organizationId,
      });
      referencedRecords = { ...referencedRecords, aiUnavailable: reason };
      answer = `${answer}\n\n(Smart answers are unavailable right now: ${reason})`;
    }
    referencedRecords = { ...referencedRecords, ai: usedAi };

    await client.query(
      `insert into ai_messages (conversation_id, role, content, referenced_records) values ($1, 'assistant', $2, $3)`,
      [activeConversationId, answer, referencedRecords],
    );

    res.json({ conversationId: activeConversationId, answer, referencedRecords });
  } finally {
    client.release();
  }
});

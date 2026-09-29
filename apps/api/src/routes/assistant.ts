import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../db/pool";
import { requireAuth } from "../middleware/auth";

export const assistantRouter = Router();
assistantRouter.use(requireAuth);

const askSchema = z.object({
  question: z.string().min(1),
  productVariantId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
});

/**
 * Phase 3 (per the Implementation Plan) replaces the body of this handler
 * with a real retrieval-augmented call to an LLM provider, per TRD section 5:
 * gather the product's latest price snapshots, inventory position, and
 * price-change history, assemble them into a context block, and ask the
 * model to answer only from that context.
 *
 * For now this stub does the retrieval step for real and returns it
 * directly, so the frontend and the data shape are already correct when
 * the LLM call is dropped in.
 */
assistantRouter.post("/ask", async (req, res) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { question, productVariantId } = parsed.data;

  const client = await pool.connect();
  try {
    const [conversation] = (await client.query(
      `insert into ai_conversations (organization_id, user_id, product_variant_id)
       values ($1, $2, $3) returning id`,
      [req.user!.organizationId, req.user!.id, productVariantId ?? null]
    )).rows;

    await client.query(
      `insert into ai_messages (conversation_id, role, content) values ($1, 'user', $2)`,
      [conversation.id, question]
    );

    let answer =
      "I do not have enough data to answer that yet. Ask about a specific product's price, stock, or margin.";
    let referencedRecords: Record<string, unknown> | null = null;

    if (productVariantId) {
      const [context] = await query(
        `select v.sku, v.unit_cost_cents, v.current_price_cents, il.on_hand, il.reorder_point
         from product_variants v
         left join inventory_levels il on il.product_variant_id = v.id
         where v.id = $1
         limit 1`,
        [productVariantId]
      );
      if (context) {
        answer = `${context.sku}: current price is ${context.current_price_cents} against a unit cost of ${context.unit_cost_cents}, with ${context.on_hand} units on hand (reorder point ${context.reorder_point}).`;
        referencedRecords = { productVariantId, source: "product_variants, inventory_levels" };
      }
    }

    await client.query(
      `insert into ai_messages (conversation_id, role, content, referenced_records) values ($1, 'assistant', $2, $3)`,
      [conversation.id, answer, referencedRecords]
    );

    res.json({ conversationId: conversation.id, answer, referencedRecords });
  } finally {
    client.release();
  }
});

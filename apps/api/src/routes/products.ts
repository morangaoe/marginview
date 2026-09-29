import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool";
import { requireAuth } from "../middleware/auth";

export const productsRouter = Router();
productsRouter.use(requireAuth);

productsRouter.get("/", async (req, res) => {
  const products = await query(
    `select p.id, p.name, p.category,
            v.id as variant_id, v.sku, v.unit_cost_cents, v.currency, v.current_price_cents
     from products p
     join product_variants v on v.product_id = p.id
     where p.organization_id = $1 and p.deleted_at is null and v.deleted_at is null
     order by p.name`,
    [req.user!.organizationId]
  );
  res.json(products);
});

const createSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  sku: z.string().min(1),
  unitCostCents: z.number().int().nonnegative(),
  currency: z.string().length(3).default("USD"),
  currentPriceCents: z.number().int().nonnegative().optional(),
});

productsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, category, sku, unitCostCents, currency, currentPriceCents } = parsed.data;

  const [product] = await query<{ id: string }>(
    `insert into products (organization_id, name, category) values ($1, $2, $3) returning id`,
    [req.user!.organizationId, name, category ?? null]
  );
  const [variant] = await query(
    `insert into product_variants (product_id, sku, unit_cost_cents, currency, current_price_cents)
     values ($1, $2, $3, $4, $5) returning id, sku`,
    [product.id, sku, unitCostCents, currency, currentPriceCents ?? null]
  );
  res.status(201).json({ productId: product.id, variant });
});

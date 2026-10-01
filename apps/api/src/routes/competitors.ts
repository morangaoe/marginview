import { Router } from "express";
import { pool } from "../db/pool";
import { HttpError, orgIdOf, wrap } from "../utils/http";

const router = Router();

async function assertVariantInOrg(variantId: string, orgId: string) {
  const r = await pool.query(
    `select 1 from product_variants pv join products p on p.id = pv.product_id
      where pv.id = $1 and p.organization_id = $2 and pv.deleted_at is null`,
    [variantId, orgId],
  );
  if (!r.rowCount) throw new HttpError(404, "Product not found.");
}

router.get(
  "/",
  wrap(async (req, res) => {
    const orgId = orgIdOf(req);
    const variantId = String(req.query.variantId ?? "");
    await assertVariantInOrg(variantId, orgId);
    const r = await pool.query(
      `select cp.id, cp.competitor_name as "competitorName", ss.id as "sourceId", ss.url,
              ss.compliance_status as "complianceStatus", snap.price_cents as "lastPriceCents", snap.observed_at as "lastScrapedAt"
         from competitor_products cp
         join scraping_sources ss on ss.id = cp.scraping_source_id
         left join lateral (select price_cents, observed_at from price_snapshots
                             where competitor_product_id = cp.id order by observed_at desc limit 1) snap on true
        where cp.product_variant_id = $1 and ss.organization_id = $2
        order by cp.created_at`,
      [variantId, orgId],
    );
    res.json({ targets: r.rows });
  }),
);

/** POST /api/competitors { variantId, competitorName, url } */
router.post(
  "/",
  wrap(async (req, res) => {
    const orgId = orgIdOf(req);
    const { variantId, competitorName, url } = req.body ?? {};
    let parsed: URL;
    try {
      parsed = new URL(String(url));
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
    } catch {
      throw new HttpError(400, "Enter a valid http(s) product URL.");
    }
    await assertVariantInOrg(String(variantId), orgId);
    const name = String(competitorName ?? "").trim() || parsed.hostname.replace(/^www\./, "");

    const client = await pool.connect();
    try {
      await client.query("begin");
      const src = await client.query(
        `insert into scraping_sources (organization_id, url) values ($1, $2)
         on conflict (organization_id, url) do update set updated_at = now() returning id`,
        [orgId, parsed.toString()],
      );
      const cp = await client.query(
        `insert into competitor_products (product_variant_id, scraping_source_id, competitor_name)
         values ($1, $2, $3)
         on conflict (product_variant_id, scraping_source_id) do update set competitor_name = excluded.competitor_name
         returning id`,
        [variantId, src.rows[0].id, name],
      );
      await client.query("commit");
      res.status(201).json({ id: cp.rows[0].id, sourceId: src.rows[0].id });
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }),
);

router.delete(
  "/:id",
  wrap(async (req, res) => {
    const r = await pool.query(
      `delete from competitor_products cp using product_variants pv, products p
        where cp.id = $1 and pv.id = cp.product_variant_id and p.id = pv.product_id and p.organization_id = $2`,
      [req.params.id, orgIdOf(req)],
    );
    if (!r.rowCount) throw new HttpError(404, "Competitor not found.");
    res.json({ ok: true });
  }),
);

export default router;

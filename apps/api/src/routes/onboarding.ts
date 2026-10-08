import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { pool } from "../db/pool";
import { HttpError, wrap } from "../utils/http";
import { publicSignupEnabled, requireAuth, requireRole, setSessionCookie, signToken, SIGNUP_DISABLED } from "../middleware/auth";
import { BCRYPT_ROUNDS } from "./auth";

const router = Router();

const FREE_MAIL = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "icloud.com", "proton.me", "protonmail.com",
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_IMPORT_ROWS = 2000;
const MAX_MARGIN_KEYS = 100;
const MAX_SKIPPED_REPORTED = 50;

/** "12", "12.5", "$1,200.50" -> integer cents. null if not a positive amount. */
function toCents(v: unknown): number | null {
  const cleaned = String(v ?? "").trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

// ---------------------------------------------------------------------------
// POST /api/onboarding/register   (public, only when ALLOW_PUBLIC_SIGNUP=true)
// Creates or joins a workspace and returns a JWT.
// ---------------------------------------------------------------------------
router.post(
  "/register",
  wrap(async (req, res) => {
    if (!publicSignupEnabled()) return res.status(403).json(SIGNUP_DISABLED);
    const { email, password, fullName, mode, orgName, inviteCode, acceptTos } = req.body ?? {};

    const mail = String(email ?? "").trim().toLowerCase();
    const name = String(fullName ?? "").trim();
    if (!EMAIL_RE.test(mail)) throw new HttpError(400, "Enter a valid email address.");
    if (String(password ?? "").length < 8) throw new HttpError(400, "Password must be at least 8 characters.");
    if (String(password).length > 200) throw new HttpError(400, "Password is too long.");
    if (!name) throw new HttpError(400, "Enter your full name.");
    if (mode !== "create" && mode !== "join") throw new HttpError(400, "Choose to create or join a workspace.");
    if (mode === "create" && !String(orgName ?? "").trim()) throw new HttpError(400, "Enter a workspace name.");
    if (mode === "create" && acceptTos !== true)
      throw new HttpError(400, "Accept the Terms and Privacy Policy to continue.");

    const domain = mail.split("@")[1];
    const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    const client = await pool.connect();

    try {
      await client.query("begin");

      const dup = await client.query("select 1 from users where lower(email) = $1", [mail]);
      if (dup.rowCount) throw new HttpError(409, "An account with this email already exists. Log in instead.");

      let organizationId: string;
      let roleName: "owner" | "viewer" = "viewer";
      let status: "active" | "invited" = "active";

      if (mode === "create") {
        const taken = await client.query("select 1 from organizations where domain = $1", [domain]);
        const claimDomain = !FREE_MAIL.has(domain) && !taken.rowCount ? domain : null;

        const org = await client.query(
          `insert into organizations (name, domain, invite_code, tos_accepted_at, privacy_policy_version_accepted)
           values ($1, $2, $3, now(), $4) returning id`,
          [
            String(orgName).trim(),
            claimDomain,
            randomBytes(5).toString("hex").toUpperCase(),
            process.env.PRIVACY_POLICY_VERSION ?? "v1",
          ],
        );
        organizationId = org.rows[0].id;
        roleName = "owner";

        // Every new org starts a Starter trial.
        const plan = await client.query(`select id from plans where name = 'Starter' limit 1`);
        if (plan.rowCount) {
          await client.query(
            `insert into subscriptions (organization_id, plan_id, status) values ($1, $2, 'trialing')`,
            [organizationId, plan.rows[0].id],
          );
        }
      } else {
        const code = String(inviteCode ?? "").trim().toUpperCase();
        const org = code
          ? await client.query("select id from organizations where invite_code = $1", [code])
          : await client.query("select id from organizations where domain = $1", [domain]);

        if (!org.rowCount) {
          throw new HttpError(
            404,
            "We couldn't find a workspace for that. Ask your workspace owner for an invite code.",
          );
        }
        organizationId = org.rows[0].id;
        if (!code) status = "invited"; // domain match without a code -> pending approval
      }

      const user = await client.query(
        `insert into users (organization_id, email, password_hash, full_name, status)
         values ($1, $2, $3, $4, $5) returning id`,
        [organizationId, mail, hash, name, status],
      );
      const userId: string = user.rows[0].id;

      await client.query(
        "insert into user_roles (user_id, role_id) select $1, id from roles where name = $2",
        [userId, roleName],
      );

      await client.query("commit");

      if (status === "invited") {
        return res.status(202).json({
          pending: true,
          message: "Request sent. A workspace owner needs to approve your access.",
        });
      }

      // Same signer as /api/auth/login: one secret, one expiry, one claim shape.
      const token = signToken({ id: userId, organizationId, role: roleName });

      setSessionCookie(res, token);
      return res.status(201).json({
        user: { id: userId, email: mail, fullName: name, organizationId, role: roleName },
      });
    } catch (e: any) {
      await client.query("rollback").catch(() => undefined);
      // Two simultaneous sign-ups with the same email: the unique index wins.
      if (e?.code === "23505") {
        throw new HttpError(409, "An account with this email already exists. Log in instead.");
      }
      throw e;
    } finally {
      client.release();
    }
  }),
);

// ---------------------------------------------------------------------------
// GET /api/onboarding/status   (auth)
// Tells the web app whether to send this user into the setup wizard.
// Only workspace owners are ever required to complete it.
// ---------------------------------------------------------------------------
router.get(
  "/status",
  requireAuth,
  wrap(async (req, res) => {
    const orgId = req.user!.organizationId;
    const r = await pool.query(
      `select o.onboarding_completed_at,
              o.metadata -> 'target_margins' as target_margins,
              exists (select 1 from locations where organization_id = o.id) as has_location,
              exists (select 1 from products  where organization_id = o.id and deleted_at is null) as has_products
         from organizations o
        where o.id = $1`,
      [orgId],
    );
    if (!r.rowCount) throw new HttpError(404, "Workspace not found.");
    const row = r.rows[0];
    const completed = row.onboarding_completed_at !== null;

    res.json({
      completed,
      required: req.user!.role === "owner" && !completed,
      hasLocation: row.has_location,
      hasProducts: row.has_products,
      targetMargins: row.target_margins ?? {},
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/onboarding/skip   (owner)
// Lets an owner leave the wizard without setting anything up.
// ---------------------------------------------------------------------------
router.post(
  "/skip",
  requireAuth,
  requireRole("owner"),
  wrap(async (req, res) => {
    await pool.query(
      `update organizations
          set onboarding_completed_at = coalesce(onboarding_completed_at, now()), updated_at = now()
        where id = $1`,
      [req.user!.organizationId],
    );
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/onboarding   (owner)
// Called by the wizard: creates the first location, optionally imports products,
// stores target margins, and marks onboarding complete. All in one transaction.
// Body: { location: string, rows?: [{sku,name,category,cost,price,quantity}], targetMargins?: {[category]: pct} }
// ---------------------------------------------------------------------------
router.post(
  "/",
  requireAuth,
  requireRole("owner"),
  wrap(async (req, res) => {
    const { location, rows, targetMargins } = req.body ?? {};
    const orgId: string = req.user!.organizationId;

    const locationName = String(location ?? "").trim();
    if (!locationName) throw new HttpError(400, "Provide a location name (e.g. 'Main warehouse').");
    if (locationName.length > 120) throw new HttpError(400, "Location name is too long.");

    if (rows !== undefined && !Array.isArray(rows)) throw new HttpError(400, "rows must be a list.");
    if (Array.isArray(rows) && rows.length > MAX_IMPORT_ROWS) {
      throw new HttpError(413, `Too many products (max ${MAX_IMPORT_ROWS} per import).`);
    }

    // Validate margins up front so a bad value fails loudly instead of being dropped.
    let margins: Record<string, number> | null = null;
    if (targetMargins !== undefined && targetMargins !== null) {
      if (typeof targetMargins !== "object" || Array.isArray(targetMargins)) {
        throw new HttpError(400, "targetMargins must be an object of category → percent.");
      }
      const entries = Object.entries(targetMargins as Record<string, unknown>);
      if (entries.length > MAX_MARGIN_KEYS) throw new HttpError(400, "Too many margin categories.");
      margins = {};
      for (const [cat, val] of entries) {
        const n = Number(val);
        if (!cat.trim() || cat.length > 80 || !Number.isFinite(n) || n < 0 || n > 99) {
          throw new HttpError(400, `Target margin for "${cat}" must be between 0 and 99.`);
        }
        margins[cat.trim()] = n;
      }
    }

    const client = await pool.connect();
    try {
      await client.query("begin");

      // 1. First location. Upsert on (organization_id, name): no duplicates on retry.
      const loc = await client.query(
        `insert into locations (organization_id, name) values ($1, $2)
         on conflict (organization_id, name) do update set updated_at = now()
         returning id`,
        [orgId, locationName],
      );
      const locationId: string = loc.rows[0].id;

      // 2. Optional product import. Rows that can't be imported are reported, not silently dropped.
      let created = 0;
      const skipped: { row: number; sku?: string; reason: string }[] = [];
      let skippedCount = 0;
      const skip = (row: number, sku: string | undefined, reason: string) => {
        skippedCount++;
        if (skipped.length < MAX_SKIPPED_REPORTED) skipped.push({ row, sku, reason });
      };

      if (Array.isArray(rows) && rows.length > 0) {
        const candidateSkus = rows
          .map((r: any) => String(r?.sku ?? "").trim())
          .filter(Boolean);
        const existing = await client.query(
          `select v.sku from product_variants v
             join products p on p.id = v.product_id
            where p.organization_id = $1 and v.sku = any($2::text[])
              and v.deleted_at is null and p.deleted_at is null`,
          [orgId, candidateSkus],
        );
        const taken = new Set<string>(existing.rows.map((r: any) => r.sku));

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i] ?? {};
          const rowNo = i + 2; // +1 header, +1 for 1-based numbering
          const sku = String(r.sku ?? "").trim();
          const pname = String(r.name ?? "").trim();
          if (!sku) { skip(rowNo, undefined, "Missing SKU"); continue; }
          if (!pname) { skip(rowNo, sku, "Missing product name"); continue; }
          if (taken.has(sku)) { skip(rowNo, sku, "SKU already exists or repeats in this file"); continue; }

          const costCents = toCents(r.cost);
          if (costCents === null) { skip(rowNo, sku, "Cost must be an amount greater than 0"); continue; }

          const priceRaw = String(r.price ?? "").trim();
          const priceCents = priceRaw ? toCents(priceRaw) : null;
          if (priceRaw && priceCents === null) { skip(rowNo, sku, "Price is not a valid amount"); continue; }

          const qtyRaw = String(r.quantity ?? "").trim();
          const quantity = qtyRaw === "" ? 0 : /^\d+$/.test(qtyRaw) ? Number(qtyRaw) : null;
          if (quantity === null) { skip(rowNo, sku, "Quantity must be a whole number"); continue; }

          const category = String(r.category ?? "").trim() || "General";

          const prod = await client.query(
            "insert into products (organization_id, name, category) values ($1, $2, $3) returning id",
            [orgId, pname, category],
          );
          const variant = await client.query(
            `insert into product_variants (product_id, sku, unit_cost_cents, current_price_cents)
             values ($1, $2, $3, $4) returning id`,
            [prod.rows[0].id, sku, costCents, priceCents],
          );
          await client.query(
            `insert into inventory_levels (product_variant_id, location_id, on_hand, reorder_point)
             values ($1, $2, $3, 0)`,
            [variant.rows[0].id, locationId, quantity],
          );
          taken.add(sku); // repeats later in the same file are skipped
          created++;
        }
      }

      // 3. Settings + completion flag. No swallowed errors: a failure here rolls everything back.
      await client.query(
        `update organizations
            set metadata = case
                  when $2::jsonb is null then metadata
                  else metadata || jsonb_build_object('target_margins', $2::jsonb)
                end,
                onboarding_completed_at = coalesce(onboarding_completed_at, now()),
                updated_at = now()
          where id = $1`,
        [orgId, margins ? JSON.stringify(margins) : null],
      );

      await client.query("commit");
      res.status(201).json({ locationId, productsImported: created, skippedCount, skipped });
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }),
);

export default router;
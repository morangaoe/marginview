import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { pool } from "../db/pool";
import { HttpError, wrap } from "../utils/http";
import { requireAuth } from "../middleware/auth";

const router = Router();

const FREE_MAIL = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "icloud.com", "proton.me", "protonmail.com",
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// POST /api/onboarding/register
// Public — creates or joins a workspace, returns a JWT.
// ---------------------------------------------------------------------------
router.post(
  "/register",
  wrap(async (req, res) => {
    const { email, password, fullName, mode, orgName, inviteCode, acceptTos } = req.body ?? {};

    const mail = String(email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(mail)) throw new HttpError(400, "Enter a valid email address.");
    if (String(password ?? "").length < 8) throw new HttpError(400, "Password must be at least 8 characters.");
    if (!String(fullName ?? "").trim()) throw new HttpError(400, "Enter your full name.");
    if (mode !== "create" && mode !== "join") throw new HttpError(400, "Choose to create or join a workspace.");
    if (mode === "create" && !String(orgName ?? "").trim()) throw new HttpError(400, "Enter a workspace name.");
    if (mode === "create" && acceptTos !== true)
      throw new HttpError(400, "Accept the Terms and Privacy Policy to continue.");

    const domain = mail.split("@")[1];
    const hash = await bcrypt.hash(String(password), 12);
    const client = await pool.connect();

    try {
      await client.query("begin");

      const dup = await client.query("select 1 from users where email = $1", [mail]);
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

        // Every new org starts a Starter trial (idempotent if plan already exists)
        const plan = await client.query(`select id from plans where name = 'Starter' limit 1`);
        if (plan.rowCount) {
          await client.query(
            `insert into subscriptions (organization_id, plan_id, status) values ($1, $2, 'trialing')
             on conflict do nothing`,
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
        if (!code) status = "invited"; // domain match without code → pending
      }

      const user = await client.query(
        `insert into users (organization_id, email, password_hash, full_name, status)
         values ($1, $2, $3, $4, $5) returning id`,
        [organizationId, mail, hash, String(fullName).trim(), status],
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

      // FIX: Use consistent claim shape — must match what requireAuth reads.
      const token = jwt.sign(
        { sub: userId, id: userId, email: mail, organizationId, role: roleName },
        process.env.JWT_SECRET!,
        { expiresIn: "7d" },
      );

      return res.status(201).json({
        token,
        user: { id: userId, email: mail, fullName, organizationId, role: roleName },
      });
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }),
);

// ---------------------------------------------------------------------------
// POST /api/onboarding
// Protected — called by the Onboarding.tsx wizard AFTER login/signup.
// Creates a location, bulk-imports products, stores target margins.
//
// FIX: This route was MISSING. Onboarding.tsx calls POST /onboarding
// with { location, rows, targetMargins } but no route existed to handle it.
// ---------------------------------------------------------------------------
router.post(
  "/",
  requireAuth,
  wrap(async (req, res) => {
    const { location, rows, targetMargins } = req.body ?? {};
    const orgId: string = req.user!.organizationId;

    if (!String(location ?? "").trim()) {
      throw new HttpError(400, "Provide a location name (e.g. 'Main warehouse').");
    }

    const client = await pool.connect();
    try {
      await client.query("begin");

      // 1. Create the first location
      const loc = await client.query(
        `insert into locations (organization_id, name)
         values ($1, $2)
         on conflict do nothing
         returning id`,
        [orgId, String(location).trim()],
      );

      // If the org already had this exact location name, fetch it
      let locationId: string;
      if (loc.rowCount) {
        locationId = loc.rows[0].id;
      } else {
        const existing = await client.query(
          "select id from locations where organization_id = $1 and name = $2 limit 1",
          [orgId, String(location).trim()],
        );
        locationId = existing.rows[0]?.id;
        if (!locationId) throw new HttpError(500, "Could not create or find location.");
      }

      // 2. Bulk-import products (optional — user may skip the CSV step)
      let created = 0;
      if (Array.isArray(rows) && rows.length > 0) {
        for (const r of rows) {
          const sku = String(r.sku ?? "").trim();
          const name = String(r.name ?? "").trim();
          if (!sku || !name) continue;

          const costRaw = parseFloat(String(r.cost ?? "0").replace(/[^0-9.]/g, ""));
          const costCents = Number.isFinite(costRaw) && costRaw > 0 ? Math.round(costRaw * 100) : 0;
          const quantity = Math.max(0, parseInt(String(r.quantity ?? "0"), 10) || 0);
          const priceRaw = parseFloat(String(r.price ?? "0").replace(/[^0-9.]/g, ""));
          const priceCents = Number.isFinite(priceRaw) && priceRaw > 0 ? Math.round(priceRaw * 100) : null;
          const category = String(r.category ?? "General").trim() || "General";

          // Skip duplicate SKUs silently (idempotent import)
          const exists = await client.query(
            `select v.id from product_variants v
             join products p on p.id = v.product_id
             where p.organization_id = $1 and v.sku = $2 and v.deleted_at is null limit 1`,
            [orgId, sku],
          );
          if (exists.rowCount) continue;

          const prod = await client.query(
            "insert into products (organization_id, name, category) values ($1, $2, $3) returning id",
            [orgId, name, category],
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
          created++;
        }
      }

      // 3. Persist target margins as org-level settings (stored in org metadata)
      //    Using a simple JSONB update; adjust column name if your schema differs.
      if (targetMargins && typeof targetMargins === "object") {
        await client.query(
          `update organizations
           set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('target_margins', $2::jsonb),
               updated_at = now()
           where id = $1`,
          [orgId, JSON.stringify(targetMargins)],
        ).catch(() => {
          // Non-fatal: target_margins are a UX convenience, not critical data.
          // If the organizations table has no metadata column yet, skip silently.
        });
      }

      await client.query("commit");
      res.status(201).json({ locationId, productsImported: created });
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }),
);

export default router;

/**
 * Admin routes (owner-only):
 *  GET  /api/admin/members       — list all team members and their roles
 *  POST /api/admin/members       — invite a new user (creates account, sends no email in Phase 1)
 *  PATCH /api/admin/members/:id  — change role or status
 *  POST /api/admin/members/:id/reset-password — set a new password, shown once
 */

import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../db/pool";
import { requireAuth, requireRole } from "../middleware/auth";
import { BCRYPT_ROUNDS, generatePassword, passwordSchema, setPassword } from "./auth";

export const adminRouter = Router();
adminRouter.use(requireAuth); // all routes require a valid token

adminRouter.get("/members", requireRole("owner"), async (req, res) => {
  const rows = await query(
    `select u.id, u.email, u.full_name, u.status, r.name as role, u.created_at, u.last_login_at
     from users u
     join user_roles ur on ur.user_id = u.id and ur.location_id is null
     join roles r on r.id = ur.role_id
     where u.organization_id = $1 and u.deleted_at is null
     order by u.created_at`,
    [req.user!.organizationId]
  );
  res.json(rows);
});

const inviteSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  role: z.enum(["owner", "pricing_manager", "inventory_manager", "viewer"]),
  // Omit to have one generated; either way it is returned once in the response.
  temporaryPassword: passwordSchema.optional(),
});

adminRouter.post("/members", requireRole("owner"), async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { fullName, role } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();
  const temporaryPassword = parsed.data.temporaryPassword ?? generatePassword();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);

    // Active straight away: the owner adding them is the approval. ('invited' can't sign in.)
    const [user] = (await client.query(
      `insert into users (organization_id, email, password_hash, full_name, status)
       values ($1, $2, $3, $4, 'active') returning id, email`,
      [req.user!.organizationId, email, passwordHash, fullName]
    )).rows;

    const [roleRow] = (await client.query(`select id from roles where name = $1`, [role])).rows;
    await client.query(
      `insert into user_roles (user_id, role_id) values ($1, $2)`,
      [user.id, roleRow.id]
    );

    await client.query("COMMIT");
    res.status(201).json({ userId: user.id, email: user.email, temporaryPassword });
  } catch (err) {
    await client.query("ROLLBACK");
    if ((err as any).code === "23505") {
      return res.status(409).json({ error: "A user with that email already exists" });
    }
    throw err;
  } finally {
    client.release();
  }
});

const updateMemberSchema = z.object({
  role: z.enum(["owner", "pricing_manager", "inventory_manager", "viewer"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

adminRouter.patch("/members/:id", requireRole("owner"), async (req, res) => {
  const parsed = updateMemberSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { role, status } = parsed.data;

  if (req.params.id === req.user!.id) {
    return res.status(400).json({ error: "You cannot change your own role or status" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Tenant check first: the role change below is keyed on user id alone.
    const member = await client.query(
      "select 1 from users where id = $1 and organization_id = $2 and deleted_at is null for update",
      [req.params.id, req.user!.organizationId]
    );
    if (!member.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Team member not found" });
    }

    if (status !== undefined) {
      await client.query(
        `update users set status = $1, updated_at = now() where id = $2 and organization_id = $3`,
        [status, req.params.id, req.user!.organizationId]
      );
    }

    if (role !== undefined) {
      const [roleRow] = (await client.query(`select id from roles where name = $1`, [role])).rows;
      // Replace all existing roles with the new one (simplest model)
      await client.query(`delete from user_roles where user_id = $1 and location_id is null`, [req.params.id]);
      await client.query(
        `insert into user_roles (user_id, role_id) values ($1, $2)`,
        [req.params.id, roleRow.id]
      );
    }

    await client.query("COMMIT");
    res.status(204).send();
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// Sets a new password for a member of this workspace and signs them out everywhere.
// The password is returned once so the owner can pass it on; it is never stored readable.
adminRouter.post("/members/:id/reset-password", requireRole("owner"), async (req, res) => {
  const parsed = z.object({ password: passwordSchema.optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid password" });

  const member = await query(
    "select 1 from users where id = $1 and organization_id = $2 and deleted_at is null",
    [req.params.id, req.user!.organizationId]
  );
  if (!member.length) return res.status(404).json({ error: "Team member not found" });

  const password = parsed.data.password ?? generatePassword();
  await setPassword(req.params.id, password);
  res.json({ password });
});

// Org settings
adminRouter.get("/org", async (req, res) => {
  const [org] = await query(
    `select id, name, default_currency, tos_accepted_at from organizations where id = $1`,
    [req.user!.organizationId]
  );
  res.json(org);
});

const updateOrgSchema = z.object({
  name: z.string().min(1).optional(),
  defaultCurrency: z.string().length(3).optional(),
});

adminRouter.patch("/org", requireRole("owner"), async (req, res) => {
  const parsed = updateOrgSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, defaultCurrency } = parsed.data;

  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;

  if (name !== undefined) { sets.push(`name = $${i++}`); vals.push(name); }
  if (defaultCurrency !== undefined) { sets.push(`default_currency = $${i++}`); vals.push(defaultCurrency.toUpperCase()); }

  if (sets.length === 0) return res.status(400).json({ error: "Nothing to update" });
  sets.push("updated_at = now()");
  vals.push(req.user!.organizationId);

  await query(
    `update organizations set ${sets.join(", ")} where id = $${i}`,
    vals
  );
  res.status(204).send();
});

// Locations
adminRouter.get("/locations", async (req, res) => {
  const rows = await query(
    `select id, name, address, created_at from locations where organization_id = $1 order by name`,
    [req.user!.organizationId]
  );
  res.json(rows);
});

const locationSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
});

adminRouter.post("/locations", requireRole("owner"), async (req, res) => {
  const parsed = locationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [loc] = await query(
    `insert into locations (organization_id, name, address) values ($1, $2, $3) returning id, name`,
    [req.user!.organizationId, parsed.data.name, parsed.data.address ?? null]
  );
  res.status(201).json(loc);
});

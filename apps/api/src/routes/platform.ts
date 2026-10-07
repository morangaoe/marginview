/**
 * Platform operator routes (PLATFORM_ADMIN_EMAILS only). Unlike /api/admin, these
 * span every workspace: accounts, access, and the error log.
 *
 *  GET   /api/platform/overview
 *  GET   /api/platform/organizations
 *  GET   /api/platform/users
 *  POST  /api/platform/users                      — add someone (to an existing or new workspace)
 *  PATCH /api/platform/users/:id                  — role / status
 *  POST  /api/platform/users/:id/reset-password   — new password, shown once
 *  GET   /api/platform/errors                     — issues grouped by fingerprint
 *  GET   /api/platform/errors/:fingerprint        — recent occurrences with stack and context
 *  POST  /api/platform/errors/:fingerprint/resolve
 */
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../db/pool";
import { requireAuth, requirePlatformAdmin } from "../middleware/auth";
import { BCRYPT_ROUNDS, generatePassword, passwordSchema, setPassword } from "./auth";

export const platformRouter = Router();
platformRouter.use(requireAuth, requirePlatformAdmin);

const ROLES = ["owner", "pricing_manager", "inventory_manager", "viewer"] as const;
const uuid = z.string().uuid();

platformRouter.get("/overview", async (_req, res) => {
  const [row] = await query(
    `select
       (select count(*) from organizations)::int as organizations,
       (select count(*) from users where deleted_at is null)::int as users,
       (select count(*) from users where deleted_at is null and status = 'active')::int as active_users,
       (select count(*) from users where last_login_at > now() - interval '7 days')::int as signed_in_7d,
       (select count(distinct fingerprint) from error_events where resolved_at is null and level = 'error')::int as open_errors,
       (select count(*) from error_events where created_at > now() - interval '24 hours' and level = 'error')::int as errors_24h,
       (select count(*) from error_events where created_at > now() - interval '24 hours' and source = 'auth')::int as failed_logins_24h,
       (select count(*) from scraping_job_runs where status = 'failed' and created_at > now() - interval '24 hours')::int as failed_scrapes_24h`
  );
  res.json(row);
});

platformRouter.get("/organizations", async (_req, res) => {
  res.json(
    await query(
      `select o.id, o.name, o.created_at,
              (select count(*) from users u where u.organization_id = o.id and u.deleted_at is null)::int as users,
              (select p.name from subscriptions s join plans p on p.id = s.plan_id
                where s.organization_id = o.id order by s.current_period_end desc nulls last limit 1) as plan
         from organizations o
        order by o.name`
    )
  );
});

platformRouter.get("/users", async (_req, res) => {
  res.json(
    await query(
      `select u.id, u.email, u.full_name, u.status, u.created_at, u.last_login_at,
              o.id as organization_id, o.name as organization_name, r.name as role
         from users u
         join organizations o on o.id = u.organization_id
         left join user_roles ur on ur.user_id = u.id and ur.location_id is null
         left join roles r on r.id = ur.role_id
        where u.deleted_at is null
        order by o.name, u.created_at`
    )
  );
});

const createUserSchema = z
  .object({
    email: z.string().email(),
    fullName: z.string().trim().min(1).max(120),
    role: z.enum(ROLES),
    organizationId: uuid.optional(),
    organizationName: z.string().trim().min(1).max(120).optional(),
    password: passwordSchema.optional(),
  })
  .refine((d) => !!d.organizationId !== !!d.organizationName, {
    message: "Pick an existing workspace or name a new one.",
  });

platformRouter.post("/users", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." });
  const { fullName, role, organizationId, organizationName } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password ?? generatePassword();

  const client = await pool.connect();
  try {
    await client.query("begin");
    let orgId = organizationId;
    if (orgId) {
      const org = await client.query("select 1 from organizations where id = $1", [orgId]);
      if (!org.rowCount) {
        await client.query("rollback");
        return res.status(404).json({ error: "Workspace not found." });
      }
    } else {
      const org = await client.query(
        `insert into organizations (name, invite_code, tos_accepted_at, privacy_policy_version_accepted)
         values ($1, $2, now(), $3) returning id`,
        [organizationName, randomBytes(5).toString("hex").toUpperCase(), process.env.PRIVACY_POLICY_VERSION ?? "v1"]
      );
      orgId = org.rows[0].id as string;
      await client.query(
        `insert into subscriptions (organization_id, plan_id, status)
         select $1, id, 'trialing' from plans where name = 'Starter' limit 1`,
        [orgId]
      );
    }

    const user = await client.query(
      `insert into users (organization_id, email, password_hash, full_name, status)
       values ($1, $2, $3, $4, 'active') returning id`,
      [orgId, email, await bcrypt.hash(password, BCRYPT_ROUNDS), fullName]
    );
    await client.query(
      "insert into user_roles (user_id, role_id) select $1, id from roles where name = $2",
      [user.rows[0].id, role]
    );
    await client.query("commit");
    res.status(201).json({ userId: user.rows[0].id, organizationId: orgId, email, password });
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    if ((err as any).code === "23505") return res.status(409).json({ error: "A user with that email already exists." });
    throw err;
  } finally {
    client.release();
  }
});

const updateUserSchema = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

platformRouter.patch("/users/:id", async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success || !uuid.safeParse(req.params.id).success) return res.status(400).json({ error: "Invalid request." });
  const { role, status } = parsed.data;
  if (req.params.id === req.user!.id) return res.status(400).json({ error: "You cannot change your own account here." });

  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query("select 1 from users where id = $1 and deleted_at is null for update", [req.params.id]);
    if (!found.rowCount) {
      await client.query("rollback");
      return res.status(404).json({ error: "User not found." });
    }
    if (status) {
      await client.query("update users set status = $2, updated_at = now() where id = $1", [req.params.id, status]);
    }
    if (role) {
      await client.query("delete from user_roles where user_id = $1 and location_id is null", [req.params.id]);
      await client.query("insert into user_roles (user_id, role_id) select $1, id from roles where name = $2", [req.params.id, role]);
    }
    await client.query("commit");
    res.status(204).send();
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
});

platformRouter.post("/users/:id/reset-password", async (req, res) => {
  const parsed = z.object({ password: passwordSchema.optional() }).safeParse(req.body ?? {});
  if (!parsed.success || !uuid.safeParse(req.params.id).success) {
    return res.status(400).json({ error: parsed.success ? "Invalid user id." : parsed.error.issues[0]?.message });
  }
  const found = await query("select 1 from users where id = $1 and deleted_at is null", [req.params.id]);
  if (!found.length) return res.status(404).json({ error: "User not found." });

  const password = parsed.data.password ?? generatePassword();
  await setPassword(req.params.id, password);
  res.json({ password });
});

const errorsQuery = z.object({
  status: z.enum(["open", "resolved", "all"]).default("open"),
  source: z.enum(["api", "web", "scraper", "auth", "ai", "worker"]).optional(),
  days: z.coerce.number().int().min(1).max(90).default(14),
});

platformRouter.get("/errors", async (req, res) => {
  const parsed = errorsQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid filter." });
  const { status, source, days } = parsed.data;

  const rows = await query(
    `select fingerprint, source,
            case when bool_or(level = 'error') then 'error' else 'warn' end as level,
            count(*)::int as count,
            count(*) filter (where resolved_at is null)::int as open_count,
            min(created_at) as first_seen,
            max(created_at) as last_seen,
            (array_agg(message order by created_at desc))[1] as message,
            (array_agg(method order by created_at desc))[1] as method,
            (array_agg(path order by created_at desc))[1] as path,
            (array_agg(status order by created_at desc))[1] as status,
            count(distinct organization_id)::int as organizations,
            count(distinct user_id)::int as users
       from error_events
      where created_at > now() - make_interval(days => $1)
        and ($2::text is null or source = $2)
      group by fingerprint, source
     having $3::text = 'all'
         or ($3::text = 'open' and bool_or(resolved_at is null))
         or ($3::text = 'resolved' and bool_and(resolved_at is not null))
      order by max(created_at) desc
      limit 300`,
    [days, source ?? null, status]
  );
  res.json(rows);
});

platformRouter.get("/errors/:fingerprint", async (req, res) => {
  res.json(
    await query(
      `select e.id, e.created_at, e.source, e.level, e.message, e.stack, e.method, e.path, e.status,
              e.context, e.resolved_at, u.email as user_email, o.name as organization_name
         from error_events e
         left join users u on u.id = e.user_id
         left join organizations o on o.id = e.organization_id
        where e.fingerprint = $1
        order by e.created_at desc
        limit 50`,
      [req.params.fingerprint]
    )
  );
});

platformRouter.post("/errors/:fingerprint/resolve", async (req, res) => {
  const r = await pool.query(
    "update error_events set resolved_at = now() where fingerprint = $1 and resolved_at is null",
    [req.params.fingerprint]
  );
  res.json({ resolved: r.rowCount ?? 0 });
});

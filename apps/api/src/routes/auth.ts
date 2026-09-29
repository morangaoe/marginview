import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { signToken } from "../middleware/auth";

export const authRouter = Router();

const signupSchema = z.object({
  organizationName: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  tosAccepted: z.literal(true), // App Flow 3.1: acceptance is required, not a pre-checked box
});

authRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { organizationName, fullName, email, password } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const org = await client.query(
      `insert into organizations (name, tos_accepted_at, privacy_policy_version_accepted)
       values ($1, now(), 'v1') returning id`,
      [organizationName]
    );
    const organizationId = org.rows[0].id;

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await client.query(
      `insert into users (organization_id, email, password_hash, full_name)
       values ($1, $2, $3, $4) returning id`,
      [organizationId, email, passwordHash, fullName]
    );

    const ownerRole = await client.query(`select id from roles where name = 'owner'`);
    await client.query(
      `insert into user_roles (user_id, role_id) values ($1, $2)`,
      [user.rows[0].id, ownerRole.rows[0].id]
    );

    // Every org starts trialing on Starter (per Pricing & Packaging Strategy
    // section 3): full features, no charge yet, trial clock starts later
    // when the first scrape succeeds (see services/billing.ts).
    const starterPlan = await client.query(`select id from plans where name = 'Starter'`);
    await client.query(
      `insert into subscriptions (organization_id, plan_id, status) values ($1, $2, 'trialing')`,
      [organizationId, starterPlan.rows[0].id]
    );

    await client.query("COMMIT");

    const token = signToken({ id: user.rows[0].id, organizationId, role: "owner" });
    res.status(201).json({ token });
  } catch (err) {
    await client.query("ROLLBACK");
    if ((err as any).code === "23505") {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    throw err;
  } finally {
    client.release();
  }
});

const loginSchema = z.object({ email: z.string().email(), password: z.string() });

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;

  const rows = await pool.query(
    `select u.id, u.organization_id, u.password_hash, r.name as role
     from users u
     join user_roles ur on ur.user_id = u.id
     join roles r on r.id = ur.role_id
     where u.email = $1 and u.deleted_at is null
     limit 1`,
    [email]
  );
  const user = rows.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Incorrect email or password" });
  }

  const token = signToken({ id: user.id, organizationId: user.organization_id, role: user.role });
  res.json({ token });
});

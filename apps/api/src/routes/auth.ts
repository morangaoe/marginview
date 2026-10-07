import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { publicSignupEnabled, requireAuth, signToken, SIGNUP_DISABLED } from "../middleware/auth";
import { recordEvent } from "../services/errorLog";
import { createLimiter } from "../utils/rateLimit";

export const authRouter = Router();

export const BCRYPT_ROUNDS = 12;
export const passwordSchema = z.string().min(8, "Password must be at least 8 characters.").max(200);

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("marginview-timing-equaliser", BCRYPT_ROUNDS);

// Failed attempts only. 10 per account and 30 per IP per 15 minutes.
const WINDOW_MS = 15 * 60 * 1000;
const perEmail = createLimiter({ max: 10, windowMs: WINDOW_MS });
const perIp = createLimiter({ max: 30, windowMs: WINDOW_MS });
const TOO_MANY = "Too many sign-in attempts. Wait 15 minutes and try again.";

const signupSchema = z.object({
  organizationName: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().email(),
  password: passwordSchema,
  tosAccepted: z.literal(true), // App Flow 3.1: acceptance is required, not a pre-checked box
});

authRouter.post("/signup", async (req, res) => {
  if (!publicSignupEnabled()) return res.status(403).json(SIGNUP_DISABLED);

  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { organizationName, fullName, password } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const org = await client.query(
      `insert into organizations (name, tos_accepted_at, privacy_policy_version_accepted)
       values ($1, now(), 'v1') returning id`,
      [organizationName]
    );
    const organizationId = org.rows[0].id;

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
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

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your email and password." });
  const email = parsed.data.email.trim().toLowerCase();
  const ipKey = req.ip ?? "unknown";

  if (perEmail.blocked(email) || perIp.blocked(ipKey)) {
    return res.status(429).json({ error: TOO_MANY });
  }

  const { rows } = await pool.query(
    `select u.id, u.organization_id, u.password_hash, u.status, r.name as role
       from users u
       join user_roles ur on ur.user_id = u.id and ur.location_id is null
       join roles r on r.id = ur.role_id
      where lower(u.email) = $1 and u.deleted_at is null
      limit 1`,
    [email]
  );
  const user = rows[0];
  const passwordOk = await bcrypt.compare(parsed.data.password, user?.password_hash ?? DUMMY_HASH);

  if (!user || !passwordOk) {
    perEmail.hit(email);
    perIp.hit(ipKey);
    const reason = user ? "wrong_password" : "unknown_email";
    void recordEvent({
      source: "auth",
      level: "warn",
      message: user ? `Sign-in failed: wrong password for ${email}` : `Sign-in failed: no account for ${email}`,
      method: req.method,
      path: "/api/auth/login",
      status: 401,
      userId: user?.id,
      organizationId: user?.organization_id,
      context: { email, reason, ip: req.ip },
      fingerprintKey: `auth|${reason}|${email}`,
    });
    return res.status(401).json({ error: "Incorrect email or password" });
  }

  // Only checked after the password matched, so account state isn't revealed to guessers.
  if (user.status !== "active") {
    void recordEvent({
      source: "auth",
      level: "warn",
      message: `Sign-in blocked: ${email} is ${user.status === "invited" ? "pending approval" : user.status}`,
      method: req.method,
      path: "/api/auth/login",
      status: 403,
      userId: user.id,
      organizationId: user.organization_id,
      context: { email, status: user.status },
      fingerprintKey: `auth|blocked|${email}`,
    });
    return res.status(403).json({
      error:
        user.status === "invited"
          ? "Your access hasn't been approved yet. Ask your workspace owner to enable your account."
          : "This account has been disabled. Contact your administrator.",
    });
  }

  perEmail.reset(email);
  await pool.query("update users set last_login_at = now() where id = $1", [user.id]);
  const token = signToken({ id: user.id, organizationId: user.organization_id, role: user.role });
  res.json({ token });
});

/** GET /api/auth/me: the signed-in user, read fresh from the database. */
authRouter.get("/me", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `select u.id, u.email, u.full_name, o.id as organization_id, o.name as organization_name
       from users u join organizations o on o.id = u.organization_id
      where u.id = $1`,
    [req.user!.id]
  );
  const u = rows[0];
  res.json({
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    organizationId: u.organization_id,
    organizationName: u.organization_name,
    role: req.user!.role,
    isPlatformAdmin: !!req.user!.isPlatformAdmin,
  });
});

const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });

/** POST /api/auth/change-password: signs out every other session and returns a fresh token. */
authRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." });
  }
  const key = `change:${req.user!.id}`;
  if (perEmail.blocked(key)) return res.status(429).json({ error: TOO_MANY });

  const { rows } = await pool.query("select password_hash from users where id = $1", [req.user!.id]);
  if (!(await bcrypt.compare(parsed.data.currentPassword, rows[0].password_hash))) {
    perEmail.hit(key);
    return res.status(400).json({ error: "Your current password is incorrect." });
  }

  await setPassword(req.user!.id, parsed.data.newPassword);
  res.json({ token: signToken(req.user!) });
});

/**
 * Stores a new password and ends every session issued before now. The cutoff uses
 * this server's clock (not the database's) because token iat comes from this clock too.
 */
export async function setPassword(
  userId: string,
  password: string,
  db: { query(text: string, values?: unknown[]): Promise<unknown> } = pool,
) {
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await db.query(
    "update users set password_hash = $2, password_changed_at = $3, updated_at = now() where id = $1",
    [userId, hash, new Date()]
  );
}

/** 14 random characters for admin resets; shown to the admin once, never stored. */
export function generatePassword(): string {
  return randomBytes(12).toString("base64url").replace(/[-_]/g, "x").slice(0, 14);
}

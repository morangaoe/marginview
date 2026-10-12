import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { clearSessionCookie, publicSignupEnabled, requireAuth, setSessionCookie, signToken, SIGNUP_DISABLED } from "../middleware/auth";
import { emailConfigured, sendEmail } from "../services/email";
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

    setSessionCookie(res, signToken({ id: user.rows[0].id, organizationId, role: "owner" }));
    res.status(201).json({ ok: true });
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
  setSessionCookie(res, signToken({ id: user.id, organizationId: user.organization_id, role: user.role }));
  res.json({ ok: true });
});

const googleSchema = z.object({ credential: z.string().min(20).max(4096) });
const googlePerIp = createLimiter({ max: 30, windowMs: WINDOW_MS });
const GOOGLE_DENIED = "That Google account isn't set up on Marginview. Ask your workspace owner to add your email.";

interface GoogleClaims {
  sub: string;
  email: string;
}

/**
 * Asks Google to verify the ID token's signature and expiry (no key handling on our side),
 * then checks it was issued for this app, by Google, for a verified email.
 */
async function verifyGoogleCredential(credential: string): Promise<GoogleClaims | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) return null;
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) return null;
  const c = (await r.json()) as Record<string, any>;
  const issuerOk = c.iss === "accounts.google.com" || c.iss === "https://accounts.google.com";
  const verified = c.email_verified === true || c.email_verified === "true";
  if (c.aud !== clientId || !issuerOk || !verified || !c.sub || !c.email) return null;
  if (Number(c.exp) * 1000 < Date.now()) return null;
  return { sub: c.sub, email: c.email.trim().toLowerCase() };
}

/**
 * POST /api/auth/google: one-click sign-in for people who already have an account.
 * It never creates accounts, so the workspace stays invite-only. The first sign-in links the
 * Google id to the user; after that the id (not the email) is what identifies them.
 */
authRouter.post("/google", async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(404).json({ error: "Google sign-in is not enabled." });
  const parsed = googleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Google sign-in failed. Try again." });
  const ipKey = `g:${req.ip ?? "unknown"}`;
  if (googlePerIp.blocked(ipKey)) return res.status(429).json({ error: TOO_MANY });

  let g: GoogleClaims | null = null;
  try {
    g = await verifyGoogleCredential(parsed.data.credential);
  } catch {
    return res.status(503).json({ error: "Couldn't reach Google. Try again in a moment." });
  }
  if (!g) {
    googlePerIp.hit(ipKey);
    return res.status(401).json({ error: "Google sign-in failed. Try again." });
  }

  const { rows } = await pool.query(
    `select u.id, u.organization_id, u.status, u.google_sub, r.name as role
       from users u
       join user_roles ur on ur.user_id = u.id and ur.location_id is null
       join roles r on r.id = ur.role_id
      where u.deleted_at is null and (u.google_sub = $1 or (u.google_sub is null and lower(u.email) = $2))
      order by (u.google_sub = $1) desc nulls last
      limit 1`,
    [g.sub, g.email]
  );
  const user = rows[0];
  if (!user) {
    googlePerIp.hit(ipKey);
    void recordEvent({
      source: "auth",
      level: "warn",
      message: `Google sign-in refused: no account for ${g.email}`,
      method: req.method,
      path: "/api/auth/google",
      status: 403,
      context: { email: g.email, ip: req.ip },
      fingerprintKey: `auth|google_unknown|${g.email}`,
    });
    return res.status(403).json({ error: GOOGLE_DENIED });
  }
  if (user.status !== "active") {
    return res.status(403).json({
      error:
        user.status === "invited"
          ? "Your access hasn't been approved yet. Ask your workspace owner to enable your account."
          : "This account has been disabled. Contact your administrator.",
    });
  }

  await pool.query(
    "update users set google_sub = coalesce(google_sub, $2), last_login_at = now() where id = $1",
    [user.id, g.sub]
  );
  setSessionCookie(res, signToken({ id: user.id, organizationId: user.organization_id, role: user.role }));
  res.json({ ok: true });
});

// ---- Email sign-in links -------------------------------------------------------------

const LINK_TTL_MIN = 10;
const linkPerEmail = createLimiter({ max: 3, windowMs: 15 * 60 * 1000 });
const linkPerIp = createLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
const verifyPerIp = createLimiter({ max: 20, windowMs: WINDOW_MS });
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const LINK_SENT = { ok: true, message: "If that email has a Marginview account, a sign-in link is on its way. It works once and expires in 10 minutes." };

function appUrl(): string {
  return (process.env.APP_URL ?? process.env.FRONTEND_URL?.split(",")[0] ?? "http://localhost:5173").trim().replace(/\/$/, "");
}

/**
 * POST /api/auth/magic/request { email }. The answer is identical whether or not the account
 * exists, so it can't be used to discover who has one. The token travels in the URL fragment,
 * which browsers never send to servers, so it stays out of access logs and Referer headers.
 */
authRouter.post("/magic/request", async (req, res) => {
  if (!emailConfigured()) return res.status(404).json({ error: "Email sign-in is not enabled." });
  const parsed = z.object({ email: z.string().email().max(254) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email address." });
  const email = parsed.data.email.trim().toLowerCase();
  const ipKey = req.ip ?? "unknown";
  if (linkPerIp.hit(ipKey) || linkPerEmail.hit(email)) return res.status(429).json({ error: "Too many requests. Wait 15 minutes and try again." });

  const { rows } = await pool.query(
    `select id, status from users where lower(email) = $1 and deleted_at is null limit 1`,
    [email]
  );
  const user = rows[0];
  if (user && user.status === "active") {
    const token = randomBytes(32).toString("base64url");
    // One live link per person: a new request cancels the previous one.
    await pool.query("update login_links set used_at = now() where user_id = $1 and used_at is null", [user.id]);
    await pool.query(
      "insert into login_links (token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(mins => $3))",
      [sha256(token), user.id, LINK_TTL_MIN]
    );
    const link = `${appUrl()}/login/link#t=${token}`;
    try {
      await sendEmail({
        to: email,
        subject: "Your Marginview sign-in link",
        text: `Sign in to Marginview: ${link}\n\nThis link works once and expires in ${LINK_TTL_MIN} minutes. If you didn't ask for it, ignore this email.`,
        html: `<p>Click to sign in to Marginview:</p><p><a href="${link}">Sign in</a></p><p style="color:#666;font-size:13px">This link works once and expires in ${LINK_TTL_MIN} minutes. If you didn't ask for it, ignore this email.</p>`,
      });
    } catch (e) {
      void recordEvent({ source: "auth", message: `Sign-in email failed: ${(e as Error).message}`, path: "/api/auth/magic/request", fingerprintKey: "auth|magic_send_failed" });
    }
  }
  res.json(LINK_SENT);
});

/**
 * POST /api/auth/magic/verify { token }. A POST (not a GET) so email scanners that pre-open
 * links can't use them up. The update is atomic: only one caller can ever claim a token.
 */
authRouter.post("/magic/verify", async (req, res) => {
  const parsed = z.object({ token: z.string().min(20).max(200) }).safeParse(req.body);
  const ipKey = `v:${req.ip ?? "unknown"}`;
  if (verifyPerIp.blocked(ipKey)) return res.status(429).json({ error: TOO_MANY });
  const invalid = () => {
    verifyPerIp.hit(ipKey);
    return res.status(401).json({ error: "This sign-in link is invalid or has expired. Request a new one." });
  };
  if (!parsed.success) return invalid();

  const claimed = await pool.query(
    `update login_links set used_at = now()
      where token_hash = $1 and used_at is null and expires_at > now()
      returning user_id`,
    [sha256(parsed.data.token)]
  );
  if (!claimed.rowCount) return invalid();

  const { rows } = await pool.query(
    `select u.id, u.organization_id, u.status, r.name as role
       from users u
       join user_roles ur on ur.user_id = u.id and ur.location_id is null
       join roles r on r.id = ur.role_id
      where u.id = $1 and u.deleted_at is null limit 1`,
    [claimed.rows[0].user_id]
  );
  const user = rows[0];
  if (!user || user.status !== "active") return invalid();

  await pool.query("update users set last_login_at = now() where id = $1", [user.id]);
  setSessionCookie(res, signToken({ id: user.id, organizationId: user.organization_id, role: user.role }));
  res.json({ ok: true });
});

/** GET /api/auth/config: lets the login page know whether to show the Google button. */
authRouter.get("/config", (_req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || null, emailLink: emailConfigured() });
});

/** POST /api/auth/logout-all: ends every session issued before now, on every device. */
authRouter.post("/logout-all", requireAuth, async (req, res) => {
  await pool.query("update users set password_changed_at = $2 where id = $1", [req.user!.id, new Date()]);
  clearSessionCookie(res);
  res.status(204).end();
});

/** POST /api/auth/logout: removes this browser's session cookie. Needs no session so it always works. */
authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
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
  setSessionCookie(res, signToken(req.user!));
  res.json({ ok: true });
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

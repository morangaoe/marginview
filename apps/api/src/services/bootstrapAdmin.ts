import bcrypt from "bcryptjs";
import { pool } from "../db/pool";

const BCRYPT_ROUNDS = 12;

/**
 * First-run login. Sign-up is invite-only and the app has no register form, so a brand-new database
 * has nobody who can sign in. When BOOTSTRAP_ADMIN_PASSWORD is set, this creates an owner account for
 * the first PLATFORM_ADMIN_EMAILS address if (and only if) that email has no account yet.
 * Remove the variable afterwards; it never changes an existing account.
 */
export async function bootstrapAdmin(): Promise<void> {
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const email = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",")[0]?.trim().toLowerCase();
  if (!password || !email) return;
  if (password.length < 8) {
    console.warn("[bootstrap] BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters. Skipping.");
    return;
  }

  const client = await pool.connect();
  try {
    const existing = await client.query("select 1 from users where lower(email) = $1", [email]);
    if (existing.rowCount) return;

    await client.query("begin");
    const org = await client.query(
      `insert into organizations (name, tos_accepted_at, privacy_policy_version_accepted)
       values ('Marginview', now(), $1) returning id`,
      [process.env.PRIVACY_POLICY_VERSION ?? "v1"],
    );
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await client.query(
      `insert into users (organization_id, email, password_hash, full_name)
       values ($1, $2, $3, 'Admin') returning id`,
      [org.rows[0].id, email, hash],
    );
    await client.query(
      "insert into user_roles (user_id, role_id) select $1, id from roles where name = 'owner'",
      [user.rows[0].id],
    );
    await client.query(
      "insert into subscriptions (organization_id, plan_id, status) select $1, id, 'trialing' from plans where name = 'Starter' limit 1",
      [org.rows[0].id],
    );
    await client.query("commit");
    console.log(`[bootstrap] Created owner account for ${email}. Remove BOOTSTRAP_ADMIN_PASSWORD now.`);
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.error("[bootstrap] could not create the first account:", (e as Error).message);
  } finally {
    client.release();
  }
}

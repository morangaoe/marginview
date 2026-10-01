import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { pool } from "../db/pool";
import { HttpError, wrap } from "../utils/http";

const router = Router();
const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "proton.me", "protonmail.com"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/onboarding/register
 * mode "create": new workspace, caller becomes owner.
 * mode "join":   invite code -> active viewer; no code -> domain match -> pending approval.
 * Never lists organizations. Failures are deliberately generic.
 */
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
    if (mode === "create" && acceptTos !== true) throw new HttpError(400, "Accept the Terms and Privacy Policy to continue.");

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
          [String(orgName).trim(), claimDomain, randomBytes(5).toString("hex").toUpperCase(), process.env.PRIVACY_POLICY_VERSION ?? "v1"],
        );
        organizationId = org.rows[0].id;
        roleName = "owner";
      } else {
        const code = String(inviteCode ?? "").trim().toUpperCase();
        const org = code
          ? await client.query("select id from organizations where invite_code = $1", [code])
          : await client.query("select id from organizations where domain = $1", [domain]);
        if (!org.rowCount) {
          throw new HttpError(404, "We couldn't find a workspace for that. Ask your workspace owner for an invite code.");
        }
        organizationId = org.rows[0].id;
        // Domain match alone is unverified: hold for owner approval.
        if (!code) status = "invited";
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
        return res.status(202).json({ pending: true, message: "Request sent. A workspace owner needs to approve your access." });
      }
      // ALIGN the claims with what middleware/auth.ts expects.
      const token = jwt.sign({ sub: userId, id: userId, userId, email: mail, organizationId, role: roleName }, process.env.JWT_SECRET!, { expiresIn: "7d" });
      return res.status(201).json({ token, user: { id: userId, email: mail, fullName, organizationId, role: roleName } });
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }),
);

export default router;

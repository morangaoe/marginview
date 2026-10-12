/** Sends mail through SendGrid's v3 HTTP API (no SDK needed). */
export function emailConfigured(): boolean {
  return !!process.env.SENDGRID_API_KEY?.trim() && !!process.env.MAIL_FROM?.trim();
}

export async function sendEmail(opts: { to: string; subject: string; text: string; html: string }): Promise<void> {
  const key = process.env.SENDGRID_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();
  if (!key || !from) throw new Error("SendGrid is not configured (SENDGRID_API_KEY, MAIL_FROM).");
  const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      personalizations: [{ to: [{ email: opts.to }] }],
      from: { email: from, name: "Marginview" },
      subject: opts.subject,
      content: [
        { type: "text/plain", value: opts.text },
        { type: "text/html", value: opts.html },
      ],
      // A sign-in link must not be rewritten through a click-tracking redirect.
      tracking_settings: { click_tracking: { enable: false, enable_text: false } },
    }),
  });
  if (!r.ok) throw new Error(`SendGrid responded ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

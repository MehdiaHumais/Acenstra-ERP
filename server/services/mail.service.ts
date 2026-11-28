/**
 * SMTP mail delivery for Ascentra ERP.
 *
 * PROVIDER: smtp config comes from environment variables only — nothing is hard-coded.
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
 *   SMTP_SECURE                    "ssl" (port 465 implicit TLS) | "starttls" (default, port 589/587-style STARTTLS)
 *   SMTP_FROM_NAME                 e.g. Ascentra Global Ltd
 *   SMTP_FROM_EMAIL                e.g. support@britsyncai.com
 *   SMTP_TLS_BYPASS_INVALID_CERT   "1" to skip certificate verification (last-resort accommodation for
 *                                  an internal host with an expired cert; renegotiate by fixing the cert!)
 */
import nodemailer, { type Transporter } from "nodemailer";

let cached: Transporter | null = null;

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS);
}

function transporter(): Transporter {
  if (cached) return cached;
  const host = process.env.SMTP_HOST!.trim();
  const port = Number(process.env.SMTP_PORT?.trim() || "587");
  const secure = (process.env.SMTP_SECURE ?? "starttls").toLowerCase() === "ssl";
  const bypass = process.env.SMTP_TLS_BYPASS_INVALID_CERT === "1";
  cached = nodemailer.createTransport({
    host,
    port,
    secure,
    ...(secure ? {} : { requireTLS: true }),
    auth: {
      user: process.env.SMTP_USER!.trim(),
      pass: process.env.SMTP_PASS!,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    tls: { rejectUnauthorized: !bypass },
  });
  return cached;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Safe, client-facing explanation of a mail failure. Never contains credentials. */
export interface MailFailure {
  code: string;
  message: string;
}

/**
 * Map a raw SMTP/nodemailer error to a short hint an administrator can act on.
 * The raw message is deliberately NOT returned: it can contain the mail host,
 * username, recipient or provider-specific details that should stay server-side.
 */
export function classifyMailError(raw?: string): MailFailure {
  const text = (raw ?? "").toLowerCase();
  if (!text) {
    return { code: "smtp_unknown_error", message: "the mail provider rejected the message" };
  }
  const rules: Array<[RegExp, string, string]> = [
    [/535|534|invalid login|authentication failed|bad credentials|username and password|password authentication/, "smtp_auth_failed", "the mail account login was rejected — check SMTP_USER/SMTP_PASS"],
    [/enotfound|eai_again|getaddrinfo|econnrefused|econnreset|etimedout|timeout|socket hang up|network is unreachable|bad gateway/, "smtp_unreachable", "the mail server could not be reached — check SMTP_HOST/SMTP_PORT and network access"],
    [/certificate|self.signed|self signed|tls|ssl|wrong version number|wrong version/, "smtp_tls_error", "the mail server's TLS setup was rejected — check SMTP_SECURE"],
    [/55[0134]|mailbox|recipient|user unknown|no such user|invalid address/, "smtp_recipient_rejected", "the recipient address was rejected by the mail provider"],
    [/smtp not configured/, "smtp_not_configured", "SMTP is not configured on the server"],
    [/quota|sender|from address|5[0-9]{2}|4[0-9]{2}/, "smtp_rejected", "the mail provider rejected the message"],
  ];
  for (const [pattern, code, message] of rules) {
    if (pattern.test(text)) return { code, message };
  }
  return { code: "smtp_unknown_error", message: "the mail provider rejected the message" };
}

export async function sendMail(message: MailMessage): Promise<{ sent: boolean; error?: string; failure?: MailFailure }> {
  if (!smtpConfigured()) {
    console.error("[mail] SMTP not configured — refusing to send. Set SMTP_HOST/SMTP_USER/SMTP_PASS in .env.");
    return {
      sent: false,
      error: "SMTP not configured",
      failure: classifyMailError("SMTP not configured"),
    };
  }
  const from = `${process.env.SMTP_FROM_NAME ?? "Ascentra Global Ltd"} <${process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER}>`;
  try {
    const info = await transporter().sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER,
    });
    console.log(`[mail] delivered to ${message.to} (messageId=${info.messageId}, response=${info.response})`);
    return { sent: true };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    // Raw error stays in the server log only; callers receive a sanitized hint.
    console.error(`[mail] delivery failed to ${message.to}: ${msg}`);
    return { sent: false, error: msg, failure: classifyMailError(msg) };
  }
}

// ---------------------------------------------------------------------------
// Branded invitation email
// ---------------------------------------------------------------------------
export function buildInvitationEmail(input: {
  name: string;
  email: string;
  inviteUrl: string;
  subject?: string;
  intro?: string;
}): MailMessage {
  const { name, email, inviteUrl, subject, intro } = input;
  const pretty = name.trim() || email.split("@")[0];
  const safe = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const text = [
    `Hi ${pretty},`,
    "",
    intro ?? "You have been invited to Ascentra ERP — the AI-powered food distribution platform used by Ascentra Global Ltd (Milan Cold Hub & Bologna Freezer DC).",
    "",
    "Create your account and set your password using this single-use link:",
    inviteUrl,
    "",
    "The link expires in 72 hours and works one time only. After setting your password you will sign in with your email and password.",
    "",
    "If you were not expecting this invitation, you can safely ignore this email.",
    "",
    "— Ascentra ERP Administration",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef3f7;font-family:Arial,Helvetica,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f7;padding:28px 12px;">
      <tr>
        <td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dbe4ec;">
            <tr>
              <td style="background:#061222;padding:22px 32px;text-align:left;">
                <div style="color:#7cc3c8;font-size:11px;font-weight:800;letter-spacing:3px;">ASCENTRA</div>
                <div style="color:#ffffff;font-size:19px;font-weight:800;margin-top:6px;">You’re invited to Ascentra ERP</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px;color:#0f2537;font-size:14px;line-height:1.6;">
                <p style="margin:0 0 14px 0;">Hi <strong>${safe(pretty)}</strong>,</p>
                <p style="margin:0 0 14px 0;">${intro ? safe(intro) : "You have been invited to <strong>Ascentra ERP</strong>, the AI-powered food distribution platform used by Ascentra Global Ltd."}</p>
                <p style="margin:0 0 8px 0;">To create your account and set your password, use the button below. This link is <strong>single-use</strong> and expires in <strong>72 hours</strong>.</p>
                <p style="margin:22px 0 20px 0;text-align:center;">
                  <a href="${safe(inviteUrl)}" style="background:#447794;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;border-radius:8px;padding:12px 28px;display:inline-block;">Accept invitation</a>
                </p>
                <p style="margin:0 0 14px 0;font-size:12px;color:#52677a;">If the button doesn’t work, paste this link into your browser:<br><span style="word-break:break-all;">${safe(inviteUrl)}</span></p>
                <p style="margin:0;font-size:12px;color:#52677a;">If you were not expecting this invitation, you can safely ignore this email.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #e4eaef;font-size:11px;color:#7b8fa0;text-align:left;">
                Ascentra ERP — AI-powered food distribution · Milan Cold Hub · Bologna Freezer DC · Ascentra Global Ltd<br>
                Sent by Ascentra ERP Administration. This is a one-time transactional email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    to: email,
    subject: subject ?? "You’re invited to Ascentra ERP",
    text,
    html,
  };
}

// ---------------------------------------------------------------------------
// Access request approved — account created (includes credentials + sign-in link)
// ---------------------------------------------------------------------------
export function buildAccessApprovedEmail(input: {
  name: string;
  email: string;
  reference: string;
  role: string;
  temporaryPassword: string;
  loginUrl: string;
}): MailMessage {
  const { name, email, reference, role, temporaryPassword, loginUrl } = input;
  const pretty = name.trim() || email.split("@")[0];
  const safe = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const text = [
    `Hi ${pretty},`,
    "",
    `YOUR ACCESS REQUEST WAS APPROVED — reference ${reference}.`,
    `An administrator created your Ascentra ERP account.`,
    "",
    `Sign in:  ${loginUrl}`,
    `Email:    ${email}`,
    `Role:     ${role}`,
    `Temporary password: ${temporaryPassword}`,
    "",
    "For your security, you must set your own password on first sign-in.",
    "",
    "— Ascentra ERP Administration",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef3f7;font-family:Arial,Helvetica,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f7;padding:28px 12px;">
      <tr>
        <td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dbe4ec;">
            <tr>
              <td style="background:#061222;padding:22px 32px;text-align:left;">
                <div style="color:#7cc3c8;font-size:11px;font-weight:800;letter-spacing:3px;">ASCENTRA</div>
                <div style="color:#ffffff;font-size:19px;font-weight:800;margin-top:6px;">Access request approved</div>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px;text-align:center;background:#e8f6ee;border-bottom:2px solid #2f8f5b;">
                <div style="width:54px;height:54px;border-radius:999px;background:#2f8f5b;display:inline-flex;align-items:center;justify-content:center;font-size:28px;color:#ffffff;font-weight:800;">✓</div>
                <div style="margin-top:10px;font-size:15px;font-weight:800;color:#1f6b43;">Your access request was approved</div>
                <div style="margin-top:2px;font-size:11px;color:#3f7d55;">Reference: ${safe(reference)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px;color:#0f2537;font-size:13px;line-height:1.6;">
                <p style="margin:0 0 12px 0;">Hi <strong>${safe(pretty)}</strong>,</p>
                <p style="margin:0 0 14px 0;">An administrator reviewed and approved your request. Your Ascentra ERP account is ready.</p>
                <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe4ec;border-radius:10px;overflow:hidden;margin:0 0 16px 0;">
                  <tr>
                    <td style="background:#f2f6fa;padding:10px 14px;font-size:11px;font-weight:700;color:#52677a;width:30%;">Email</td>
                    <td style="padding:10px 14px;font-size:13px;color:#0f2537;">${safe(email)}</td>
                  </tr>
                  <tr>
                    <td style="background:#f2f6fa;padding:10px 14px;font-size:11px;font-weight:700;color:#52677a;">Role</td>
                    <td style="padding:10px 14px;font-size:13px;color:#0f2537;">${safe(role)}</td>
                  </tr>
                  <tr>
                    <td style="background:#f2f6fa;padding:10px 14px;font-size:11px;font-weight:700;color:#52677a;">Temporary password</td>
                    <td style="padding:10px 14px;font-family:monospace;font-size:13px;color:#0f2537;">${safe(temporaryPassword)}</td>
                  </tr>
                </table>
                <p style="margin:0 0 16px 0;text-align:center;">
                  <a href="${safe(loginUrl)}" style="background:#447794;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;border-radius:8px;padding:12px 30px;display:inline-block;">Sign in to Ascentra ERP</a>
                </p>
                <p style="margin:0;font-size:11px;color:#52677a;">For your security, you will be asked to set your own password on first sign-in. If you did not request this account, contact your administrator.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #e4eaef;font-size:11px;color:#7b8fa0;text-align:left;">
                Ascentra ERP — AI-powered food distribution · Milan Cold Hub · Bologna Freezer DC · Ascentra Global Ltd<br>
                Sent by Ascentra ERP Administration. This is a one-time transactional email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { to: email, subject: "Your Ascentra ERP access request was approved", text, html };
}

// ---------------------------------------------------------------------------
// Access changed by an administrator — notify the user of what changed
// ---------------------------------------------------------------------------
export interface AccessChangeEntry {
  label: string;
  before: string;
  after: string;
}

export function buildAccessChangedEmail(input: {
  name: string;
  email: string;
  changes: AccessChangeEntry[];
  loginUrl: string;
  changedBy: string;
}): MailMessage {
  const { name, email, changes, loginUrl, changedBy } = input;
  const pretty = name.trim() || email.split("@")[0];
  const safe = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const text = [
    `Hi ${pretty},`,
    "",
    "Your Ascentra ERP access was changed by an administrator.",
    "",
    ...changes.map((c) => `- ${c.label}: ${c.before} -> ${c.after}`),
    "",
    `Sign in: ${loginUrl}`,
    "",
    "If you did not expect this change, contact your administrator immediately.",
    "",
    "— Ascentra ERP Administration",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef3f7;font-family:Arial,Helvetica,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f7;padding:28px 12px;">
      <tr>
        <td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dbe4ec;">
            <tr>
              <td style="background:#061222;padding:22px 32px;text-align:left;">
                <div style="color:#7cc3c8;font-size:11px;font-weight:800;letter-spacing:3px;">ASCENTRA</div>
                <div style="color:#ffffff;font-size:19px;font-weight:800;margin-top:6px;">Your access was updated</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px;color:#0f2537;font-size:13px;line-height:1.6;">
                <p style="margin:0 0 12px 0;">Hi <strong>${safe(pretty)}</strong>,</p>
                <p style="margin:0 0 14px 0;">An administrator (${safe(changedBy)}) changed your Ascentra ERP access:</p>
                <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe4ec;border-radius:10px;overflow:hidden;margin:0 0 16px 0;">
                  <tr>
                    <th style="background:#f2f6fa;padding:10px 14px;font-size:11px;font-weight:700;color:#52677a;text-align:left;">What</th>
                    <th style="background:#f2f6fa;padding:10px 14px;font-size:11px;font-weight:700;color:#52677a;text-align:left;">Before</th>
                    <th style="background:#f2f6fa;padding:10px 14px;font-size:11px;font-weight:700;color:#52677a;text-align:left;">After</th>
                  </tr>
                  ${changes
                    .map(
                      (c) => `<tr>
                    <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#0f2537;border-top:1px solid #e4eaef;">${safe(c.label)}</td>
                    <td style="padding:10px 14px;font-size:12px;color:#52677a;border-top:1px solid #e4eaef;">${safe(c.before)}</td>
                    <td style="padding:10px 14px;font-size:12px;color:#0f2537;font-weight:700;border-top:1px solid #e4eaef;">${safe(c.after)}</td>
                  </tr>`
                    )
                    .join("")}
                </table>
                <p style="margin:0 0 16px 0;text-align:center;">
                  <a href="${safe(loginUrl)}" style="background:#447794;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;border-radius:8px;padding:12px 30px;display:inline-block;">Open Ascentra ERP</a>
                </p>
                <p style="margin:0;font-size:11px;color:#52677a;">You have been signed out of existing sessions. If you don't recognize this change, contact your administrator immediately.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #e4eaef;font-size:11px;color:#7b8fa0;text-align:left;">
                Ascentra ERP — AI-powered food distribution · Milan Cold Hub · Bologna Freezer DC · Ascentra Global Ltd<br>
                Sent by Ascentra ERP Administration. This is a one-time transactional email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { to: email, subject: "Your Ascentra ERP access was updated", text, html };
}

/**
 * System mailer — for transactional / auth emails only.
 * Sends from support@primeaccountax.com regardless of org email settings.
 *
 * Configure via env vars:
 *   SYSTEM_SMTP_HOST   — e.g. smtp.zoho.com
 *   SYSTEM_SMTP_PORT   — e.g. 587
 *   SYSTEM_SMTP_USER   — e.g. support@primeaccountax.com
 *   SYSTEM_SMTP_PASS   — app password / SMTP password
 *   SYSTEM_FROM_EMAIL  — defaults to SYSTEM_SMTP_USER
 *   SYSTEM_FROM_NAME   — defaults to "Prime Accountax"
 *   NEXT_PUBLIC_APP_URL — e.g. https://app.primeaccountax.com
 */

import * as nodemailer from "nodemailer";

export interface SystemMailOptions {
  to: string;
  subject: string;
  html: string;
  cc?: string[];
}

function getSystemTransport() {
  const host  = process.env.SYSTEM_SMTP_HOST;
  const port  = parseInt(process.env.SYSTEM_SMTP_PORT || "587");
  const user  = process.env.SYSTEM_SMTP_USER;
  const pass  = process.env.SYSTEM_SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      "System mailer not configured. Set SYSTEM_SMTP_HOST, SYSTEM_SMTP_USER, SYSTEM_SMTP_PASS in environment."
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export function getSystemFrom(): string {
  const name  = process.env.SYSTEM_FROM_NAME  || "Prime Accountax";
  const email = process.env.SYSTEM_FROM_EMAIL || process.env.SYSTEM_SMTP_USER || "support@primeaccountax.com";
  return `"${name}" <${email}>`;
}

export function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Send a transactional email from support@primeaccountax.com.
 */
export async function sendSystemEmail(opts: SystemMailOptions): Promise<void> {
  const transport = getSystemTransport();
  await transport.sendMail({
    from:    getSystemFrom(),
    to:      opts.to,
    ...(opts.cc && opts.cc.length > 0 ? { cc: opts.cc.join(", ") } : {}),
    subject: opts.subject,
    html:    opts.html,
  });
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prime Accountax</title>
</head>
<body style="margin:0;padding:0;background:#0c0a09;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0c0a09;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <!-- Logo / header -->
        <tr>
          <td style="padding-bottom:24px;text-align:center;">
            <div style="display:inline-flex;align-items:center;gap:10px;">
              <div style="width:36px;height:36px;background:#10b981;border-radius:8px;display:inline-block;"></div>
              <span style="font-size:18px;font-weight:600;color:#fff;">Prime Accountax</span>
            </div>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td style="background:#1c1917;border:1px solid #292524;border-radius:12px;padding:32px;">
            ${content}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding-top:24px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#57534e;">
              This email was sent by Prime Accountax &middot;
              <a href="mailto:support@primeaccountax.com" style="color:#57534e;">support@primeaccountax.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function renderPasswordResetEmail(opts: {
  name: string;
  resetUrl: string;
}): string {
  return baseLayout(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#fff;">Reset your password</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#a8a29e;">Hi ${opts.name}, we received a request to reset your password.</p>

    <p style="margin:0 0 8px;font-size:14px;color:#a8a29e;">Click the button below to choose a new password. This link expires in <strong style="color:#e7e5e4;">1 hour</strong>.</p>

    <div style="text-align:center;margin:28px 0;">
      <a href="${opts.resetUrl}"
         style="display:inline-block;padding:12px 28px;background:#10b981;color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">
        Reset password
      </a>
    </div>

    <p style="margin:0 0 4px;font-size:12px;color:#78716c;">Or copy this link into your browser:</p>
    <p style="margin:0;font-size:11px;color:#57534e;word-break:break-all;">${opts.resetUrl}</p>

    <hr style="margin:24px 0;border:none;border-top:1px solid #292524;" />
    <p style="margin:0;font-size:12px;color:#57534e;">If you didn't request a password reset, you can safely ignore this email. Your password won't change.</p>
  `);
}

export function renderWelcomeEmail(opts: {
  name: string;
  orgName: string;
  email: string;
  password?: string;   // set for new users; omitted for existing users linked to a new org
  resetUrl?: string;   // "set your password" link (e.g. on resend, when no plaintext password)
  loginUrl: string;
}): string {
  const credentialBlock = opts.password
    ? `<div style="background:#0c0a09;border:1px solid #292524;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#78716c;text-transform:uppercase;letter-spacing:.05em;">Your login credentials</p>
        <p style="margin:0 0 4px;font-size:13px;color:#a8a29e;">Email: <strong style="color:#e7e5e4;">${opts.email}</strong></p>
        <p style="margin:0;font-size:13px;color:#a8a29e;">Password: <strong style="color:#e7e5e4;">${opts.password}</strong></p>
      </div>
      <p style="margin:0 0 24px;font-size:12px;color:#78716c;">Please change your password after first login.</p>`
    : opts.resetUrl
    ? `<p style="margin:0 0 12px;font-size:14px;color:#a8a29e;">Your account (<strong style="color:#e7e5e4;">${opts.email}</strong>) is ready. Set your password to sign in:</p>
       <div style="text-align:center;margin:8px 0 24px;">
         <a href="${opts.resetUrl}" style="display:inline-block;padding:12px 28px;background:#10b981;color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">Set your password</a>
       </div>
       <p style="margin:0 0 20px;font-size:12px;color:#78716c;">This link expires in 24 hours.</p>`
    : `<p style="margin:0 0 24px;font-size:14px;color:#a8a29e;">You can sign in with your existing credentials at the link below.</p>`;

  return baseLayout(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#fff;">Welcome to ${opts.orgName}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#a8a29e;">Hi ${opts.name}, your account has been set up on Prime Accountax.</p>

    ${credentialBlock}

    <div style="text-align:center;margin:28px 0;">
      <a href="${opts.loginUrl}"
         style="display:inline-block;padding:12px 28px;background:#10b981;color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">
        Sign in to your account
      </a>
    </div>

    <hr style="margin:24px 0;border:none;border-top:1px solid #292524;" />
    <p style="margin:0;font-size:12px;color:#57534e;">Need help? Reply to this email or contact <a href="mailto:support@primeaccountax.com" style="color:#57534e;">support@primeaccountax.com</a></p>
  `);
}

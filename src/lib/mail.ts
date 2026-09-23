import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outbound email, for the handful of things a person has to be told about.
 *
 * Plain SMTP, so the only setup is an address and a password — a Gmail account
 * with an app password works as it is, with no domain to verify and no DNS to
 * edit. The host defaults to Gmail's; anything else is a matter of setting
 * SMTP_HOST and SMTP_PORT.
 *
 * Unconfigured, it does nothing and says so in the log. A verification must
 * never fail because a notification could not be sent, and an operator reading
 * "mail not configured" is better served than one whose submission 500s.
 */
const user = process.env.SMTP_USER ?? "";
const pass = process.env.SMTP_PASS ?? "";
const host = process.env.SMTP_HOST ?? "smtp.gmail.com";
const port = Number(process.env.SMTP_PORT ?? 465);

export const mailConfigured = !!user && !!pass;

/** Where operational notices go. */
export const opsEmail = process.env.OPS_EMAIL ?? user ?? "refitanzania@gmail.com";

/** The sender. With Gmail this has to be the account itself, so it defaults to it. */
const from = process.env.MAIL_FROM ?? (user ? `CAPX <${user}>` : "CAPX");

let transport: Transporter | null = null;
function mailer() {
  // Created once and reused: a new connection per message is slow and Gmail
  // rate-limits it.
  transport ??= nodemailer.createTransport({
    host,
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: port === 465,
    auth: { user, pass },
  });
  return transport;
}

export async function sendMail(input: {
  to?: string;
  subject: string;
  text: string;
  /** Answers go to the customer rather than to the sending address. */
  replyTo?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  if (!mailConfigured) return { sent: false, reason: "mail not configured" };
  try {
    await mailer().sendMail({
      from,
      to: input.to ?? opsEmail,
      subject: input.subject,
      text: input.text,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "send failed" };
  }
}

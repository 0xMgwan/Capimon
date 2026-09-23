import "server-only";

/**
 * Outbound email, for the handful of things a person has to be told about.
 *
 * Sent through Resend's HTTP API rather than SMTP, so there is no connection
 * to keep or library to carry. Unconfigured, it does nothing and says so in
 * the log: a verification must never fail because a notification could not be
 * sent, and an operator reading "mail not configured" is better served than
 * one whose submission 500s.
 */
const API = "https://api.resend.com/emails";

export const mailConfigured = !!process.env.RESEND_API_KEY;

/** Where operational notices go. */
export const opsEmail = process.env.OPS_EMAIL ?? "rrefitanzania@gmail.com";

/** The sender. Its domain has to be verified with Resend, or sending fails. */
const from = process.env.MAIL_FROM ?? "CAPX <notifications@capx.broker>";

export async function sendMail(input: {
  to?: string;
  subject: string;
  text: string;
  /** Answers go to the customer rather than to the sending address. */
  replyTo?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  if (!mailConfigured) return { sent: false, reason: "mail not configured" };
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to ?? opsEmail],
        subject: input.subject,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, reason: `${res.status} ${body.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "send failed" };
  }
}

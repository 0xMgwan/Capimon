/**
 * The look of an email from CAPX.
 *
 * A verification notice is the first thing many customers will ever receive
 * from us, and a wall of monospaced plain text reads like something that
 * escaped from a server. It is also, for someone deciding whether to trust an
 * app with their money, the wrong impression entirely.
 *
 * Written the way email has to be written rather than the way the app is:
 * tables, inline styles, no external stylesheet, because Gmail strips <style>
 * blocks and Outlook ignores flexbox. The one image is the app icon, and the
 * design holds up without it — most clients block remote images until a sender
 * is trusted, so the wordmark beside it is real text and the layout does not
 * depend on the picture loading.
 *
 * Every message carries a plain-text version alongside this one; some people
 * read mail that way on purpose, and every spam filter does.
 */
const SITE = "https://www.capx.broker";
const ACCENT = "#1b41ff";
const FG = "#0c0d0c";
const MUTED = "#6e716b";
const LINE = "#e6e6e3";

/** Escaped, because a customer's own name comes through here. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function brandedEmail(input: {
  /** The line that carries the message, in large type. */
  heading: string;
  /** Body paragraphs, in order. */
  paragraphs: string[];
  cta?: { label: string; href: string };
  /** A quieter closing note — what to do if something is wrong. */
  note?: string;
}): string {
  const { heading, paragraphs, cta, note } = input;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f2;">
<tr><td align="center" style="padding:32px 16px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="max-width:480px;background:#ffffff;border:1px solid ${LINE};border-radius:20px;">

  <!-- Wordmark. The icon is decorative; the name beside it is text, so a
       blocked image costs nothing. -->
  <tr><td style="padding:28px 32px 0 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right:10px;vertical-align:middle;">
        <img src="${SITE}/apple-icon" width="32" height="32" alt=""
             style="display:block;width:32px;height:32px;border-radius:8px;">
      </td>
      <td style="vertical-align:middle;">
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                    font-size:16px;font-weight:700;letter-spacing:0.14em;color:${FG};">CAPX</div>
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                    font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};margin-top:2px;">
          Capital in Motion</div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:24px 32px 0 32px;
                 font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                 font-size:22px;line-height:1.3;font-weight:600;color:${FG};">
    ${esc(heading)}
  </td></tr>

  ${paragraphs.map((p) => `<tr><td style="padding:14px 32px 0 32px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
      font-size:14px;line-height:1.6;color:${FG};">${esc(p)}</td></tr>`).join("\n  ")}

  ${cta ? `<tr><td style="padding:24px 32px 0 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="border-radius:999px;background:${ACCENT};">
        <a href="${esc(cta.href)}"
           style="display:inline-block;padding:12px 26px;border-radius:999px;
                  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                  font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(cta.label)}</a>
      </td>
    </tr></table>
  </td></tr>` : ""}

  ${note ? `<tr><td style="padding:22px 32px 0 32px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
      font-size:12px;line-height:1.6;color:${MUTED};">${esc(note)}</td></tr>` : ""}

  <tr><td style="padding:26px 32px 28px 32px;">
    <div style="height:1px;background:${LINE};line-height:1px;font-size:0;">&nbsp;</div>
    <div style="padding-top:16px;
                font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                font-size:11px;line-height:1.6;color:${MUTED};">
      CAPX · Dar es Salaam, Tanzania<br>
      Shares are held in custody by a licensed broker. Your money stays yours.<br>
      <a href="${SITE}" style="color:${MUTED};">capx.broker</a>
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

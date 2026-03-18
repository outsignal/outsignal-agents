/**
 * Shared email template layout for all Outsignal client-facing emails.
 *
 * Light-first design: white header with logo, #635BFF accent line,
 * warm stone neutrals, purple CTA buttons.
 */

const FONT_STACK = "'Geist Sans', system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const LOGO_URL = "https://admin.outsignal.ai/images/outsignal-logo.png";

interface EmailSection {
  /** Main body HTML (goes inside the white card) */
  body: string;
  /** Footer context line, e.g. "This is a one-time login link for your Rise dashboard." */
  footerNote: string;
}

/** Generate a purple CTA button. Use inside the body HTML. */
export function emailButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
    <tr>
      <td align="center" style="background-color:#635BFF;border-radius:8px;">
        <a href="${href}" target="_blank" style="display:inline-block;padding:14px 40px;font-family:${FONT_STACK};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}

/** Generate a muted info/notice box. Use inside the body HTML. */
export function emailNotice(text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td style="background-color:#F8F7F5;border-radius:8px;padding:14px 18px;">
        <p style="margin:0;font-family:${FONT_STACK};font-size:13px;color:#6B6B6B;line-height:1.6;">
          ${text}
        </p>
      </td>
    </tr>
  </table>`;
}

/** Generate the full email HTML with shared header, body wrapper, and footer. */
export function emailLayout({ body, footerNote }: EmailSection): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#F8F7F5;-webkit-font-smoothing:antialiased;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F8F7F5;margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:48px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
        <!-- Header -->
        <tr>
          <td align="center" style="padding:32px 40px 24px 40px;">
            <img src="${LOGO_URL}" alt="Outsignal" width="160" height="32" style="display:block;border:0;outline:none;text-decoration:none;" />
          </td>
        </tr>
        <!-- Purple accent line -->
        <tr>
          <td style="padding:0 40px;">
            <div style="height:2px;background-color:#635BFF;border-radius:1px;"></div>
          </td>
        </tr>
        <!-- Body card -->
        <tr>
          <td style="padding:0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff;border-radius:12px;overflow:hidden;margin-top:24px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
              <tr>
                <td style="padding:40px 40px 36px 40px;">
                  ${body}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:28px 40px 0 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:${FONT_STACK};font-size:12px;color:#A1A1A1;line-height:1.6;padding-bottom:6px;">
                  ${footerNote}
                </td>
              </tr>
              <tr>
                <td style="font-family:${FONT_STACK};font-size:12px;line-height:1.6;">
                  <a href="https://outsignal.ai" target="_blank" style="color:#635BFF;text-decoration:none;font-weight:600;">outsignal.ai</a>
                  <span style="color:#D4D4D4;padding:0 6px;">·</span>
                  <span style="color:#A1A1A1;">B2B outreach, managed for you.</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

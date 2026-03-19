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

/** Generate a heading + subtitle block for the top of the email body */
export function emailHeading(title: string, subtitle?: string, options?: { titleColor?: string }): string {
  const titleColor = options?.titleColor ?? "#18181b";
  return `<p style="margin:0 0 ${subtitle ? '6' : '20'}px 0;font-family:${FONT_STACK};font-size:22px;font-weight:700;color:${titleColor};line-height:1.3;">${title}</p>${
    subtitle
      ? `<p style="margin:0 0 24px 0;font-family:${FONT_STACK};font-size:14px;color:#A1A1A1;line-height:1.5;">${subtitle}</p>`
      : ""
  }`;
}

/** Generate a colored status pill */
export function emailPill(label: string, color: string, bgColor: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
    <tr>
      <td style="font-family:${FONT_STACK};font-size:13px;font-weight:600;color:${color};background-color:${bgColor};padding:6px 14px;border-radius:100px;">${label}</td>
    </tr>
  </table>`;
}

/** Generate a detail card with labeled rows */
export function emailDetailCard(rows: Array<{ label: string; value: string; mono?: boolean }>): string {
  const rowsHtml = rows
    .map(
      (r, i) =>
        `<tr>
          <td style="padding:${i === 0 ? '14px' : '12px'} 18px ${i === rows.length - 1 ? '14px' : '0'} 18px;">
            <p style="font-family:${FONT_STACK};font-size:11px;font-weight:600;letter-spacing:1px;color:#A1A1A1;margin:0 0 4px 0;text-transform:uppercase;">${r.label}</p>
            <p style="font-family:${r.mono ? "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace" : FONT_STACK};font-size:${i === 0 ? '15' : '14'}px;color:#18181b;margin:0;${i === 0 ? 'font-weight:600;' : ''}">${r.value}</p>
          </td>
        </tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F8F7F5;border-radius:8px;border:1px solid #E8E6E3;margin-bottom:24px;">
    ${rowsHtml}
  </table>`;
}

/** Generate a section label (uppercase muted) */
export function emailLabel(text: string): string {
  return `<p style="font-family:${FONT_STACK};font-size:11px;font-weight:600;letter-spacing:1px;color:#A1A1A1;margin:0 0 10px 0;text-transform:uppercase;">${text}</p>`;
}

/** Generate a text paragraph */
export function emailText(text: string, options?: { preWrap?: boolean; size?: number }): string {
  const size = options?.size ?? 14;
  const whiteSpace = options?.preWrap ? "white-space:pre-wrap;" : "";
  return `<p style="font-family:${FONT_STACK};font-size:${size}px;line-height:1.7;color:#3f3f46;margin:0 0 24px 0;${whiteSpace}">${text}</p>`;
}

/** Generate a highlighted callout box (accent left border) */
export function emailCallout(text: string, options?: { borderColor?: string; bgColor?: string; textColor?: string }): string {
  const borderColor = options?.borderColor ?? "#635BFF";
  const bgColor = options?.bgColor ?? "#F8F7F5";
  const textColor = options?.textColor ?? "#374151";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
    <tr>
      <td style="background-color:${bgColor};border-left:3px solid ${borderColor};padding:14px 18px;border-radius:0 6px 6px 0;">
        <p style="font-family:${FONT_STACK};font-size:14px;line-height:1.6;white-space:pre-wrap;margin:0;color:${textColor};">${text}</p>
      </td>
    </tr>
  </table>`;
}

/** Generate a stat box with large number and label */
export function emailStatBox(value: string | number, label: string, color: string, bgColor: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td style="background-color:${bgColor};border-radius:8px;padding:16px 20px;text-align:center;">
        <p style="font-family:${FONT_STACK};font-size:28px;font-weight:700;color:${color};margin:0;line-height:1;">${value}</p>
        <p style="font-family:${FONT_STACK};font-size:12px;color:${color};margin:6px 0 0 0;font-weight:600;">${label}</p>
      </td>
    </tr>
  </table>`;
}

/** Generate a two-column stat row */
export function emailStatRow(left: string, right: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
    <tr>
      <td width="50%" style="padding-right:8px;" valign="top">${left}</td>
      <td width="50%" style="padding-left:8px;" valign="top">${right}</td>
    </tr>
  </table>`;
}

/** Generate a three-column stat row */
export function emailStatRow3(col1: string, col2: string, col3: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
    <tr>
      <td width="33%" align="center" style="padding:4px;">${col1}</td>
      <td width="33%" align="center" style="padding:4px;">${col2}</td>
      <td width="33%" align="center" style="padding:4px;">${col3}</td>
    </tr>
  </table>`;
}

/** Generate a banner/alert box */
export function emailBanner(text: string, options: { color: string; bgColor: string; borderColor?: string }): string {
  const border = options.borderColor ? `border:1px solid ${options.borderColor};` : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
    <tr>
      <td style="background-color:${options.bgColor};${border}padding:16px 20px;border-radius:8px;">
        <p style="font-family:${FONT_STACK};font-size:14px;line-height:1.5;margin:0;color:${options.color};font-weight:600;">${text}</p>
      </td>
    </tr>
  </table>`;
}

/** Generate a divider line */
export function emailDivider(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
    <tr>
      <td style="border-top:1px solid #E8E6E3;padding:0;"></td>
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
            <img src="${LOGO_URL}" alt="Outsignal" width="240" height="48" style="display:block;border:0;outline:none;text-decoration:none;" />
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

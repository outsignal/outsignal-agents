// --- EmailBison test email sender for placement testing ---
// Sends a realistic campaign-style email to a mail-tester.com address
// to evaluate inbox placement for a given sender identity.
//
// Uses the dedicated IP endpoint (dedi.emailbison.com) directly — NOT the
// app.outsignal.ai client — so the test reflects dedicated IP reputation.

const LOG_PREFIX = "[placement/send-test]";

export interface SendTestEmailParams {
  senderEmailId: number;
  toAddress: string;      // mail-tester.com test address
  workspaceToken: string; // EmailBison workspace API token
}

export interface SendTestEmailResult {
  success: boolean;
  error?: string;
}

/**
 * Sends a realistic campaign-style email from a given sender to a
 * mail-tester.com test address via EmailBison's dedicated IP endpoint.
 *
 * The email content mimics a real cold outreach message so that spam
 * filters evaluate it the same way they would a live campaign email.
 */
export async function sendTestEmail(
  params: SendTestEmailParams
): Promise<SendTestEmailResult> {
  const { senderEmailId, toAddress, workspaceToken } = params;

  const subject = "Quick question about your team's approach";

  const message = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <tr>
      <td>
        <p>Hi {{first_name}},</p>

        <p>
          I was looking at what {{company_name}} is doing in the market and noticed you're scaling
          your outbound motion — really impressive growth over the past quarter.
        </p>

        <p>
          We work with B2B teams to build targeted lead lists using signal-based prospecting (job
          changes, funding rounds, hiring spikes). Most of our clients see a 2-3x lift in reply
          rates within the first 30 days.
        </p>

        <p>
          Would it make sense to have a quick 20-minute call this week to see if there's a fit?
          I can share a few examples from similar companies in your space.
        </p>

        <p>
          <a href="https://admin.outsignal.ai" style="display:inline-block;background-color:#F0FF7A;color:#1a1a1a;font-weight:700;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:13px;">
            Book a Call
          </a>
        </p>

        <p>
          Best,<br>
          Jonathan<br>
          <span style="color:#6b7280;font-size:13px;">Outsignal | B2B Lead Generation<br>
          <a href="https://outsignal.ai" style="color:#6b7280;">outsignal.ai</a></span>
        </p>

        <p style="font-size:11px;color:#9ca3af;margin-top:32px;border-top:1px solid #e5e7eb;padding-top:16px;">
          You're receiving this because your company matched our ICP criteria.
          To unsubscribe, reply with "unsubscribe" in the subject line.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const body = {
    sender_email_id: senderEmailId,
    to_emails: [toAddress],
    subject,
    message,
    content_type: "html",
    use_dedicated_ips: true,
  };

  let res: Response;
  try {
    res = await fetch("https://dedi.emailbison.com/api/replies/new", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${workspaceToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} Network error sending test email:`, message);
    return { success: false, error: `Network error: ${message}` };
  }

  if (!res.ok) {
    let errorBody = "";
    try {
      errorBody = await res.text();
    } catch {
      errorBody = "(could not read response body)";
    }
    console.error(
      `${LOG_PREFIX} sendTestEmail failed: HTTP ${res.status} — ${errorBody}`
    );
    return {
      success: false,
      error: `HTTP ${res.status}: ${errorBody}`,
    };
  }

  console.log(
    `${LOG_PREFIX} Test email sent successfully to ${toAddress} via sender_email_id=${senderEmailId}`
  );
  return { success: true };
}

/**
 * Domain health notification functions.
 * Admin-only notifications — uses ALERTS_SLACK_CHANNEL_ID and ADMIN_EMAIL.
 * All sends are wrapped with audited() for audit trail logging.
 */

import { postMessage } from "@/lib/slack";
import { sendNotificationEmail } from "@/lib/resend";
import { audited } from "@/lib/notification-audit";
import { verifyEmailRecipients, verifySlackChannel } from "@/lib/notification-guard";
import { emailLayout, emailHeading, emailButton, emailText, emailPill, emailBanner, emailDivider, emailLabel } from "@/lib/email-template";
import type { KnownBlock } from "@slack/web-api";

const LOG_PREFIX = "[domain-health/notifications]";
const FONT_STACK = "'Geist Sans', system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const DASHBOARD_URL = "https://admin.outsignal.ai";
const FOOTER_NOTE = "Domain health monitoring alert from Outsignal.";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAdminEmail(): string | null {
  return process.env.ADMIN_EMAIL ?? null;
}

function getAlertsChannelId(): string | null {
  return process.env.ALERTS_SLACK_CHANNEL_ID ?? null;
}

function tierBadge(tier: string): string {
  return tier === "critical" ? ":red_circle: *CRITICAL*" : ":warning: WARNING";
}

// ---------------------------------------------------------------------------
// notifyBlacklistHit
// ---------------------------------------------------------------------------

/**
 * Send admin notification when a domain is listed on one or more DNSBLs.
 * Sends both Slack and email.
 * Fire once per NEW listing — caller is responsible for deduplication.
 */
export async function notifyBlacklistHit(params: {
  domain: string;
  hits: Array<{ list: string; tier: string; delistUrl?: string }>;
  skipEmail?: boolean;
}): Promise<void> {
  const { domain, hits, skipEmail } = params;
  const hasCritical = hits.some((h) => h.tier === "critical");
  const severityEmoji = hasCritical ? ":rotating_light:" : ":warning:";
  const headerText = `${severityEmoji} Domain Blacklisted: ${domain}`;

  // --- Slack ---
  const alertsChannelId = getAlertsChannelId();
  if (alertsChannelId) {
    if (verifySlackChannel(alertsChannelId, "admin", "notifyBlacklistHit")) {
      const hitLines = hits
        .map((h) => {
          const badge = tierBadge(h.tier);
          const delist = h.delistUrl ? ` — <${h.delistUrl}|Request Removal>` : "";
          return `• ${badge}: ${h.list}${delist}`;
        })
        .join("\n");

      const blocks: KnownBlock[] = [
        {
          type: "header",
          text: { type: "plain_text", text: `Domain Blacklisted: ${domain}` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Domain:* \`${domain}\`\n*Listed on ${hits.length} DNSBL${hits.length !== 1 ? "s" : ""}:*\n${hitLines}`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Deliverability is at risk. Delist as soon as possible.`,
            },
          ],
        },
      ];

      try {
        await audited(
          {
            notificationType: "domain_blacklisted",
            channel: "slack",
            recipient: alertsChannelId,
            metadata: { domain, hits: hits.length, hasCritical },
          },
          () => postMessage(alertsChannelId, headerText, blocks),
        );
      } catch (err) {
        console.error(`${LOG_PREFIX} Failed to send blacklist Slack alert for ${domain}:`, err);
      }
    }
  }

  // --- Email (skipped when batching) ---
  if (!skipEmail) {
    const adminEmail = getAdminEmail();
    if (adminEmail) {
      const verified = verifyEmailRecipients([adminEmail], "admin", "notifyBlacklistHit");
      if (verified.length > 0) {
        const hitRowsHtml = hits
          .map((h) => {
            const pillColor = h.tier === "critical" ? "#dc2626" : "#d97706";
            const pillBg = h.tier === "critical" ? "#fef2f2" : "#fffbeb";
            const pillLabel = h.tier === "critical" ? "CRITICAL" : "WARNING";
            const delistLink = h.delistUrl
              ? ` &mdash; <a href="${h.delistUrl}" style="color:#635BFF;text-decoration:none;font-weight:600;">Request Removal</a>`
              : "";
            return `<tr>
              <td style="padding:6px 0;font-family:${FONT_STACK};font-size:13px;color:#3f3f46;">
                <span style="display:inline-block;background-color:${pillBg};color:${pillColor};font-size:11px;font-weight:700;padding:2px 8px;border-radius:100px;margin-right:8px;">${pillLabel}</span>
                ${h.list}${delistLink}
              </td>
            </tr>`;
          })
          .join("");

        const severityBanner = hasCritical
          ? emailBanner("Critical blacklisting detected. Deliverability is at immediate risk.", { color: "#dc2626", bgColor: "#fef2f2", borderColor: "#fecaca" })
          : emailBanner("Domain blacklisted. Deliverability may be impacted.", { color: "#d97706", bgColor: "#fffbeb", borderColor: "#fde68a" });

        const body = [
          emailHeading(`Domain Blacklisted: ${domain}`),
          severityBanner,
          emailText(`The domain <strong>${domain}</strong> has been detected on ${hits.length} DNSBL${hits.length !== 1 ? "s" : ""}. This may impact email deliverability for all senders on this domain.`),
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">${hitRowsHtml}</table>`,
          emailText("Use the removal links above to request delisting. Critical listings should be resolved within 24 hours.", { size: 13 }),
          emailButton("View Domain Health", `${DASHBOARD_URL}/domain-health`),
        ].join("");

        const html = emailLayout({ body, footerNote: FOOTER_NOTE });

        try {
          await audited(
            {
              notificationType: "domain_blacklisted",
              channel: "email",
              recipient: verified.join(","),
              metadata: { domain, hits: hits.length, hasCritical },
            },
            () =>
              sendNotificationEmail({
                to: verified,
                subject: `[Outsignal] Domain Blacklisted: ${domain} (${hits.length} listing${hits.length !== 1 ? "s" : ""})`,
                html,
              }),
          );
        } catch (err) {
          console.error(`${LOG_PREFIX} Failed to send blacklist email alert for ${domain}:`, err);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// notifyBlacklistDelisted
// ---------------------------------------------------------------------------

/**
 * Send positive Slack notification when a domain is removed from blacklists.
 * Slack only — no email for positive news.
 */
export async function notifyBlacklistDelisted(params: {
  domain: string;
  delistedFrom: string[];
}): Promise<void> {
  const { domain, delistedFrom } = params;
  const headerText = `:white_check_mark: Domain Delisted: ${domain}`;

  const alertsChannelId = getAlertsChannelId();
  if (!alertsChannelId) return;
  if (!verifySlackChannel(alertsChannelId, "admin", "notifyBlacklistDelisted")) return;

  const listNames = delistedFrom.map((l) => `• ${l}`).join("\n");

  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `\u2705 Domain Delisted: ${domain}`, emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Domain:* \`${domain}\`\n*Removed from ${delistedFrom.length} DNSBL${delistedFrom.length !== 1 ? "s" : ""}:*\n${listNames}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: ":white_check_mark: Deliverability should be restored. Monitor bounce rates over the next 24 hours.",
        },
      ],
    },
  ];

  try {
    await audited(
      {
        notificationType: "domain_delisted",
        channel: "slack",
        recipient: alertsChannelId,
        metadata: { domain, count: delistedFrom.length },
      },
      () => postMessage(alertsChannelId, headerText, blocks),
    );
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to send delist Slack notification for ${domain}:`, err);
  }
}

// ---------------------------------------------------------------------------
// notifyDnsFailure
// ---------------------------------------------------------------------------

/**
 * Send admin notification for DNS validation failures.
 * - persistent=false (first detection): WARNING severity
 * - persistent=true (>48h unresolved): CRITICAL escalation
 * Both Slack and email.
 */
export async function notifyDnsFailure(params: {
  domain: string;
  failures: Array<{ check: "spf" | "dkim" | "dmarc" | "mx"; status: string }>;
  persistent: boolean;
  skipEmail?: boolean;
}): Promise<void> {
  const { domain, failures, persistent, skipEmail } = params;
  const severity = persistent ? "critical" : "warning";
  const severityLabel = persistent ? "CRITICAL" : "Warning";
  const emoji = persistent ? ":rotating_light:" : ":warning:";
  const headerText = `${emoji} DNS ${severityLabel}: ${domain}`;

  const checkLabels: Record<string, string> = {
    spf: "SPF",
    dkim: "DKIM",
    dmarc: "DMARC",
    mx: "MX",
  };

  const failureLines = failures
    .map((f) => `• ${checkLabels[f.check] ?? f.check}: \`${f.status}\``)
    .join("\n");

  const escalationNote = persistent
    ? "\n\n:rotating_light: *This issue has been persisting for 48+ hours. Immediate action required.*"
    : "";

  // --- Slack ---
  const alertsChannelId = getAlertsChannelId();
  if (alertsChannelId) {
    if (verifySlackChannel(alertsChannelId, "admin", "notifyDnsFailure")) {
      const blocks: KnownBlock[] = [
        {
          type: "header",
          text: { type: "plain_text", text: `DNS ${severityLabel}: ${domain}` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Domain:* \`${domain}\`\n*Failed checks:*\n${failureLines}${escalationNote}`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: persistent
                ? "DNS misconfiguration has been present for 48+ hours. Deliverability impact is likely."
                : "DNS validation failed. Check records and allow up to 24 hours for propagation.",
            },
          ],
        },
      ];

      try {
        await audited(
          {
            notificationType: "domain_dns_failure",
            channel: "slack",
            recipient: alertsChannelId,
            metadata: { domain, severity, checks: failures.map((f) => f.check), persistent },
          },
          () => postMessage(alertsChannelId, headerText, blocks),
        );
      } catch (err) {
        console.error(`${LOG_PREFIX} Failed to send DNS failure Slack alert for ${domain}:`, err);
      }
    }
  }

  // --- Email (skipped when batching) ---
  if (!skipEmail) {
    const adminEmail = getAdminEmail();
    if (adminEmail) {
      const verified = verifyEmailRecipients([adminEmail], "admin", "notifyDnsFailure");
      if (verified.length > 0) {
        const failurePillsHtml = failures
          .map((f) => {
            const label = checkLabels[f.check] ?? f.check;
            return emailPill(`${label}: ${f.status}`, "#dc2626", "#fef2f2");
          })
          .join("");

        const escalationBanner = persistent
          ? emailBanner("This DNS misconfiguration has been present for over 48 hours. Immediate action required.", { color: "#dc2626", bgColor: "#fef2f2", borderColor: "#fecaca" })
          : "";

        const body = [
          emailHeading(`DNS ${severityLabel}: ${domain}`),
          persistent
            ? emailPill("CRITICAL — 48h+ PERSISTENT", "#dc2626", "#fef2f2")
            : emailPill("WARNING", "#d97706", "#fffbeb"),
          emailText(`DNS validation failed for <strong>${domain}</strong>. The following checks did not pass:`),
          failurePillsHtml,
          escalationBanner,
          emailText("DNS changes may take up to 24 hours to propagate. Verify records using a DNS lookup tool.", { size: 13 }),
          emailButton("View Domain Health", `${DASHBOARD_URL}/domain-health`),
        ].join("");

        const html = emailLayout({ body, footerNote: FOOTER_NOTE });

        try {
          await audited(
            {
              notificationType: "domain_dns_failure",
              channel: "email",
              recipient: verified.join(","),
              metadata: { domain, severity, checks: failures.map((f) => f.check), persistent },
            },
            () =>
              sendNotificationEmail({
                to: verified,
                subject: `[Outsignal] DNS ${severityLabel}: ${domain} — ${failures.map((f) => checkLabels[f.check] ?? f.check).join(", ")} failed`,
                html,
              }),
          );
        } catch (err) {
          console.error(`${LOG_PREFIX} Failed to send DNS failure email alert for ${domain}:`, err);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Batch digest emails
// ---------------------------------------------------------------------------

export interface BlacklistDigestItem {
  domain: string;
  hits: Array<{ list: string; tier: string; delistUrl?: string }>;
}

export interface DnsFailureDigestItem {
  domain: string;
  failures: Array<{ check: string; status: string }>;
  persistent: boolean;
}

/**
 * Send a single digest email covering blacklist hits across all domains.
 */
export async function sendBlacklistDigestEmail(
  items: BlacklistDigestItem[],
): Promise<void> {
  if (items.length === 0) return;

  const adminEmail = getAdminEmail();
  if (!adminEmail) return;
  const verified = verifyEmailRecipients([adminEmail], "admin", "sendBlacklistDigestEmail");
  if (verified.length === 0) return;

  const totalHits = items.reduce((sum, item) => sum + item.hits.length, 0);
  const hasCritical = items.some((item) => item.hits.some((h) => h.tier === "critical"));

  const domainSectionsHtml = items
    .map((item) => {
      const hitRowsHtml = item.hits
        .map((h) => {
          const pillColor = h.tier === "critical" ? "#dc2626" : "#d97706";
          const pillBg = h.tier === "critical" ? "#fef2f2" : "#fffbeb";
          const pillLabel = h.tier === "critical" ? "CRITICAL" : "WARNING";
          const delistLink = h.delistUrl
            ? ` &mdash; <a href="${h.delistUrl}" style="color:#635BFF;text-decoration:none;font-weight:600;">Request Removal</a>`
            : "";
          return `<tr>
            <td style="padding:4px 0 4px 16px;font-family:${FONT_STACK};font-size:13px;color:#3f3f46;">
              <span style="display:inline-block;background-color:${pillBg};color:${pillColor};font-size:11px;font-weight:700;padding:2px 8px;border-radius:100px;margin-right:8px;">${pillLabel}</span>
              ${h.list}${delistLink}
            </td>
          </tr>`;
        })
        .join("");

      return [
        emailDivider(),
        emailLabel(`${item.domain} — ${item.hits.length} listing${item.hits.length !== 1 ? "s" : ""}`),
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:16px;">${hitRowsHtml}</table>`,
      ].join("");
    })
    .join("");

  const body = [
    emailHeading(`Blacklist Alert: ${items.length} Domain${items.length !== 1 ? "s" : ""} Listed`),
    emailText(`${items.length} domain${items.length !== 1 ? "s have" : " has"} been detected on DNSBLs (${totalHits} total listing${totalHits !== 1 ? "s" : ""}). This may impact email deliverability.`),
    domainSectionsHtml,
    emailText("Use the removal links above to request delisting. Critical listings should be resolved within 24 hours.", { size: 13 }),
    emailButton("View Domain Health", `${DASHBOARD_URL}/domain-health`),
  ].join("");

  const html = emailLayout({ body, footerNote: FOOTER_NOTE });

  try {
    await audited(
      {
        notificationType: "domain_blacklisted_digest",
        channel: "email",
        recipient: verified.join(","),
        metadata: { domains: items.length, totalHits, hasCritical },
      },
      () =>
        sendNotificationEmail({
          to: verified,
          subject: `[Outsignal] Blacklist Alert: ${items.length} domain${items.length !== 1 ? "s" : ""}, ${totalHits} listing${totalHits !== 1 ? "s" : ""}`,
          html,
        }),
    );
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to send blacklist digest email:`, err);
  }
}

/**
 * Send a single digest email covering DNS failures across all domains.
 */
export async function sendDnsFailureDigestEmail(
  items: DnsFailureDigestItem[],
): Promise<void> {
  if (items.length === 0) return;

  const adminEmail = getAdminEmail();
  if (!adminEmail) return;
  const verified = verifyEmailRecipients([adminEmail], "admin", "sendDnsFailureDigestEmail");
  if (verified.length === 0) return;

  const hasPersistent = items.some((item) => item.persistent);
  const severityLabel = hasPersistent ? "CRITICAL" : "Warning";

  const checkLabels: Record<string, string> = {
    spf: "SPF",
    dkim: "DKIM",
    dmarc: "DMARC",
    mx: "MX",
  };

  const domainSectionsHtml = items
    .map((item) => {
      const failurePillsHtml = item.failures
        .map((f) => {
          const label = checkLabels[f.check] ?? f.check;
          return emailPill(`${label}: ${f.status}`, "#dc2626", "#fef2f2");
        })
        .join("");

      const persistentPill = item.persistent
        ? emailPill("48h+ PERSISTENT", "#dc2626", "#fef2f2")
        : "";

      return [
        emailDivider(),
        emailLabel(item.domain),
        persistentPill,
        failurePillsHtml,
      ].join("");
    })
    .join("");

  const escalationBanner = hasPersistent
    ? emailBanner("One or more domains have had DNS misconfigurations for over 48 hours. Immediate action required.", { color: "#dc2626", bgColor: "#fef2f2", borderColor: "#fecaca" })
    : "";

  const body = [
    emailHeading(`DNS ${severityLabel}: ${items.length} Domain${items.length !== 1 ? "s" : ""} Failing`),
    emailText(`DNS validation failed for ${items.length} domain${items.length !== 1 ? "s" : ""}. The following checks did not pass:`),
    domainSectionsHtml,
    escalationBanner,
    emailText("DNS changes may take up to 24 hours to propagate. Verify records using a DNS lookup tool.", { size: 13 }),
    emailButton("View Domain Health", `${DASHBOARD_URL}/domain-health`),
  ].join("");

  const html = emailLayout({ body, footerNote: FOOTER_NOTE });

  try {
    await audited(
      {
        notificationType: "domain_dns_failure_digest",
        channel: "email",
        recipient: verified.join(","),
        metadata: {
          domains: items.length,
          hasPersistent,
          checks: items.flatMap((i) => i.failures.map((f) => f.check)),
        },
      },
      () =>
        sendNotificationEmail({
          to: verified,
          subject: `[Outsignal] DNS ${severityLabel}: ${items.length} domain${items.length !== 1 ? "s" : ""} failing validation`,
          html,
        }),
    );
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to send DNS failure digest email:`, err);
  }
}


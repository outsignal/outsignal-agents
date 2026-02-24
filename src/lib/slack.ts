import { WebClient, type KnownBlock } from "@slack/web-api";

function getSlackClient(): WebClient | null {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;
  return new WebClient(token);
}

export async function createPrivateChannel(
  name: string,
): Promise<string | null> {
  const slack = getSlackClient();
  if (!slack) {
    console.warn("SLACK_BOT_TOKEN not set, skipping channel creation");
    return null;
  }

  const channelName = name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);

  const result = await slack.conversations.create({
    name: channelName,
    is_private: true,
  });

  if (!result.channel?.id) {
    throw new Error("Failed to create Slack channel");
  }

  return result.channel.id;
}

/**
 * Look up a Slack user ID by email address.
 * Returns null if the user is not found in the workspace.
 * Requires the `users:read.email` bot scope.
 */
export async function lookupUserByEmail(
  email: string,
): Promise<string | null> {
  const slack = getSlackClient();
  if (!slack) return null;

  try {
    const result = await slack.users.lookupByEmail({ email });
    return result.user?.id ?? null;
  } catch (err: unknown) {
    const slackErr = err as { data?: { error?: string } };
    if (slackErr.data?.error === "users_not_found") {
      return null;
    }
    throw err;
  }
}

/**
 * Invite one or more users to a channel by their Slack user IDs.
 * Requires `groups:write` scope for private channels.
 */
export async function inviteToChannel(
  channelId: string,
  userIds: string[],
): Promise<void> {
  const slack = getSlackClient();
  if (!slack || userIds.length === 0) return;

  await slack.conversations.invite({
    channel: channelId,
    users: userIds.join(","),
  });
}

/**
 * Send a Slack Connect invite to an external email.
 * Requires `conversations.connect:write` scope and a paid Slack plan.
 * Returns true if the invite was sent, false if not available.
 */
export async function inviteExternalByEmail(
  channelId: string,
  email: string,
): Promise<boolean> {
  const slack = getSlackClient();
  if (!slack) return false;

  try {
    await slack.conversations.inviteShared({
      channel: channelId,
      emails: [email],
    });
    return true;
  } catch (err: unknown) {
    const slackErr = err as { data?: { error?: string } };
    // not_paid = free plan, missing_scope = scope not added
    if (
      slackErr.data?.error === "not_paid" ||
      slackErr.data?.error === "missing_scope"
    ) {
      console.warn(
        `Slack Connect not available (${slackErr.data.error}), skipping external invite for ${email}`,
      );
      return false;
    }
    console.error(`Failed to send Slack Connect invite to ${email}:`, err);
    return false;
  }
}

/**
 * Create a private channel, invite users by email, and return the channel ID.
 * - Workspace members get invited directly via conversations.invite
 * - External users get a Slack Connect invite (requires paid plan)
 */
export async function createChannelWithMembers(
  channelName: string,
  emails: string[],
): Promise<string | null> {
  const channelId = await createPrivateChannel(channelName);
  if (!channelId) return null;

  const userIds: string[] = [];
  const externalEmails: string[] = [];

  for (const email of emails) {
    try {
      const userId = await lookupUserByEmail(email);
      if (userId) {
        userIds.push(userId);
      } else {
        externalEmails.push(email);
      }
    } catch (err) {
      console.error(`Failed to look up ${email}:`, err);
      externalEmails.push(email);
    }
  }

  // Invite workspace members directly
  if (userIds.length > 0) {
    try {
      await inviteToChannel(channelId, userIds);
    } catch (err) {
      console.error("Failed to invite users to channel:", err);
    }
  }

  // Send Slack Connect invites to external users
  for (const email of externalEmails) {
    await inviteExternalByEmail(channelId, email);
  }

  return channelId;
}

export async function postMessage(
  channelId: string,
  text: string,
  blocks?: KnownBlock[],
): Promise<void> {
  const slack = getSlackClient();
  if (!slack) {
    console.warn("SLACK_BOT_TOKEN not set, skipping message");
    return;
  }

  await slack.chat.postMessage({
    channel: channelId,
    text,
    blocks,
  });
}

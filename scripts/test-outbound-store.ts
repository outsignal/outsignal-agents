/**
 * Test script for "store outbound messages at send time" feature.
 *
 * Tests two paths:
 * 1. POST /api/linkedin/actions/{id}/complete — stores outbound message when conversation exists
 * 2. POST /api/linkedin/sync/push — attaches outbound messages from completed actions to new conversations
 *
 * Run: npx tsx scripts/test-outbound-store.ts
 * Requires: dev server running at http://localhost:3000
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BASE_URL = "http://localhost:3000";
const API_SECRET = process.env.WORKER_API_SECRET;

if (!API_SECRET) {
  console.error("WORKER_API_SECRET not found in .env");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${API_SECRET}`,
};

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Test 1: Complete action stores outbound message (existing conversation)
// ---------------------------------------------------------------------------
async function testCompleteStoresMessage() {
  console.log("\n--- Test 1: /actions/{id}/complete stores outbound message ---");

  // Find a real sender
  const sender = await prisma.sender.findFirst({
    select: { id: true, workspaceSlug: true },
  });
  if (!sender) {
    console.error("  SKIP: No sender found in DB");
    return;
  }

  // Find or create a person in this workspace
  const person = await prisma.person.findFirst({
    where: {
      workspaces: { some: { workspace: sender.workspaceSlug } },
    },
    select: { id: true },
  });
  if (!person) {
    console.error("  SKIP: No person found for workspace " + sender.workspaceSlug);
    return;
  }

  const testConvId = `test-conv-${Date.now()}`;

  // Create a test conversation for this sender+person
  const conversation = await prisma.linkedInConversation.create({
    data: {
      conversationId: testConvId,
      entityUrn: `urn:li:test:${testConvId}`,
      senderId: sender.id,
      workspaceSlug: sender.workspaceSlug,
      personId: person.id,
      lastActivityAt: new Date(),
    },
  });

  // Create a test action (message, pending)
  const action = await prisma.linkedInAction.create({
    data: {
      senderId: sender.id,
      personId: person.id,
      workspaceSlug: sender.workspaceSlug,
      actionType: "message",
      messageBody: "Test outbound message from test script",
      scheduledFor: new Date(),
      status: "pending",
    },
  });

  // Call the complete endpoint
  const res = await fetch(`${BASE_URL}/api/linkedin/actions/${action.id}/complete`, {
    method: "POST",
    headers,
    body: JSON.stringify({ result: { success: true } }),
  });

  assert(res.ok, `Complete endpoint returned ${res.status} (expected 200)`);

  const expectedUrn = `urn:outsignal:outbound:${action.id}`;

  // Check that the outbound message was created
  const message = await prisma.linkedInMessage.findUnique({
    where: { eventUrn: expectedUrn },
  });

  assert(message !== null, "LinkedInMessage was created");
  assert(message?.conversationId === conversation.id, "Message linked to correct conversation");
  assert(message?.isOutbound === true, "Message marked as outbound");
  assert(message?.body === "Test outbound message from test script", "Message body matches");

  // Cleanup
  if (message) await prisma.linkedInMessage.delete({ where: { id: message.id } });
  await prisma.linkedInAction.delete({ where: { id: action.id } });
  await prisma.linkedInConversation.delete({ where: { id: conversation.id } });
  console.log("  Cleanup done.");
}

// ---------------------------------------------------------------------------
// Test 2: Sync push attaches outbound messages from completed actions
// ---------------------------------------------------------------------------
async function testSyncPushAttachesOutbound() {
  console.log("\n--- Test 2: /sync/push attaches outbound messages ---");

  // Find a real sender
  const sender = await prisma.sender.findFirst({
    select: { id: true, workspaceSlug: true },
  });
  if (!sender) {
    console.error("  SKIP: No sender found in DB");
    return;
  }

  // Find a person with a linkedinUrl so the push can match them
  const person = await prisma.person.findFirst({
    where: {
      workspaces: { some: { workspace: sender.workspaceSlug } },
      linkedinUrl: { not: null },
    },
    select: { id: true, linkedinUrl: true, firstName: true, lastName: true },
  });
  if (!person) {
    console.error("  SKIP: No person with linkedinUrl found for workspace " + sender.workspaceSlug);
    return;
  }

  // Create a completed action for this sender+person (no conversation exists yet)
  const action = await prisma.linkedInAction.create({
    data: {
      senderId: sender.id,
      personId: person.id,
      workspaceSlug: sender.workspaceSlug,
      actionType: "message",
      messageBody: "Test sync push outbound message",
      scheduledFor: new Date(),
      status: "complete",
      completedAt: new Date(),
    },
  });

  const testConvId = `test-sync-conv-${Date.now()}`;
  const now = Date.now();

  // Push a conversation that matches this person via linkedinUrl
  const pushPayload = {
    senderId: sender.id,
    conversations: [
      {
        entityUrn: `urn:li:test:${testConvId}`,
        conversationId: testConvId,
        participantName: [person.firstName, person.lastName].filter(Boolean).join(" ") || "Test Person",
        participantUrn: "urn:li:member:test123",
        participantProfileUrl: person.linkedinUrl,
        participantHeadline: null,
        participantProfilePicUrl: null,
        lastActivityAt: now,
        unreadCount: 0,
        lastMessageSnippet: "Hey there",
        messages: [
          {
            eventUrn: `urn:li:test:msg:${now}`,
            senderUrn: "urn:li:member:test123",
            senderName: "Test Person",
            body: "Hey there, thanks for reaching out!",
            deliveredAt: now,
          },
        ],
      },
    ],
  };

  const res = await fetch(`${BASE_URL}/api/linkedin/sync/push`, {
    method: "POST",
    headers,
    body: JSON.stringify(pushPayload),
  });

  assert(res.ok, `Sync push endpoint returned ${res.status} (expected 200)`);

  const expectedUrn = `urn:outsignal:outbound:${action.id}`;

  // Check that the outbound message was attached
  const outboundMsg = await prisma.linkedInMessage.findUnique({
    where: { eventUrn: expectedUrn },
  });

  assert(outboundMsg !== null, "Outbound LinkedInMessage was created via sync push");
  assert(outboundMsg?.isOutbound === true, "Message marked as outbound");
  assert(outboundMsg?.body === "Test sync push outbound message", "Message body matches action messageBody");

  // Check the conversation was created
  const conv = await prisma.linkedInConversation.findUnique({
    where: { conversationId: testConvId },
  });
  assert(conv !== null, "LinkedInConversation was created");
  assert(conv?.personId === person.id, "Conversation matched to correct person");

  if (outboundMsg) {
    assert(outboundMsg.conversationId === conv?.id, "Outbound message linked to correct conversation");
  }

  // Cleanup
  // Delete messages first (FK constraint), then conversation, then action
  if (conv) {
    await prisma.linkedInMessage.deleteMany({ where: { conversationId: conv.id } });
    await prisma.linkedInConversation.delete({ where: { id: conv.id } });
  }
  // Clean up sync status that may have been created/updated
  await prisma.linkedInAction.delete({ where: { id: action.id } });
  console.log("  Cleanup done.");
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function main() {
  console.log("Testing outbound message storage feature");
  console.log(`Server: ${BASE_URL}`);
  console.log(`API secret: ${API_SECRET?.slice(0, 4)}...`);

  try {
    await testCompleteStoresMessage();
    await testSyncPushAttachesOutbound();
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  prisma.$disconnect();
  process.exit(1);
});

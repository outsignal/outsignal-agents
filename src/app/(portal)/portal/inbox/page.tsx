"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Mail, Linkedin } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  EmailThreadList,
  type ThreadSummary,
} from "@/components/portal/email-thread-list";
import { EmailThreadView } from "@/components/portal/email-thread-view";
import {
  LinkedInConversationList,
  type LinkedInConversationSummary,
} from "@/components/portal/linkedin-conversation-list";
import { LinkedInConversationView } from "@/components/portal/linkedin-conversation-view";

const ACTIVE_INTERVAL = 15_000;
const BACKGROUND_INTERVAL = 60_000;

export default function PortalInboxPage() {
  const [activeChannel, setActiveChannel] = useState<"email" | "linkedin">(
    "email"
  );

  // --- Email state ---
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- LinkedIn state ---
  const [linkedinConversations, setLinkedinConversations] = useState<
    LinkedInConversationSummary[]
  >([]);
  const [linkedinLoading, setLinkedinLoading] = useState(true);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);

  // Track whether we've auto-selected the first items
  const hasAutoSelectedEmail = useRef(false);
  const hasAutoSelectedLinkedin = useRef(false);

  const fetchThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/inbox/email/threads");
      if (!res.ok) throw new Error("Failed to load");
      const data = (await res.json()) as { threads: ThreadSummary[] };
      setThreads(data.threads);
      setError(null);
      return data.threads;
    } catch {
      setError("Failed to load inbox");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLinkedinConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/inbox/linkedin/conversations");
      if (!res.ok) throw new Error("Failed to load");
      const data = (await res.json()) as {
        conversations: LinkedInConversationSummary[];
      };
      setLinkedinConversations(data.conversations);
      return data.conversations;
    } catch {
      return null;
    } finally {
      setLinkedinLoading(false);
    }
  }, []);

  // Initial load + polling — both channels poll simultaneously
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    const load = async () => {
      const [emailResult, linkedinResult] = await Promise.all([
        fetchThreads(),
        fetchLinkedinConversations(),
      ]);

      // Auto-select first email thread
      if (
        emailResult &&
        emailResult.length > 0 &&
        !hasAutoSelectedEmail.current
      ) {
        setSelectedThreadId(emailResult[0].threadId);
        hasAutoSelectedEmail.current = true;
      }

      // Auto-select first LinkedIn conversation
      if (
        linkedinResult &&
        linkedinResult.length > 0 &&
        !hasAutoSelectedLinkedin.current
      ) {
        setSelectedConversationId(linkedinResult[0].id);
        hasAutoSelectedLinkedin.current = true;
      }
    };

    load();

    const getInterval = () =>
      document.visibilityState === "visible"
        ? ACTIVE_INTERVAL
        : BACKGROUND_INTERVAL;

    timer = setInterval(() => {
      fetchThreads();
      fetchLinkedinConversations();
    }, getInterval());

    const handleVisibility = () => {
      clearInterval(timer);
      timer = setInterval(() => {
        fetchThreads();
        fetchLinkedinConversations();
      }, getInterval());
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchThreads, fetchLinkedinConversations]);

  return (
    <div className="flex flex-col h-full">
      {/* Page header with channel toggle */}
      <div className="px-5 py-4 border-b border-border shrink-0">
        <h1 className="text-xl font-heading font-bold">Inbox</h1>
        <div className="flex gap-1 mt-2">
          <button
            onClick={() => setActiveChannel("email")}
            className={cn(
              "px-3 py-1 text-sm rounded-md transition-colors",
              activeChannel === "email"
                ? "bg-foreground text-background font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Email
          </button>
          <button
            onClick={() => setActiveChannel("linkedin")}
            className={cn(
              "px-3 py-1 text-sm rounded-md transition-colors",
              activeChannel === "linkedin"
                ? "bg-foreground text-background font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            LinkedIn
          </button>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {activeChannel === "email" ? (
          <>
            {/* Left panel: email thread list */}
            <div className="w-[380px] shrink-0 border-r border-border overflow-y-auto">
              {loading ? (
                <div className="p-4 space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="space-y-1.5">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="p-4 text-sm text-destructive text-center pt-12">
                  {error}
                </div>
              ) : (
                <EmailThreadList
                  threads={threads}
                  selectedThreadId={selectedThreadId}
                  onSelectThread={setSelectedThreadId}
                />
              )}
            </div>

            {/* Right panel: email conversation view */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {selectedThreadId !== null ? (
                <EmailThreadView
                  threadId={selectedThreadId}
                  onReplySent={fetchThreads}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
                    <Mail className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium">Select a conversation</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                    Choose a thread from the left to view the full conversation
                    and send a reply.
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Left panel: LinkedIn conversation list */}
            <div className="w-[380px] shrink-0 border-r border-border overflow-y-auto">
              {linkedinLoading ? (
                <div className="p-4 space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="space-y-1.5">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  ))}
                </div>
              ) : (
                <LinkedInConversationList
                  conversations={linkedinConversations}
                  selectedConversationId={selectedConversationId}
                  onSelectConversation={setSelectedConversationId}
                />
              )}
            </div>

            {/* Right panel: LinkedIn conversation view */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {selectedConversationId !== null ? (
                <LinkedInConversationView
                  conversationId={selectedConversationId}
                  onMessageSent={fetchLinkedinConversations}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
                    <Linkedin className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium">Select a conversation</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                    Choose a conversation from the left to view the full message
                    history.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

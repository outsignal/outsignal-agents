"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Mail, Linkedin, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonListItem } from "@/components/ui/skeleton";
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

type ActiveChannel = "all" | "email" | "linkedin";

function getAvailableChannels(pkg: string): ("email" | "linkedin")[] {
  if (pkg === "email") return ["email"];
  if (pkg === "linkedin") return ["linkedin"];
  return ["email", "linkedin"]; // email_linkedin, consultancy, unknown
}

export default function PortalInboxPage() {
  const searchParams = useSearchParams();
  const threadParam = useMemo(() => {
    const t = searchParams.get("thread");
    return t ? Number(t) : null;
  }, [searchParams]);

  const [workspacePackage, setWorkspacePackage] = useState<string>("email");
  const [activeChannel, setActiveChannel] = useState<ActiveChannel>("email");

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

  // Fetch workspace package on mount
  useEffect(() => {
    fetch("/api/portal/workspace")
      .then((r) => r.json())
      .then((d: { package?: string }) => {
        const pkg = d.package || "email";
        setWorkspacePackage(pkg);
        const channels = getAvailableChannels(pkg);
        // Set initial active channel based on available channels
        if (channels.length === 1) {
          setActiveChannel(channels[0]);
        } else {
          setActiveChannel("all");
        }
      })
      .catch(() => {
        // Default to email on error
      });
  }, []);

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

      // Auto-select thread from URL param, or first thread — desktop only (>= 768px)
      if (
        emailResult &&
        emailResult.length > 0 &&
        !hasAutoSelectedEmail.current &&
        typeof window !== "undefined" &&
        window.innerWidth >= 768
      ) {
        const target = threadParam && emailResult.find((t) => t.threadId === threadParam);
        setSelectedThreadId(target ? target.threadId : emailResult[0].threadId);
        hasAutoSelectedEmail.current = true;
      }

      // Auto-select first LinkedIn conversation — desktop only (>= 768px)
      if (
        linkedinResult &&
        linkedinResult.length > 0 &&
        !hasAutoSelectedLinkedin.current &&
        typeof window !== "undefined" &&
        window.innerWidth >= 768
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

  // 2-second read timer: fires when email thread is selected
  useEffect(() => {
    if (!selectedThreadId) return;
    const timer = setTimeout(() => {
      fetch(`/api/portal/inbox/email/threads/${selectedThreadId}/read`, {
        method: "POST",
      }).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
  }, [selectedThreadId]);

  // Mark all as read handler
  const handleMarkAllRead = useCallback(async () => {
    try {
      await fetch("/api/portal/inbox/email/mark-all-read", { method: "POST" });
      await fetchThreads();
    } catch {
      // Silently fail
    }
  }, [fetchThreads]);

  // Cross-channel navigation handlers
  const handleSwitchToLinkedIn = useCallback((conversationId: string) => {
    setActiveChannel("linkedin");
    setSelectedConversationId(conversationId);
    setSelectedThreadId(null);
  }, []);

  const handleSwitchToEmail = useCallback((threadId: number) => {
    setActiveChannel("email");
    setSelectedThreadId(threadId);
    setSelectedConversationId(null);
  }, []);

  const channels = getAvailableChannels(workspacePackage);
  const showAllTab = channels.length === 2;
  const hasSelection = selectedThreadId !== null || selectedConversationId !== null;

  // Combined "All" feed sorted by time
  type AllFeedItem =
    | { type: "email"; id: number; timestamp: string; data: ThreadSummary }
    | { type: "linkedin"; id: string; timestamp: string; data: LinkedInConversationSummary };

  const allFeedItems: AllFeedItem[] = [
    ...threads.map((t) => ({
      type: "email" as const,
      id: t.threadId,
      timestamp: t.lastMessageAt,
      data: t,
    })),
    ...linkedinConversations.map((c) => ({
      type: "linkedin" as const,
      id: c.id,
      timestamp: c.lastActivityAt,
      data: c,
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="flex flex-col h-full">
      {/* Page header with channel tabs */}
      <div className="px-5 py-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-medium">Inbox</h1>
          {/* Mark all as read — only shown on email/all tabs */}
          {(activeChannel === "email" || activeChannel === "all") && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkAllRead}
            >
              Mark all as read
            </Button>
          )}
        </div>

        {/* Channel tabs — pill/segment toggle */}
        {channels.length > 1 && (
          <div className="inline-flex items-center gap-0.5 mt-3 p-0.5 rounded-lg bg-muted">
            {showAllTab && (
              <button
                onClick={() => setActiveChannel("all")}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md transition-all duration-150",
                  activeChannel === "all"
                    ? "bg-background text-foreground font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                All
              </button>
            )}
            <button
              onClick={() => setActiveChannel("email")}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-all duration-150",
                activeChannel === "email"
                  ? "bg-background text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Mail className="h-3.5 w-3.5" />
              Email
              {threads.filter((t) => t.isRead === false).length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-brand text-white text-[10px] font-medium px-1">
                  {threads.filter((t) => t.isRead === false).length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveChannel("linkedin")}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-all duration-150",
                activeChannel === "linkedin"
                  ? "bg-background text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Linkedin className="h-3.5 w-3.5" />
              LinkedIn
              {linkedinConversations.filter((c) => c.unreadCount > 0).length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-brand text-white text-[10px] font-medium px-1">
                  {linkedinConversations.filter((c) => c.unreadCount > 0).length}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Two-panel layout — mobile: single panel with back button */}
      <div className="flex flex-1 overflow-hidden">
        {activeChannel === "email" || activeChannel === "all" ? (
          <>
            {/* Left panel: thread list */}
            <div
              className={cn(
                "shrink-0 border-r border-border overflow-y-auto",
                "md:w-[380px]",
                hasSelection ? "hidden md:flex md:flex-col" : "flex flex-col w-full md:w-[380px]"
              )}
            >
              {activeChannel === "all" ? (
                // All feed: mixed email + LinkedIn
                <div className="divide-y divide-border">
                  {loading && linkedinLoading ? (
                    <div className="px-4">
                      {[...Array(6)].map((_, i) => (
                        <SkeletonListItem key={i} withAvatar={false} lines={3} />
                      ))}
                    </div>
                  ) : allFeedItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                      <p className="text-sm font-medium">No conversations yet</p>
                    </div>
                  ) : (
                    allFeedItems.map((item) => {
                      if (item.type === "email") {
                        return (
                          <EmailThreadList
                            key={`email-${item.id}`}
                            threads={[item.data]}
                            selectedThreadId={selectedThreadId}
                            onSelectThread={(id) => {
                              setSelectedThreadId(id);
                              setSelectedConversationId(null);
                            }}
                          />
                        );
                      }
                      return (
                        <LinkedInConversationList
                          key={`linkedin-${item.id}`}
                          conversations={[item.data]}
                          selectedConversationId={selectedConversationId}
                          onSelectConversation={(id) => {
                            setSelectedConversationId(id);
                            setSelectedThreadId(null);
                          }}
                        />
                      );
                    })
                  )}
                </div>
              ) : (
                // Email-only thread list
                <>
                  {loading ? (
                    <div className="px-4">
                      {[...Array(6)].map((_, i) => (
                        <SkeletonListItem key={i} withAvatar={false} lines={3} />
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
                </>
              )}
            </div>

            {/* Right panel: email conversation view */}
            <div
              className={cn(
                "flex-1 overflow-hidden flex flex-col",
                hasSelection ? "flex" : "hidden md:flex"
              )}
            >
              {/* Back button — mobile only */}
              <button
                onClick={() => {
                  setSelectedThreadId(null);
                  setSelectedConversationId(null);
                }}
                className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground md:hidden border-b border-border"
              >
                <ArrowLeft className="h-4 w-4" /> Back to inbox
              </button>

              {selectedThreadId !== null ? (
                <EmailThreadView
                  threadId={selectedThreadId}
                  onReplySent={fetchThreads}
                  onSwitchChannel={handleSwitchToLinkedIn}
                />
              ) : selectedConversationId !== null && activeChannel === "all" ? (
                <LinkedInConversationView
                  conversationId={selectedConversationId}
                  onMessageSent={fetchLinkedinConversations}
                  onSwitchChannel={handleSwitchToEmail}
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
            <div
              className={cn(
                "shrink-0 border-r border-border overflow-y-auto",
                "md:w-[380px]",
                hasSelection ? "hidden md:flex md:flex-col" : "flex flex-col w-full md:w-[380px]"
              )}
            >
              {linkedinLoading ? (
                <div className="px-4">
                  {[...Array(6)].map((_, i) => (
                    <SkeletonListItem key={i} withAvatar={false} lines={3} />
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
            <div
              className={cn(
                "flex-1 overflow-hidden flex flex-col",
                hasSelection ? "flex" : "hidden md:flex"
              )}
            >
              {/* Back button — mobile only */}
              <button
                onClick={() => {
                  setSelectedThreadId(null);
                  setSelectedConversationId(null);
                }}
                className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground md:hidden border-b border-border"
              >
                <ArrowLeft className="h-4 w-4" /> Back to inbox
              </button>

              {selectedConversationId !== null ? (
                <LinkedInConversationView
                  conversationId={selectedConversationId}
                  onMessageSent={fetchLinkedinConversations}
                  onSwitchChannel={handleSwitchToEmail}
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

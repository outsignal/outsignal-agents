"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Inbox, Mail, Linkedin, ArrowLeft, RefreshCw } from "lucide-react";
import { Skeleton, SkeletonListItem } from "@/components/ui/skeleton";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ACTIVE_INTERVAL = 15_000;
const BACKGROUND_INTERVAL = 60_000;

type ActiveChannel = "all" | "email" | "linkedin";

interface Workspace {
  slug: string;
  name: string;
}

export default function InboxTab() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("");
  const [activeChannel, setActiveChannel] = useState<ActiveChannel>("all");
  const [refreshing, setRefreshing] = useState(false);

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

  // Track auto-selection
  const hasAutoSelectedEmail = useRef(false);
  const hasAutoSelectedLinkedin = useRef(false);

  // Fetch workspace list for filter dropdown
  useEffect(() => {
    fetch("/api/workspaces")
      .then((r) => r.json())
      .then((d: { workspaces?: Workspace[] }) => {
        setWorkspaces(d.workspaces ?? []);
      })
      .catch(() => {
        // Silently fail — filter will still work (just no options)
      });
  }, []);

  const fetchThreads = useCallback(async () => {
    try {
      const qs = workspaceFilter ? `?workspace=${workspaceFilter}` : "";
      const res = await fetch(`/api/admin/inbox/email/threads${qs}`);
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
  }, [workspaceFilter]);

  const fetchLinkedinConversations = useCallback(async () => {
    try {
      const qs = workspaceFilter ? `?workspace=${workspaceFilter}` : "";
      const res = await fetch(`/api/admin/inbox/linkedin/conversations${qs}`);
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
  }, [workspaceFilter]);

  // Initial load + polling — both channels poll simultaneously
  useEffect(() => {
    // Reset selection when filter changes
    setSelectedThreadId(null);
    setSelectedConversationId(null);
    hasAutoSelectedEmail.current = false;
    hasAutoSelectedLinkedin.current = false;

    let timer: ReturnType<typeof setInterval>;

    const load = async () => {
      const [emailResult, linkedinResult] = await Promise.all([
        fetchThreads(),
        fetchLinkedinConversations(),
      ]);

      // Auto-select first email thread — desktop only
      if (
        emailResult &&
        emailResult.length > 0 &&
        !hasAutoSelectedEmail.current &&
        typeof window !== "undefined" &&
        window.innerWidth >= 768
      ) {
        setSelectedThreadId(emailResult[0].threadId);
        hasAutoSelectedEmail.current = true;
      }

      // Auto-select first LinkedIn conversation — desktop only
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

  // Refresh all data
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchThreads(), fetchLinkedinConversations()]);
    } catch {
      // Silently fail
    } finally {
      setRefreshing(false);
    }
  }, [fetchThreads, fetchLinkedinConversations]);

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

  // Determine workspace context for selected thread/conversation
  const selectedThread = threads.find((t) => t.threadId === selectedThreadId);
  const selectedConversation = linkedinConversations.find(
    (c) => c.id === selectedConversationId
  );
  const selectedWorkspaceSlug =
    selectedThread?.workspaceSlug ??
    selectedConversation?.workspaceSlug ??
    null;
  const selectedWorkspaceName =
    selectedThread?.workspaceName ??
    selectedConversation?.workspaceName ??
    null;

  const hasSelection =
    selectedThreadId !== null || selectedConversationId !== null;

  // Combined "All" feed sorted by time
  type AllFeedItem =
    | { type: "email"; id: number; timestamp: string; data: ThreadSummary }
    | {
        type: "linkedin";
        id: string;
        timestamp: string;
        data: LinkedInConversationSummary;
      };

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
  ].sort(
    (a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Channel tabs config
  const channelTabs: { key: ActiveChannel; label: string }[] = [
    { key: "all", label: "All" },
    { key: "email", label: "Email" },
    { key: "linkedin", label: "LinkedIn" },
  ];

  // Check if we should show threads or LinkedIn list
  const showEmailPanel = activeChannel === "email" || activeChannel === "all";
  const showLinkedInPanel = activeChannel === "linkedin";

  // Loading state for current view
  const isLoading =
    activeChannel === "all"
      ? loading && linkedinLoading
      : activeChannel === "email"
        ? loading
        : linkedinLoading;

  // Render the thread list content based on active channel
  const renderThreadList = () => {
    if (isLoading) {
      return (
        <div className="px-3 py-2 space-y-1">
          {[...Array(8)].map((_, i) => (
            <SkeletonListItem key={i} withAvatar={false} lines={3} className="px-3 py-3 rounded-lg" />
          ))}
        </div>
      );
    }

    if (activeChannel === "email" && error) {
      return (
        <div className="p-4 text-sm text-destructive text-center pt-12">
          {error}
        </div>
      );
    }

    if (activeChannel === "all") {
      if (allFeedItems.length === 0) {
        return (
          <div className="flex flex-col items-center justify-center h-full py-16 text-center px-4">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <Inbox className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">All caught up</p>
            <p className="text-xs text-muted-foreground mt-1">
              No replies to review right now.
            </p>
          </div>
        );
      }

      return (
        <div className="divide-y divide-border">
          {allFeedItems.map((item) => {
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
          })}
        </div>
      );
    }

    if (activeChannel === "email") {
      if (threads.length === 0) {
        return (
          <div className="flex flex-col items-center justify-center h-full py-16 text-center px-4">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <Mail className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">All caught up</p>
            <p className="text-xs text-muted-foreground mt-1">
              No email replies to review right now.
            </p>
          </div>
        );
      }
      return (
        <EmailThreadList
          threads={threads}
          selectedThreadId={selectedThreadId}
          onSelectThread={setSelectedThreadId}
        />
      );
    }

    // LinkedIn
    if (linkedinConversations.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full py-16 text-center px-4">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <Linkedin className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">All caught up</p>
          <p className="text-xs text-muted-foreground mt-1">
            No LinkedIn conversations to review right now.
          </p>
        </div>
      );
    }
    return (
      <LinkedInConversationList
        conversations={linkedinConversations}
        selectedConversationId={selectedConversationId}
        onSelectConversation={setSelectedConversationId}
      />
    );
  };

  // Render detail pane content
  const renderDetailPane = () => {
    if (selectedThreadId !== null) {
      return (
        <EmailThreadView
          threadId={selectedThreadId}
          onReplySent={fetchThreads}
          onSwitchChannel={handleSwitchToLinkedIn}
          threadDetailBasePath="/api/admin/inbox/email/threads"
          replyEndpoint="/api/admin/inbox/email/reply"
          replyExtraBody={
            selectedWorkspaceSlug
              ? { workspaceSlug: selectedWorkspaceSlug }
              : undefined
          }
        />
      );
    }

    if (selectedConversationId !== null) {
      return (
        <LinkedInConversationView
          conversationId={selectedConversationId}
          onMessageSent={fetchLinkedinConversations}
          onSwitchChannel={handleSwitchToEmail}
          messagesBasePath="/api/admin/inbox/linkedin/conversations"
          replyEndpoint="/api/admin/inbox/linkedin/reply"
          replyExtraBody={
            selectedWorkspaceSlug
              ? { workspaceSlug: selectedWorkspaceSlug }
              : undefined
          }
        />
      );
    }

    // Empty state — no thread selected
    const icon =
      activeChannel === "linkedin" ? (
        <Linkedin className="h-6 w-6 text-muted-foreground" />
      ) : (
        <Inbox className="h-6 w-6 text-muted-foreground" />
      );

    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
          {icon}
        </div>
        <p className="text-sm font-medium text-foreground">
          Select a thread to view
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Choose a conversation from the left to view the full thread and send a
          reply.
        </p>
      </div>
    );
  };

  return (
    <>
      {/* Toolbar row */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0">
        {/* Workspace filter */}
        <Select
          value={workspaceFilter || "__all__"}
          onValueChange={(val) =>
            setWorkspaceFilter(val === "__all__" ? "" : val)
          }
        >
          <SelectTrigger className="h-8 w-[180px] text-xs shrink-0">
            <SelectValue placeholder="All Workspaces" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Workspaces</SelectItem>
            {workspaces.map((ws) => (
              <SelectItem key={ws.slug} value={ws.slug}>
                {ws.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Channel tabs */}
        <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
          {channelTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveChannel(tab.key)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-all duration-150",
                activeChannel === tab.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Refresh button */}
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors duration-150 disabled:opacity-50"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
          />
          Refresh
        </button>
      </div>

      {/* ===== Two-panel layout ===== */}
      <div className="flex flex-1 overflow-hidden" style={{ height: "calc(100vh - 130px)" }}>
        {/* Left panel: thread list */}
        <div
          className={cn(
            "shrink-0 border-r border-border flex flex-col bg-background",
            "md:w-[360px]",
            hasSelection
              ? "hidden md:flex"
              : "flex w-full md:w-[360px]"
          )}
        >
          {/* Thread list — independent scroll */}
          <div className="flex-1 overflow-y-auto">
            {renderThreadList()}
          </div>
        </div>

        {/* Right panel: detail view */}
        <div
          className={cn(
            "flex-1 overflow-hidden flex flex-col bg-background",
            hasSelection ? "flex" : "hidden md:flex"
          )}
        >
          {/* Back button — mobile only */}
          {hasSelection && (
            <button
              onClick={() => {
                setSelectedThreadId(null);
                setSelectedConversationId(null);
              }}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground md:hidden border-b border-border transition-colors duration-150"
            >
              <ArrowLeft className="h-4 w-4" /> Back to inbox
            </button>
          )}

          {/* "Replying as" banner */}
          {selectedWorkspaceName && hasSelection && (
            <div className="px-4 py-2 bg-muted border-b border-border text-xs text-muted-foreground shrink-0">
              Replying as{" "}
              <span className="font-medium text-foreground">
                {selectedWorkspaceName}
              </span>
            </div>
          )}

          {renderDetailPane()}
        </div>
      </div>
    </>
  );
}

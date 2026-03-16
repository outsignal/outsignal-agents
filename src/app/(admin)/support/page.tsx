"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Send, X, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Conversation {
  id: string;
  workspaceId: string;
  workspaceName: string;
  status: "OPEN" | "CLOSED";
  unreadByAdmin: boolean;
  lastMessageAt: string;
  lastMessagePreview: string | null;
}

interface Message {
  id: string;
  conversationId: string;
  role: "CLIENT" | "AI" | "ADMIN";
  content: string;
  createdAt: string;
  senderName: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)__csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function relativeTime(date: string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SupportPage() {
  const [filter, setFilter] = useState<"ALL" | "OPEN" | "CLOSED">("ALL");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendError, setSendError] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    try {
      const q = filter === "ALL" ? "" : `?status=${filter}`;
      const res = await fetch(`/api/support/conversations${q}`);
      const json = await res.json();
      setConversations(json.conversations ?? []);
    } catch {
    } finally {
      setLoadingConversations(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, 15_000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  // Fetch messages for selected conversation
  const fetchMessages = useCallback(async (id: string, showLoading = false) => {
    if (showLoading) setLoadingMessages(true);
    try {
      const res = await fetch(`/api/support/conversations/${id}/messages`);
      const json = await res.json();
      setMessages(json.messages ?? []);
    } catch {
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    fetchMessages(selectedId, true);
    // Mark as read
    fetch(`/api/support/conversations/${selectedId}/read`, {
      method: "POST",
      headers: { "x-csrf-token": getCsrfToken() },
    }).catch(() => {});
    const interval = setInterval(() => fetchMessages(selectedId), 10_000);
    return () => clearInterval(interval);
  }, [selectedId, fetchMessages]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Send reply
  async function handleSend() {
    if (!selectedId || !reply.trim() || sending) return;
    setSending(true);
    const content = reply.trim();
    // Optimistic update
    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      conversationId: selectedId,
      role: "ADMIN",
      content,
      createdAt: new Date().toISOString(),
      senderName: "You",
    };
    setMessages((prev) => [...prev, optimistic]);
    setReply("");
    try {
      await fetch(`/api/support/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": getCsrfToken(),
        },
        body: JSON.stringify({ content }),
      });
      // Refresh messages to get real ID
      fetchMessages(selectedId);
    } catch {
      setSendError(true);
      setTimeout(() => setSendError(false), 3000);
    }
    setSending(false);
  }

  // Close conversation
  async function handleClose() {
    if (!selectedId) return;
    try {
      await fetch(`/api/support/conversations/${selectedId}/close`, {
        method: "POST",
        headers: { "x-csrf-token": getCsrfToken() },
      });
      fetchConversations();
      setSelectedId(null);
      setMessages([]);
    } catch {}
  }

  const selected = conversations.find((c) => c.id === selectedId);

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Left column — Conversation list */}
      <div className="w-80 border-r flex flex-col">
        {/* Header */}
        <div className="shrink-0 border-b px-4 py-3">
          <h1 className="text-xl font-medium mb-2">Support</h1>
          <div className="flex gap-1">
            {(["ALL", "OPEN", "CLOSED"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-md font-medium transition-colors",
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {f === "ALL" ? "All" : f === "OPEN" ? "Open" : "Closed"}
              </button>
            ))}
          </div>
        </div>
        {/* List */}
        <ScrollArea className="flex-1">
          {loadingConversations && (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
          {!loadingConversations && conversations.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground text-center">
              No conversations
            </div>
          )}
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setSelectedId(conv.id)}
              className={cn(
                "w-full text-left px-4 py-3 border-b transition-colors",
                selectedId === conv.id ? "bg-accent" : "hover:bg-muted/50",
                conv.status === "CLOSED" && "opacity-60",
              )}
            >
              <div className="flex items-center gap-2">
                {conv.unreadByAdmin && (
                  <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                )}
                <span
                  className={cn(
                    "text-sm truncate",
                    conv.unreadByAdmin ? "font-semibold" : "font-medium",
                  )}
                >
                  {conv.workspaceName}
                </span>
                {conv.status === "CLOSED" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium shrink-0">
                    Closed
                  </span>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground shrink-0">
                  {relativeTime(conv.lastMessageAt)}
                </span>
              </div>
              {conv.lastMessagePreview && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {conv.lastMessagePreview.length > 60
                    ? conv.lastMessagePreview.slice(0, 60) + "..."
                    : conv.lastMessagePreview}
                </p>
              )}
            </button>
          ))}
        </ScrollArea>
      </div>

      {/* Right column — Conversation thread */}
      <div className="flex-1 flex flex-col">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageCircle className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Select a conversation</p>
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="shrink-0 border-b px-4 py-3 flex items-center gap-3">
              <h2 className="font-semibold text-sm">{selected.workspaceName}</h2>
              <Badge variant={selected.status === "OPEN" ? "default" : "secondary"}>
                {selected.status}
              </Badge>
              {selected.status === "OPEN" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-xs"
                  onClick={handleClose}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Close
                </Button>
              )}
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 px-4 py-3">
              {loadingMessages && (
                <div className="flex items-center justify-center py-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              )}
              <div className="space-y-3 max-w-2xl mx-auto">
                {messages.map((msg) => {
                  const isAdmin = msg.role === "ADMIN";
                  const isAI = msg.role === "AI";
                  return (
                    <div
                      key={msg.id}
                      className={cn("flex", isAdmin ? "justify-end" : "justify-start")}
                    >
                      <div className={cn("max-w-[75%]")}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[11px] font-medium text-muted-foreground">
                            {isAdmin
                              ? "You"
                              : isAI
                                ? "AI Assistant"
                                : msg.senderName || selected.workspaceName}
                          </span>
                          {isAI && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 font-medium">
                              AI
                            </span>
                          )}
                        </div>
                        <div
                          className={cn(
                            "rounded-lg px-3 py-2 text-sm",
                            isAdmin
                              ? "bg-primary text-primary-foreground"
                              : isAI
                                ? "bg-gray-50"
                                : "bg-gray-100",
                          )}
                        >
                          {msg.content}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {new Date(msg.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Reply input */}
            <div className="shrink-0 border-t px-4 py-3">
              {selected.status === "CLOSED" ? (
                <p className="text-sm text-muted-foreground text-center py-1">
                  This conversation is closed.
                </p>
              ) : (
                <>
                  {sendError && (
                    <p className="text-xs text-red-500 px-4 mb-1 max-w-2xl mx-auto">Failed to send. Please try again.</p>
                  )}
                  <div className="flex gap-2 max-w-2xl mx-auto">
                    <textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      placeholder="Type a reply..."
                      rows={1}
                      className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    <Button
                      size="icon"
                      onClick={handleSend}
                      disabled={!reply.trim() || sending}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

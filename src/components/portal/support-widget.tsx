"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageCircle,
  X,
  ArrowLeft,
  Send,
  Search,
  ChevronDown,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FaqArticle {
  id: string;
  question: string;
  answer: string;
  category: string;
}

interface KbResult {
  id: string;
  title: string;
  preview: string;
}

interface SearchResults {
  faq: FaqArticle[];
  kb: KbResult[];
}

interface Message {
  id: string;
  conversationId: string;
  role: "client" | "ai" | "admin";
  content: string;
  escalated?: boolean;
  createdAt: string;
}

interface Conversation {
  id: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)__csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"home" | "search" | "chat">("home");

  // FAQ
  const [faqCategories, setFaqCategories] = useState<
    Record<string, FaqArticle[]>
  >({});
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [expandedArticles, setExpandedArticles] = useState<Set<string>>(
    new Set(),
  );

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults | null>(
    null,
  );
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Chat
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Unread
  const [unreadCount, setUnreadCount] = useState(0);

  // Polling refs
  const chatPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unreadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // -----------------------------------------------------------------------
  // FAQ fetch
  // -----------------------------------------------------------------------

  useEffect(() => {
    fetch("/api/portal/support/faq")
      .then((r) => r.json())
      .then((data: FaqArticle[]) => {
        const grouped: Record<string, FaqArticle[]> = {};
        for (const article of data) {
          if (!grouped[article.category]) grouped[article.category] = [];
          grouped[article.category].push(article);
        }
        setFaqCategories(grouped);
      })
      .catch(() => {});
  }, []);

  // -----------------------------------------------------------------------
  // Search with debounce
  // -----------------------------------------------------------------------

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

      if (!value.trim()) {
        setView("home");
        setSearchResults(null);
        return;
      }

      searchTimerRef.current = setTimeout(() => {
        setView("search");
        fetch(
          `/api/portal/support/faq/search?q=${encodeURIComponent(value.trim())}`,
        )
          .then((r) => r.json())
          .then((data: SearchResults) => setSearchResults(data))
          .catch(() => setSearchResults({ faq: [], kb: [] }));
      }, 300);
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Chat — load conversation + messages
  // -----------------------------------------------------------------------

  const loadChat = useCallback(async () => {
    try {
      const convRes = await fetch("/api/portal/support/conversation");
      const conv: Conversation = await convRes.json();
      setConversation(conv);

      const msgRes = await fetch(
        `/api/portal/support/messages?conversationId=${conv.id}`,
      );
      const msgs: Message[] = await msgRes.json();
      setMessages(msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    } catch {
      // fail silently
    }
  }, []);

  useEffect(() => {
    if (view === "chat") {
      loadChat();
    }
  }, [view, loadChat]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // -----------------------------------------------------------------------
  // Send message
  // -----------------------------------------------------------------------

  const sendMessage = useCallback(async () => {
    if (!chatInput.trim() || !conversation || sending) return;
    const content = chatInput.trim();
    setChatInput("");
    setSending(true);

    // Optimistic client message
    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      conversationId: conversation.id,
      role: "client",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const res = await fetch("/api/portal/support/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": getCsrfToken(),
        },
        body: JSON.stringify({ conversationId: conversation.id, content }),
      });
      const data = await res.json();
      // Replace optimistic + append response messages
      setMessages((prev) => {
        const withoutOptimistic = prev.filter((m) => m.id !== optimistic.id);
        const newMessages: Message[] = Array.isArray(data.messages)
          ? data.messages
          : [data.clientMessage, data.aiMessage].filter(Boolean);
        return [...withoutOptimistic, ...newMessages].sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        );
      });
    } catch {
      // keep optimistic message on error
    } finally {
      setSending(false);
    }
  }, [chatInput, conversation, sending]);

  // -----------------------------------------------------------------------
  // Polling — chat messages (10s) or unread count (60s)
  // -----------------------------------------------------------------------

  useEffect(() => {
    // Clear previous intervals
    if (chatPollRef.current) clearInterval(chatPollRef.current);
    if (unreadPollRef.current) clearInterval(unreadPollRef.current);
    chatPollRef.current = null;
    unreadPollRef.current = null;

    const isVisible = () => document.visibilityState === "visible";

    if (open && view === "chat" && conversation) {
      chatPollRef.current = setInterval(() => {
        if (!isVisible()) return;
        fetch(
          `/api/portal/support/messages?conversationId=${conversation.id}`,
        )
          .then((r) => r.json())
          .then((msgs: Message[]) =>
            setMessages(
              msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
            ),
          )
          .catch(() => {});
      }, 10_000);
    } else {
      unreadPollRef.current = setInterval(() => {
        if (!isVisible()) return;
        fetch("/api/portal/support/unread-count")
          .then((r) => r.json())
          .then((data: { count: number }) => setUnreadCount(data.count))
          .catch(() => {});
      }, 60_000);
    }

    return () => {
      if (chatPollRef.current) clearInterval(chatPollRef.current);
      if (unreadPollRef.current) clearInterval(unreadPollRef.current);
    };
  }, [open, view, conversation]);

  // Initial unread fetch
  useEffect(() => {
    fetch("/api/portal/support/unread-count")
      .then((r) => r.json())
      .then((data: { count: number }) => setUnreadCount(data.count))
      .catch(() => {});
  }, []);

  // -----------------------------------------------------------------------
  // Toggle helpers
  // -----------------------------------------------------------------------

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const toggleArticle = (id: string) => {
    setExpandedArticles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // -----------------------------------------------------------------------
  // Escalation banner check
  // -----------------------------------------------------------------------

  const lastAiMessage = [...messages]
    .reverse()
    .find((m) => m.role === "ai");
  const showEscalationBanner = lastAiMessage?.escalated === true;

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const renderFaqArticles = (articles: FaqArticle[]) =>
    articles.map((article) => (
      <div key={article.id} className="border-b border-gray-100 last:border-0">
        <button
          type="button"
          onClick={() => toggleArticle(article.id)}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50"
        >
          <span>{article.question}</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-gray-400 transition-transform",
              expandedArticles.has(article.id) && "rotate-180",
            )}
          />
        </button>
        {expandedArticles.has(article.id) && (
          <div className="px-4 pb-3 text-sm text-gray-500 leading-relaxed">
            {article.answer}
          </div>
        )}
      </div>
    ));

  const renderHeader = (title: string, showBack?: boolean) => (
    <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
      <div className="flex items-center gap-2">
        {showBack && (
          <button
            type="button"
            onClick={() => {
              setView("home");
              setSearchQuery("");
              setSearchResults(null);
            }}
            className="text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-gray-400 hover:text-gray-600"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#635BFF] text-white shadow-lg transition-colors hover:bg-[#5046E5]"
      >
        <MessageCircle className="h-6 w-6" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-red-500" />
        )}
      </button>

      {/* Popup panel */}
      <div
        className={cn(
          "fixed bottom-24 right-6 z-50 flex h-[550px] w-[400px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl transition-all duration-200",
          open
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none translate-y-4 opacity-0",
        )}
      >
        {/* ---- Home View ---- */}
        {view === "home" && (
          <>
            {renderHeader("Help Center")}
            <div className="flex-1 overflow-auto">
              {/* Search bar */}
              <div className="border-b border-gray-100 p-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    placeholder="Search help articles..."
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              {/* FAQ categories */}
              <div className="p-4">
                {Object.entries(faqCategories).map(([category, articles]) => (
                  <div key={category} className="mb-3">
                    <button
                      type="button"
                      onClick={() => toggleCategory(category)}
                      className="flex w-full items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5 text-left text-sm font-medium text-gray-800 hover:bg-gray-100"
                    >
                      <span>{category}</span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 text-gray-400 transition-transform",
                          expandedCategories.has(category) && "rotate-180",
                        )}
                      />
                    </button>
                    {expandedCategories.has(category) && (
                      <div className="mt-1 rounded-lg border border-gray-100">
                        {renderFaqArticles(articles)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Chat CTA */}
            <div className="border-t border-gray-200 p-4">
              <Button
                onClick={() => setView("chat")}
                className="w-full rounded-lg bg-[#635BFF] text-white hover:bg-[#5046E5]"
              >
                Chat with us
              </Button>
            </div>
          </>
        )}

        {/* ---- Search View ---- */}
        {view === "search" && (
          <>
            {renderHeader("Search Results", true)}
            <div className="flex-1 overflow-auto">
              {/* Search bar (persisted) */}
              <div className="border-b border-gray-100 p-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    placeholder="Search help articles..."
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="pl-9"
                    autoFocus
                  />
                </div>
              </div>

              {searchResults === null ? (
                <div className="p-4 text-center text-sm text-gray-400">
                  Searching...
                </div>
              ) : searchResults.faq.length === 0 &&
                searchResults.kb.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-500">
                  No results found
                </div>
              ) : (
                <div className="p-4">
                  {searchResults.faq.length > 0 && (
                    <div className="mb-4">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                        FAQ
                      </h3>
                      <div className="rounded-lg border border-gray-100">
                        {renderFaqArticles(searchResults.faq)}
                      </div>
                    </div>
                  )}
                  {searchResults.kb.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                        Knowledge Base
                      </h3>
                      <div className="space-y-2">
                        {searchResults.kb.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-lg border border-gray-100 p-3"
                          >
                            <p className="text-sm font-medium text-gray-800">
                              {item.title}
                            </p>
                            <p className="mt-1 text-xs text-gray-500 line-clamp-2">
                              {item.preview}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Chat fallback */}
              <div className="px-4 pb-4 text-center">
                <button
                  type="button"
                  onClick={() => setView("chat")}
                  className="text-sm text-[#635BFF] hover:underline"
                >
                  Still need help? Chat with us
                </button>
              </div>
            </div>
          </>
        )}

        {/* ---- Chat View ---- */}
        {view === "chat" && (
          <>
            {renderHeader("Chat with Outsignal", true)}

            {/* Messages */}
            <ScrollArea className="flex-1 px-4 py-3">
              <div className="space-y-3">
                {messages.map((msg) => {
                  const isClient = msg.role === "client";
                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex",
                        isClient ? "justify-end" : "justify-start",
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                          isClient
                            ? "bg-[#635BFF] text-white"
                            : "bg-gray-100 text-gray-900",
                        )}
                      >
                        {!isClient && (
                          <div className="mb-1">
                            {msg.role === "ai" ? (
                              <span className="rounded bg-gray-200 px-1 text-xs text-gray-600">
                                AI
                              </span>
                            ) : (
                              <span className="text-xs font-medium text-gray-500">
                                Outsignal Team
                              </span>
                            )}
                          </div>
                        )}
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Escalation banner */}
            {showEscalationBanner && (
              <div className="mx-4 mb-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
                Waiting for the team — they typically respond within 30 minutes.
              </div>
            )}

            {/* Input */}
            <div className="border-t border-gray-200 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Type a message..."
                  rows={1}
                  className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#635BFF] focus:ring-1 focus:ring-[#635BFF]"
                />
                <Button
                  size="icon"
                  disabled={!chatInput.trim() || sending}
                  onClick={sendMessage}
                  className="h-9 w-9 shrink-0 bg-[#635BFF] hover:bg-[#5046E5]"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

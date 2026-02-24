"use client";

import { useState, useEffect, useCallback } from "react";
import { ChatSidebar } from "./chat-sidebar";
import { ChatToggle } from "./chat-toggle";

export function ChatPanel({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  // Cmd+J / Ctrl+J keyboard shortcut
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);

  return (
    <>
      {children}
      <ChatToggle onClick={toggle} isOpen={isOpen} />
      <ChatSidebar isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}

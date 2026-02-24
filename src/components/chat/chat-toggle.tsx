"use client";

import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";

interface ChatToggleProps {
  onClick: () => void;
  isOpen: boolean;
}

export function ChatToggle({ onClick, isOpen }: ChatToggleProps) {
  if (isOpen) return null;

  return (
    <Button
      onClick={onClick}
      size="lg"
      className="fixed bottom-6 right-6 rounded-full shadow-lg z-50 h-12 w-12 p-0"
    >
      <MessageCircle className="h-5 w-5" />
    </Button>
  );
}

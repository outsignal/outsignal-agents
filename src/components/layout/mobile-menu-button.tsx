"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Sidebar } from "./sidebar";

interface WorkspaceItem {
  slug: string;
  name: string;
  vertical?: string;
  status: string;
  hasApiToken: boolean;
}

export function MobileMenuButton({
  workspaces,
}: {
  workspaces: WorkspaceItem[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating hamburger button — only visible on mobile */}
      <button
        onClick={() => setOpen(true)}
        className="fixed top-3 left-3 z-50 flex md:hidden h-9 w-9 items-center justify-center rounded-lg bg-sidebar text-sidebar-foreground shadow-lg border border-sidebar-border"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Overlay + Sidebar */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/60 md:hidden"
            onClick={() => setOpen(false)}
          />

          {/* Sidebar panel */}
          <div className="fixed inset-y-0 left-0 z-50 md:hidden">
            <div className="relative">
              <Sidebar workspaces={workspaces} />
              <button
                onClick={() => setOpen(false)}
                className="absolute top-3 right-3 h-7 w-7 flex items-center justify-center rounded-md text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
                aria-label="Close navigation menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

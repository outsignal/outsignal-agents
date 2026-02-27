"use client";

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, Plus, Search } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ListItem {
  id: string;
  name: string;
  workspaceSlug: string;
  _count?: { people: number };
}

interface ListsResponse {
  lists: ListItem[];
}

interface AddToListDropdownProps {
  selectedPersonIds: string[];
  selectAllFilters: Record<string, unknown> | null;
  workspaces: string[];
  onComplete: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AddToListDropdown({
  selectedPersonIds,
  selectAllFilters,
  workspaces,
  onComplete,
}: AddToListDropdownProps) {
  const [lists, setLists] = useState<ListItem[]>([]);
  const [listsLoaded, setListsLoaded] = useState(false);
  const [listSearch, setListSearch] = useState("");
  const [addingToListId, setAddingToListId] = useState<string | null>(null);
  const [addedFeedback, setAddedFeedback] = useState<string | null>(null);

  // Create new list modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListWorkspace, setNewListWorkspace] = useState("");
  const [newListDescription, setNewListDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Fetch lists when dropdown opens
  const handleDropdownOpen = async (open: boolean) => {
    if (open && !listsLoaded) {
      try {
        const res = await fetch("/api/lists");
        if (res.ok) {
          const json = (await res.json()) as ListsResponse;
          setLists(json.lists ?? []);
        }
      } catch {
        // Silently fail — show empty list
      } finally {
        setListsLoaded(true);
      }
    }
  };

  // Filter lists by search
  const filteredLists = lists.filter((l) =>
    l.name.toLowerCase().includes(listSearch.toLowerCase())
  );

  // Add selected people to an existing list
  const handleAddToList = async (listId: string) => {
    setAddingToListId(listId);
    try {
      const body = selectAllFilters
        ? { selectAllFilters }
        : { personIds: selectedPersonIds };

      const res = await fetch(`/api/lists/${listId}/people`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const result = (await res.json()) as { added: number };
      setAddedFeedback(`Added ${result.added}`);
      setTimeout(() => {
        setAddedFeedback(null);
        onComplete();
      }, 1500);
    } catch {
      setAddedFeedback("Failed");
      setTimeout(() => setAddedFeedback(null), 2000);
    } finally {
      setAddingToListId(null);
    }
  };

  // Create new list and then add people
  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListName.trim() || !newListWorkspace) return;

    setCreating(true);
    setCreateError(null);
    try {
      // 1. Create the list
      const createRes = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newListName.trim(),
          workspaceSlug: newListWorkspace,
          description: newListDescription.trim() || undefined,
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${createRes.status}`);
      }

      const newList = (await createRes.json()) as { id: string };

      // 2. Add selected people
      const body = selectAllFilters
        ? { selectAllFilters }
        : { personIds: selectedPersonIds };

      await fetch(`/api/lists/${newList.id}/people`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // Reset form and close
      setNewListName("");
      setNewListWorkspace("");
      setNewListDescription("");
      setCreateOpen(false);
      onComplete();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create list");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <DropdownMenu onOpenChange={(open) => { void handleDropdownOpen(open); }}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="default"
            size="sm"
            className="bg-[#F0FF7A] text-gray-900 hover:bg-[#e0ef6a] font-medium gap-1.5"
          >
            {addedFeedback ?? "Add to List"}
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          className="w-64 bg-gray-900 border-gray-700 text-white"
        >
          <DropdownMenuLabel className="text-xs text-gray-400 font-normal">
            Add to List
          </DropdownMenuLabel>

          {/* Search filter */}
          <div className="px-2 pb-1">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-500" />
              <input
                type="text"
                placeholder="Search lists..."
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-xs text-white placeholder-gray-500 rounded pl-6 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#F0FF7A]"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          {/* Existing lists */}
          <div className="max-h-48 overflow-y-auto">
            {!listsLoaded ? (
              <div className="px-2 py-3 text-xs text-gray-500 text-center">
                Loading lists...
              </div>
            ) : filteredLists.length === 0 ? (
              <div className="px-2 py-3 text-xs text-gray-500 text-center">
                {listSearch ? "No lists match your search" : "No lists yet"}
              </div>
            ) : (
              filteredLists.map((list) => (
                <DropdownMenuItem
                  key={list.id}
                  className="cursor-pointer hover:bg-gray-800 focus:bg-gray-800 flex items-center justify-between"
                  onSelect={(e) => {
                    e.preventDefault();
                    void handleAddToList(list.id);
                  }}
                  disabled={addingToListId === list.id}
                >
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{list.name}</p>
                    <p className="text-xs text-gray-500">{list.workspaceSlug}</p>
                  </div>
                  {addingToListId === list.id && (
                    <span className="text-xs text-gray-400">Adding...</span>
                  )}
                </DropdownMenuItem>
              ))
            )}
          </div>

          <DropdownMenuSeparator className="bg-gray-700" />

          {/* Create new list */}
          <DropdownMenuItem
            className="cursor-pointer hover:bg-gray-800 focus:bg-gray-800 text-[#F0FF7A]"
            onSelect={(e) => {
              e.preventDefault();
              setCreateOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-2" />
            Create New List
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create new list dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Create New List</DialogTitle>
          </DialogHeader>

          <form onSubmit={(e) => { void handleCreateList(e); }} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="list-name" className="text-sm text-gray-300">
                List Name <span className="text-red-400">*</span>
              </Label>
              <Input
                id="list-name"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder="e.g. Rise Q2 Prospects"
                required
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500 focus:ring-[#F0FF7A] focus:border-[#F0FF7A]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="list-workspace" className="text-sm text-gray-300">
                Workspace <span className="text-red-400">*</span>
              </Label>
              <Select
                value={newListWorkspace}
                onValueChange={setNewListWorkspace}
                required
              >
                <SelectTrigger
                  id="list-workspace"
                  className="bg-gray-800 border-gray-700 text-white focus:ring-[#F0FF7A]"
                >
                  <SelectValue placeholder="Select workspace" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700 text-white">
                  {workspaces.map((ws) => (
                    <SelectItem
                      key={ws}
                      value={ws}
                      className="focus:bg-gray-700 focus:text-white"
                    >
                      {ws}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="list-description" className="text-sm text-gray-300">
                Description <span className="text-gray-500">(optional)</span>
              </Label>
              <Textarea
                id="list-description"
                value={newListDescription}
                onChange={(e) => setNewListDescription(e.target.value)}
                placeholder="What is this list for?"
                rows={2}
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500 focus:ring-[#F0FF7A] focus:border-[#F0FF7A] resize-none"
              />
            </div>

            {createError && (
              <p className="text-sm text-red-400">{createError}</p>
            )}

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
                className="text-gray-400 hover:text-white hover:bg-gray-800"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creating || !newListName.trim() || !newListWorkspace}
                className="bg-[#F0FF7A] text-gray-900 hover:bg-[#e0ef6a] font-medium"
              >
                {creating ? "Creating..." : "Create & Add"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

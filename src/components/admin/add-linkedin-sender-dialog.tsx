"use client"

import * as React from "react"
import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface AddLinkedInSenderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

interface Workspace {
  slug: string
  name: string
}

export function AddLinkedInSenderDialog({
  open,
  onOpenChange,
  onSuccess,
}: AddLinkedInSenderDialogProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState("")
  const [workspaceSlug, setWorkspaceSlug] = useState("")
  const [linkedinProfileUrl, setLinkedinProfileUrl] = useState("")
  const [linkedinEmail, setLinkedinEmail] = useState("")
  const [linkedinPassword, setLinkedinPassword] = useState("")
  const [loginMethod, setLoginMethod] = useState("credentials")
  const [linkedinTier, setLinkedinTier] = useState("free")
  const [emailAddress, setEmailAddress] = useState("")
  const [proxyUrl, setProxyUrl] = useState("")

  // Fetch workspaces when dialog opens
  useEffect(() => {
    if (!open) return
    fetch("/api/workspaces")
      .then((res) => res.json())
      .then((data) => setWorkspaces(data.workspaces ?? []))
      .catch(() => setWorkspaces([]))
  }, [open])

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setName("")
      setWorkspaceSlug("")
      setLinkedinProfileUrl("")
      setLinkedinEmail("")
      setLinkedinPassword("")
      setLoginMethod("credentials")
      setLinkedinTier("free")
      setEmailAddress("")
      setProxyUrl("")
      setError(null)
    }
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const body: Record<string, string> = {
        name,
        workspaceSlug,
        linkedinProfileUrl,
        linkedinEmail,
        linkedinPassword,
        loginMethod,
        linkedinTier,
      }
      if (emailAddress) body.emailAddress = emailAddress
      if (proxyUrl) body.proxyUrl = proxyUrl

      const res = await fetch("/api/admin/senders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to create sender (${res.status})`)
      }

      onSuccess()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add LinkedIn Sender</DialogTitle>
          <DialogDescription>
            Create a new LinkedIn sender profile linked to a workspace.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="max-h-[60vh] overflow-y-auto space-y-6 pr-1">
            {/* Basic Info */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">Basic Info</p>

              <div className="space-y-1.5">
                <Label htmlFor="sender-name">Display Name</Label>
                <Input
                  id="sender-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Jonathan Melhuish-Sprague"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sender-workspace">Workspace</Label>
                <Select value={workspaceSlug} onValueChange={setWorkspaceSlug} required>
                  <SelectTrigger id="sender-workspace" className="w-full">
                    <SelectValue placeholder="Select a workspace" />
                  </SelectTrigger>
                  <SelectContent>
                    {workspaces.map((ws) => (
                      <SelectItem key={ws.slug} value={ws.slug}>
                        {ws.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* LinkedIn Credentials */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">LinkedIn Credentials</p>

              <div className="space-y-1.5">
                <Label htmlFor="sender-linkedin-url">LinkedIn Profile URL</Label>
                <Input
                  id="sender-linkedin-url"
                  value={linkedinProfileUrl}
                  onChange={(e) => setLinkedinProfileUrl(e.target.value)}
                  placeholder="https://linkedin.com/in/..."
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sender-linkedin-email">LinkedIn Login Email</Label>
                <Input
                  id="sender-linkedin-email"
                  type="email"
                  value={linkedinEmail}
                  onChange={(e) => setLinkedinEmail(e.target.value)}
                  placeholder="email@example.com"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sender-linkedin-password">LinkedIn Password</Label>
                <Input
                  id="sender-linkedin-password"
                  type="password"
                  value={linkedinPassword}
                  onChange={(e) => setLinkedinPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sender-login-method">Login Method</Label>
                  <Select value={loginMethod} onValueChange={setLoginMethod}>
                    <SelectTrigger id="sender-login-method" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="credentials">Credentials</SelectItem>
                      <SelectItem value="infinite">Infinite</SelectItem>
                      <SelectItem value="extension">Extension</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="sender-linkedin-tier">LinkedIn Tier</Label>
                  <Select value={linkedinTier} onValueChange={setLinkedinTier}>
                    <SelectTrigger id="sender-linkedin-tier" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Free</SelectItem>
                      <SelectItem value="premium">Premium</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Optional */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">Optional</p>

              <div className="space-y-1.5">
                <Label htmlFor="sender-email">Email Address (if dual-channel sender)</Label>
                <Input
                  id="sender-email"
                  type="email"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  placeholder="sender@domain.com"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sender-proxy">Proxy URL</Label>
                <Input
                  id="sender-proxy"
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  placeholder="http://user:pass@proxy:port"
                />
              </div>
            </div>
          </div>

          {error && (
            <p className="mt-3 text-sm text-destructive">{error}</p>
          )}

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="brand"
              disabled={loading || !name || !workspaceSlug}
            >
              {loading && <Loader2 className="animate-spin" />}
              {loading ? "Creating..." : "Add Sender"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

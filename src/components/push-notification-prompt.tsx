"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Bell, X } from "lucide-react";

const DISMISSED_KEY = "push-notifications-dismissed";

interface PushNotificationPromptProps {
  vapidPublicKey: string;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function PushNotificationPrompt({ vapidPublicKey }: PushNotificationPromptProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Don't show if not supported, already granted, or dismissed
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    if (Notification.permission === "granted") {
      // Silently ensure subscription exists
      ensureSubscription();
      return;
    }
    if (Notification.permission === "denied") return;
    if (localStorage.getItem(DISMISSED_KEY)) return;
    setShow(true);
  }, []);

  async function ensureSubscription() {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      if (existing) return; // Already subscribed

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as Uint8Array<ArrayBuffer>,
      });

      const json = subscription.toJSON();
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        }),
      });
    } catch (err) {
      console.error("[push] Failed to ensure subscription:", err);
    }
  }

  async function handleEnable() {
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        await ensureSubscription();
      }
    } catch (err) {
      console.error("[push] Permission request failed:", err);
    }
    setShow(false);
  }

  function handleDismiss() {
    localStorage.setItem(DISMISSED_KEY, "true");
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-lg border bg-background px-4 py-3 shadow-lg max-w-sm animate-in slide-in-from-top-2 fade-in duration-300">
      <Bell className="h-5 w-5 text-brand shrink-0" />
      <p className="text-sm text-foreground">
        Enable push notifications for support messages?
      </p>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button size="sm" onClick={handleEnable} className="h-7 bg-brand hover:bg-brand-strong text-white">
          Enable
        </Button>
        <Button size="sm" variant="ghost" onClick={handleDismiss} className="h-7 w-7 p-0">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

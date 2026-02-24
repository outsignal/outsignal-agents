"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ESignatureProps {
  proposalId: string;
  onSigned: () => void;
}

export function ESignature({ proposalId, onSigned }: ESignatureProps) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typedName, setTypedName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const hasDrawn = useRef(false);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  useEffect(() => {
    if (mode === "draw") {
      initCanvas();
    }
  }, [mode, initCanvas]);

  function getPos(
    e: React.MouseEvent | React.TouchEvent,
  ): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      const touch = e.touches[0];
      if (!touch) return null;
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    isDrawing.current = true;
    hasDrawn.current = true;
    const pos = getPos(e);
    if (!pos) return;
    const ctx = canvasRef.current?.getContext("2d");
    ctx?.beginPath();
    ctx?.moveTo(pos.x, pos.y);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!isDrawing.current) return;
    e.preventDefault();
    const pos = getPos(e);
    if (!pos) return;
    const ctx = canvasRef.current?.getContext("2d");
    ctx?.lineTo(pos.x, pos.y);
    ctx?.stroke();
  }

  function endDraw() {
    isDrawing.current = false;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn.current = false;
  }

  function getSignatureData(): string | null {
    if (mode === "draw") {
      if (!hasDrawn.current) return null;
      return canvasRef.current?.toDataURL("image/png") ?? null;
    }
    if (!typedName.trim()) return null;
    return `typed:${typedName.trim()}`;
  }

  function getSignatureName(): string {
    if (mode === "type") return typedName.trim();
    return "drawn signature";
  }

  async function handleSubmit() {
    const signatureData = getSignatureData();
    if (!signatureData) {
      setError(
        mode === "draw"
          ? "Please draw your signature"
          : "Please type your name",
      );
      return;
    }
    if (!accepted) {
      setError("Please accept the proposal terms");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/proposals/${proposalId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signatureName: getSignatureName(),
          signatureData,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to accept proposal");
      }

      onSigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border p-6">
      <h3 className="text-lg font-semibold text-gray-900">
        Accept &amp; Sign
      </h3>

      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("draw")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            mode === "draw"
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Draw Signature
        </button>
        <button
          type="button"
          onClick={() => setMode("type")}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            mode === "type"
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Type Signature
        </button>
      </div>

      {/* Signature area */}
      {mode === "draw" ? (
        <div className="space-y-2">
          <div className="relative rounded-lg border-2 border-dashed border-gray-300 bg-white">
            <canvas
              ref={canvasRef}
              className="h-32 w-full cursor-crosshair touch-none"
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            />
            <p className="absolute bottom-2 left-3 text-xs text-gray-400">
              Draw your signature above
            </p>
          </div>
          <button
            type="button"
            onClick={clearCanvas}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Clear
          </button>
        </div>
      ) : (
        <div>
          <Input
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder="Type your full name"
            className="text-lg"
          />
          {typedName && (
            <div className="mt-3 rounded-lg border bg-white p-4">
              <p
                className="text-2xl text-gray-900"
                style={{ fontFamily: "Georgia, serif", fontStyle: "italic" }}
              >
                {typedName}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Acceptance checkbox */}
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-gray-300"
        />
        <span className="text-sm text-gray-600">
          I accept the terms of this proposal and agree to the payment schedule
          outlined above.
        </span>
      </label>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <Button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full"
        size="lg"
      >
        {loading ? "Processing..." : "Accept & Sign Proposal"}
      </Button>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FaqArticle {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  sortOrder: number;
  published: boolean;
}

interface FormData {
  question: string;
  answer: string;
  category: string;
  sortOrder: number;
  published: boolean;
}

const emptyForm: FormData = {
  question: "",
  answer: "",
  category: "",
  sortOrder: 0,
  published: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)__csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FaqManagementPage() {
  const [articles, setArticles] = useState<FaqArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);

  async function fetchArticles() {
    try {
      const res = await fetch("/api/support/faq");
      const json = await res.json();
      setArticles(json.articles ?? []);
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    fetchArticles();
  }, []);

  function openNew() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(article: FaqArticle) {
    setEditingId(article.id);
    setForm({
      question: article.question,
      answer: article.answer,
      category: article.category ?? "",
      sortOrder: article.sortOrder,
      published: article.published,
    });
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSave() {
    const csrf = getCsrfToken();
    const body = JSON.stringify(form);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-csrf-token": csrf,
    };

    if (editingId) {
      await fetch(`/api/support/faq/${editingId}`, {
        method: "PUT",
        headers,
        body,
      });
    } else {
      await fetch("/api/support/faq", {
        method: "POST",
        headers,
        body,
      });
    }
    cancelForm();
    fetchArticles();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this FAQ article?")) return;
    await fetch(`/api/support/faq/${id}`, {
      method: "DELETE",
      headers: { "x-csrf-token": getCsrfToken() },
    });
    fetchArticles();
  }

  async function togglePublished(article: FaqArticle) {
    await fetch(`/api/support/faq/${article.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": getCsrfToken(),
      },
      body: JSON.stringify({ published: !article.published }),
    });
    fetchArticles();
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">FAQ Management</h1>
        <Button onClick={openNew} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Add Article
        </Button>
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="border rounded-lg p-4 mb-6 space-y-3 bg-muted/30">
          <h2 className="text-sm font-semibold">
            {editingId ? "Edit Article" : "New Article"}
          </h2>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Question
            </label>
            <textarea
              value={form.question}
              onChange={(e) => setForm({ ...form, question: e.target.value })}
              rows={2}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Answer
            </label>
            <textarea
              value={form.answer}
              onChange={(e) => setForm({ ...form, answer: e.target.value })}
              rows={4}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Category
              </label>
              <Input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Sort Order
              </label>
              <Input
                type="number"
                value={form.sortOrder}
                onChange={(e) =>
                  setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })
                }
                className="mt-1"
              />
            </div>
            <div className="flex items-end gap-2 pb-0.5">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.published}
                  onChange={(e) =>
                    setForm({ ...form, published: e.target.checked })
                  }
                  className="rounded"
                />
                Published
              </label>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleSave}>
              <Check className="h-3.5 w-3.5 mr-1" />
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelForm}>
              <X className="h-3.5 w-3.5 mr-1" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : articles.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-12">
          No FAQ articles yet. Click &quot;Add Article&quot; to create one.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-4 py-2.5 font-medium">Question</th>
                <th className="px-4 py-2.5 font-medium">Answer</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium text-center">Order</th>
                <th className="px-4 py-2.5 font-medium text-center">
                  Published
                </th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {articles.map((article) => (
                <tr key={article.id} className="border-b last:border-b-0">
                  <td className="px-4 py-2.5 max-w-[200px]">
                    <span className="line-clamp-2">{article.question}</span>
                  </td>
                  <td className="px-4 py-2.5 max-w-[250px] text-muted-foreground">
                    <span className="line-clamp-1">
                      {article.answer.length > 80
                        ? article.answer.slice(0, 80) + "..."
                        : article.answer}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {article.category && (
                      <Badge variant="outline" className="text-xs">
                        {article.category}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center text-muted-foreground">
                    {article.sortOrder}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => togglePublished(article)}
                      className={cn(
                        "inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer",
                        article.published ? "bg-green-500" : "bg-gray-300",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                          article.published
                            ? "translate-x-[18px]"
                            : "translate-x-[3px]",
                        )}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openEdit(article)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(article.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

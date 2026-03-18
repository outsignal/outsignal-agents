"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, ChevronDown, ChevronUp } from "lucide-react";

interface ClientBriefSectionProps {
  content: string;
}

/**
 * Renders a client brief markdown file as structured sections.
 * Parses markdown headings and content blocks into a readable layout.
 */
export function ClientBriefSection({ content }: ClientBriefSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const sections = parseMarkdownSections(content);

  // Show first 2 sections when collapsed
  const visibleSections = expanded ? sections : sections.slice(0, 2);
  const hasMore = sections.length > 2;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="font-heading flex items-center gap-2">
            <FileText className="h-4 w-4 text-brand" />
            Client Brief
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            From docs/clients/{sections.length > 0 ? "*.md" : ""}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {visibleSections.map((section, i) => (
          <BriefSection key={i} title={section.title} content={section.content} />
        ))}

        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="w-full text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-4 w-4 mr-1" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-1" />
                Show {sections.length - 2} more sections
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

interface Section {
  title: string;
  content: string;
}

function parseMarkdownSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let currentTitle = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    // Match ## headings (h2 level)
    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) {
      // Save previous section
      if (currentTitle) {
        sections.push({
          title: currentTitle,
          content: currentContent.join("\n").trim(),
        });
      }
      currentTitle = h2Match[1];
      currentContent = [];
      continue;
    }

    // Skip the h1 title line
    if (line.match(/^#\s+/)) continue;

    currentContent.push(line);
  }

  // Save last section
  if (currentTitle) {
    sections.push({
      title: currentTitle,
      content: currentContent.join("\n").trim(),
    });
  }

  return sections;
}

function BriefSection({ title, content }: Section) {
  if (!content) return null;

  // Check if content contains a markdown table
  const hasTable = content.includes("| ");

  return (
    <div className="rounded-md border border-border p-4">
      <h3 className="text-sm font-semibold mb-2 text-foreground">{title}</h3>
      {hasTable ? (
        <MarkdownTable content={content} />
      ) : (
        <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
          {formatContent(content)}
        </div>
      )}
    </div>
  );
}

function MarkdownTable({ content }: { content: string }) {
  const lines = content.split("\n");
  const tableLines: string[] = [];
  const otherLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("|")) {
      tableLines.push(line);
    } else {
      otherLines.push(line);
    }
  }

  // Parse table rows (skip separator row)
  const rows = tableLines
    .filter((line) => !line.match(/^\|[\s-|]+\|$/))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
    );

  const headerRow = rows[0];
  const dataRows = rows.slice(1);

  return (
    <div className="space-y-3">
      {headerRow && dataRows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {headerRow.map((cell, i) => (
                  <th
                    key={i}
                    className="text-left py-1.5 pr-4 text-muted-foreground font-medium"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  {row.map((cell, j) => (
                    <td key={j} className="py-1.5 pr-4 text-foreground">
                      {cell.replace(/`/g, "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {otherLines.filter(Boolean).length > 0 && (
        <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
          {formatContent(otherLines.join("\n").trim())}
        </div>
      )}
    </div>
  );
}

function formatContent(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1") // Strip bold markers (rendered as text)
    .replace(/^- /gm, "\u2022 ") // Convert list items to bullets
    .replace(/^  - /gm, "  \u2022 "); // Nested list items
}

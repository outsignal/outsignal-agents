"use client";

import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Brain,
  Search,
  PenTool,
  Users,
  Megaphone,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------

interface AgentDef {
  name: string;
  model: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  description: string;
  howToCall: string;
  extraNote?: string;
  examples: string[];
}

const AGENTS: AgentDef[] = [
  {
    name: "Orchestrator",
    model: "Sonnet 4",
    icon: Brain,
    iconColor: "text-violet-500",
    description:
      "Central coordinator \u2014 routes requests to specialist agents or answers simple queries directly.",
    howToCall:
      "This is the default entry point. Just run npm run chat in the terminal or use the dashboard chat. It automatically delegates to the right agent.",
    examples: [
      "Show me all campaigns for Rise",
      "What\u2019s the sender health for Lime Recruitment?",
      "Create a new campaign for YoopKnows",
    ],
  },
  {
    name: "Research Agent",
    model: "Opus 4",
    icon: Search,
    iconColor: "text-blue-500",
    description:
      "Crawls client websites, extracts ICP data, identifies USPs, case studies, and pain points.",
    howToCall: "Via orchestrator \u2014 ask it to research or analyze a website.",
    examples: [
      "Analyze the Rise website and extract their ICP",
      "Research what YoopKnows does and who their ideal customers are",
      "Crawl lime-recruitment.co.uk and update their value props",
    ],
  },
  {
    name: "Writer Agent",
    model: "Opus 4",
    icon: PenTool,
    iconColor: "text-emerald-500",
    description:
      "Generates email & LinkedIn sequences, revises copy, analyzes campaign performance.",
    howToCall:
      "Via orchestrator \u2014 ask it to write or revise sequences.",
    extraNote:
      "Copy strategies: PVP (default), Creative Ideas, One-liner, Custom",
    examples: [
      "Write a 3-step email sequence for the Rise Q2 campaign",
      "Rewrite step 2 to be shorter and more direct",
      "Write a LinkedIn sequence using the one-liner strategy for MyAcq",
      "Generate creative-ideas variants for A/B testing",
    ],
  },
  {
    name: "Leads Agent",
    model: "Sonnet 4",
    icon: Users,
    iconColor: "text-amber-500",
    description:
      "Searches/scores people, builds target lists, discovers new leads via Apollo/Prospeo/AI Ark.",
    howToCall:
      "Via orchestrator \u2014 ask it to find or manage leads.",
    examples: [
      "Find 50 CTOs in UK fintech companies with 50-200 employees",
      "Search our database for marketing directors in recruitment",
      "Score the Rise Q2 target list against their ICP",
      "Export the approved list to EmailBison",
    ],
  },
  {
    name: "Campaign Agent",
    model: "Sonnet 4",
    icon: Megaphone,
    iconColor: "text-rose-500",
    description:
      "Creates campaigns, manages status transitions, publishes for client review, handles signal campaigns.",
    howToCall:
      "Via orchestrator \u2014 ask it to create or manage campaigns.",
    examples: [
      "Create a new email campaign called \u2018Q2 Outreach\u2019 for Rise",
      "Publish the Rise Q2 campaign for client review",
      "Create a signal campaign targeting funded fintech startups",
      "Pause the YoopKnows signal campaign",
    ],
  },
];

const WORKFLOW_STEPS = [
  "Research the client\u2019s website",
  "Create a campaign",
  "Write email / LinkedIn sequences",
  "Find and score leads",
  "Publish for client review",
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgentGuidePage() {
  return (
    <div>
      <Header
        title="Agent Guide"
        description="Quick reference for calling agents from Claude Code CLI"
      />

      <div className="p-6 space-y-6">
        {/* Intro */}
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground leading-relaxed">
              These agents are available via{" "}
              <strong>Claude Code</strong> in VSCode. Start a session
              with:
            </p>
            <pre className="mt-3 rounded-lg bg-muted/60 border border-border px-4 py-3 text-sm font-mono text-foreground">
              npm run chat
            </pre>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              The orchestrator is the default entry point and will
              automatically delegate to the right specialist agent
              based on your request. You can also use the dashboard
              chat.
            </p>
          </CardContent>
        </Card>

        {/* Typical workflow */}
        <Card>
          <CardHeader>
            <CardTitle>Typical Workflow</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2">
              {WORKFLOW_STEPS.map((step, i) => (
                <li key={i} className="flex items-center gap-3 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-xs font-bold">
                    {i + 1}
                  </span>
                  <span className="text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        {/* Agent cards */}
        <div className="grid gap-6">
          {AGENTS.map((agent) => (
            <Card key={agent.name}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className={`rounded-lg bg-muted/60 p-2 ${agent.iconColor}`}>
                    <agent.icon className="h-5 w-5" />
                  </div>
                  <div className="flex items-center gap-2.5">
                    <CardTitle>{agent.name}</CardTitle>
                    <Badge variant="outline">{agent.model}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {agent.description}
                </p>

                {agent.extraNote && (
                  <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">Note:</strong>{" "}
                    {agent.extraNote}
                  </p>
                )}

                <div>
                  <p className="text-xs font-medium text-muted-foreground/60 mb-2">
                    How to call
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {agent.howToCall}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium text-muted-foreground/60 mb-2">
                    Example prompts
                  </p>
                  <div className="space-y-1.5">
                    {agent.examples.map((ex, i) => (
                      <div
                        key={i}
                        className="rounded-md bg-muted/50 border border-border/50 px-3 py-2 text-sm font-mono text-foreground/80"
                      >
                        {ex}
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

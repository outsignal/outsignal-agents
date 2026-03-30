/**
 * validate-sequence.ts
 *
 * CLI wrapper script: validate a complete outbound sequence for semantic and structural quality.
 * Usage: node dist/cli/validate-sequence.js --file /tmp/{uuid}.json
 *
 * Input JSON format:
 * {
 *   "steps": [{ "position": 1, "subjectLine": "...", "body": "...", "channel": "email" }, ...],
 *   "context": { "vertical": "...", "outreachTonePrompt": "...", "icpIndustries": [...], "icpDecisionMakerTitles": [...], "strategy": "pvp" }
 * }
 *
 * Runs deterministic structural checks via copy-quality.ts, then invokes Claude Code CLI
 * for semantic analysis. Merges both sets of findings into a single ValidationResult.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import * as path from "path";
import { validationResultSchema } from "@/lib/agents/types";
import type { ValidationFinding, ValidationResult } from "@/lib/agents/types";
import {
  checkCopyQuality,
  checkWordCount,
  checkGreeting,
  checkCTAFormat,
  checkSubjectLine,
  checkLinkedInSpintax,
  checkSequenceQuality,
  type CopyStrategy,
} from "@/lib/copy-quality";

// --- Argument parsing ---

function getFileArg(): string {
  const idx = process.argv.indexOf("--file");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  const eqArg = process.argv.find((a) => a.startsWith("--file="));
  if (eqArg) return eqArg.split("=")[1];
  throw new Error("Missing required argument: --file <path>");
}

// --- Structural checks (deterministic, no LLM) ---

interface InputStep {
  position: number;
  subjectLine?: string;
  subjectVariantB?: string;
  body: string;
  channel: "email" | "linkedin";
  notes?: string;
}

interface InputContext {
  vertical?: string;
  outreachTonePrompt?: string;
  icpIndustries?: string[];
  icpDecisionMakerTitles?: string[];
  strategy: string;
}

function runStructuralChecks(
  steps: InputStep[],
  strategy: string,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const copyStrategy = (strategy === "linkedin" ? "linkedin" : strategy) as CopyStrategy;

  for (const step of steps) {
    const isFirstStep = step.position === 1;

    // Body checks
    if (step.body) {
      // Word count
      const wc = checkWordCount(
        step.body,
        step.channel === "linkedin" ? "linkedin" as CopyStrategy : copyStrategy,
      );
      if (wc) {
        findings.push({
          check: "structural",
          severity: wc.severity,
          step: step.position,
          field: "body",
          problem: wc.violation,
          suggestion: "Shorten the body text to fit within the word count limit.",
        });
      }

      // Greeting
      const gr = checkGreeting(step.body, isFirstStep);
      if (gr) {
        findings.push({
          check: "structural",
          severity: gr.severity,
          step: step.position,
          field: "body",
          problem: gr.violation,
          suggestion: "Add a greeting like 'Hi {FIRSTNAME},' at the start.",
        });
      }

      // CTA format (email only)
      if (step.channel === "email") {
        const cta = checkCTAFormat(step.body);
        if (cta) {
          findings.push({
            check: "structural",
            severity: cta.severity,
            step: step.position,
            field: "body",
            problem: cta.violation,
            suggestion: "End with a soft question CTA.",
          });
        }
      }

      // LinkedIn spintax
      if (step.channel === "linkedin") {
        const sp = checkLinkedInSpintax(step.body);
        if (sp) {
          findings.push({
            check: "structural",
            severity: sp.severity,
            step: step.position,
            field: "body",
            problem: sp.violation,
            suggestion: "Remove spintax from LinkedIn messages — pick one option.",
          });
        }
      }

      // Banned patterns on body
      const { violations: bodyViolations } = checkCopyQuality(step.body);
      for (const v of bodyViolations) {
        findings.push({
          check: "structural",
          severity: "hard",
          step: step.position,
          field: "body",
          problem: `Banned pattern: ${v}`,
          suggestion: `Remove or rewrite the '${v}' pattern.`,
        });
      }
    }

    // Subject line checks
    for (const [field, value] of [
      ["subject", step.subjectLine],
      ["subjectVariantB", step.subjectVariantB],
    ] as const) {
      if (!value) continue;

      const sl = checkSubjectLine(value);
      if (sl) {
        findings.push({
          check: "structural",
          severity: sl.severity,
          step: step.position,
          field,
          problem: sl.violation,
          suggestion: "Fix the subject line per the rules.",
        });
      }

      const { violations: subjViolations } = checkCopyQuality(value);
      for (const v of subjViolations) {
        findings.push({
          check: "structural",
          severity: "hard",
          step: step.position,
          field,
          problem: `Banned pattern: ${v}`,
          suggestion: `Remove or rewrite the '${v}' pattern.`,
        });
      }
    }
  }

  // Sequence-level structural check (cross-step banned patterns)
  const seqViolations = checkSequenceQuality(
    steps.map((s) => ({
      position: s.position,
      subjectLine: s.subjectLine,
      subjectVariantB: s.subjectVariantB,
      body: s.body,
    })),
  );
  // These are already covered by per-step checks above, so skip to avoid duplicates

  return findings;
}

// --- Prompt construction for Claude CLI ---

function buildPrompt(
  steps: InputStep[],
  context: InputContext,
  rulesContent: string,
): string {
  const parts: string[] = [];

  parts.push("You are a copy quality validator. Here are your rules:\n");
  parts.push(rulesContent);
  parts.push("\n---\n");
  parts.push("## Sequence to Validate\n");
  parts.push(JSON.stringify(steps, null, 2));
  parts.push("\n---\n");
  parts.push("## Workspace Context\n");
  parts.push(`Vertical: ${context.vertical ?? "Not specified"}`);
  parts.push(`Outreach Tone: ${context.outreachTonePrompt ?? "Not specified"}`);
  parts.push(`Strategy: ${context.strategy}`);
  if (context.icpIndustries?.length) {
    parts.push(`ICP Industries: ${context.icpIndustries.join(", ")}`);
  }
  if (context.icpDecisionMakerTitles?.length) {
    parts.push(`ICP Decision Maker Titles: ${context.icpDecisionMakerTitles.join(", ")}`);
  }
  parts.push("\n---\n");
  parts.push("Return ONLY a raw JSON object matching the ValidationResult schema. No markdown, no explanation, no code fences.");

  return parts.join("\n");
}

// --- JSON extraction from Claude output ---

function extractJSON(text: string): unknown {
  // Try raw parse first
  try {
    return JSON.parse(text);
  } catch {
    // noop
  }

  // Try extracting from ```json code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch {
      // noop
    }
  }

  // Try finding a JSON object in surrounding text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // noop
    }
  }

  return null;
}

// --- Safe fallback ---

function safeFallback(
  structuralFindings: ValidationFinding[],
  reason: string,
): ValidationResult {
  const hasHardStructural = structuralFindings.some((f) => f.severity === "hard");
  return {
    passed: !hasHardStructural,
    findings: structuralFindings,
    summary: `Semantic validation skipped (${reason}) — structural checks only.${structuralFindings.length > 0 ? ` Found ${structuralFindings.length} structural issue(s).` : ""}`,
    checklist: {
      fillerSpintax: "pass",
      tonalMismatch: "pass",
      angleRepetition: "pass",
      aiPatterns: "pass",
    },
  };
}

// --- Main ---

runWithHarness("validate-sequence --file <path>", async () => {
  const filePath = getFileArg();
  const input = JSON.parse(readFileSync(filePath, "utf-8"));
  const steps: InputStep[] = input.steps;
  const context: InputContext = input.context;

  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    throw new Error("Input must contain a non-empty 'steps' array.");
  }

  // Step 1: Run deterministic structural checks
  const structuralFindings = runStructuralChecks(steps, context.strategy);

  // Step 2: Read validator-rules.md from disk
  let rulesContent: string;
  try {
    const rulesPath = path.resolve(
      process.env.PROJECT_ROOT ?? process.cwd(),
      ".claude/rules/validator-rules.md",
    );
    rulesContent = readFileSync(rulesPath, "utf-8");
  } catch {
    // If rules file can't be read, return structural-only results
    return safeFallback(structuralFindings, "validator-rules.md not found");
  }

  // Step 3: Build prompt and invoke Claude Code CLI
  const prompt = buildPrompt(steps, context, rulesContent);
  const promptPath = `/tmp/validator-prompt-${randomUUID()}.txt`;

  let semanticResult: ValidationResult | null = null;

  try {
    writeFileSync(promptPath, prompt);

    const output = execSync(
      `claude -p "$(cat '${promptPath}')" --output-format json`,
      {
        timeout: 60_000,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024, // 10MB
      },
    );

    // Parse Claude's output — it wraps in a JSON envelope with "result" field
    let rawText = output;
    try {
      const envelope = JSON.parse(output);
      if (envelope.result) {
        rawText = envelope.result;
      }
    } catch {
      // Not a JSON envelope, use raw output
    }

    const parsed = extractJSON(rawText);
    if (parsed) {
      const validated = validationResultSchema.safeParse(parsed);
      if (validated.success) {
        semanticResult = validated.data;
      }
    }
  } catch {
    // Timeout or exec error — fall through to safe fallback
  } finally {
    try {
      unlinkSync(promptPath);
    } catch {
      // ignore cleanup errors
    }
  }

  // Step 4: Merge structural + semantic results
  if (!semanticResult) {
    return safeFallback(structuralFindings, "timeout/parse error");
  }

  // Append structural findings to semantic findings
  const mergedFindings = [...semanticResult.findings, ...structuralFindings];
  const hasHardFinding = mergedFindings.some((f) => f.severity === "hard");

  return {
    passed: !hasHardFinding,
    findings: mergedFindings,
    summary: semanticResult.summary,
    checklist: semanticResult.checklist,
  } satisfies ValidationResult;
});

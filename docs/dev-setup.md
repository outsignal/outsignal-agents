# Dev Setup

## Pre-commit hook

This repo ships a pre-commit hook at `.git/hooks/pre-commit` that runs two gates
before allowing a commit:

1. **Trufflehog secret scan** — blocks commits that contain verified secrets in
   staged changes.
2. **TypeScript typecheck** — runs `npx tsc --noEmit` over the whole project
   when any staged file matches `*.ts` or `*.tsx`. Non-code commits (docs,
   JSON, config) skip the typecheck gate, so they stay fast.

### Why

Broken commits (stray type errors, missing type updates) have landed in the
past because `tsc --noEmit` was a manual step. The hook makes typecheck
automatic so broken TS code cannot enter the history.

### Installing on a fresh clone

Git does not clone `.git/hooks` with a repository, so after cloning you need
to reinstate the hook once. The canonical copy lives at
`.git/hooks/pre-commit` on any existing clone — grab it from a teammate or
copy the block below into your own `.git/hooks/pre-commit`:

```bash
#!/usr/bin/env bash
# Pre-commit hook for outsignal-agents
# Runs two gates before allowing a commit:
#   1. trufflehog secret scan on staged changes
#   2. npx tsc --noEmit typecheck (only when .ts/.tsx files are staged)
#
# Bypass with: git commit --no-verify

set -e

# ---- Gate 1: trufflehog secret scan ----
TRUFFLEHOG=$(command -v trufflehog 2>/dev/null || echo "")
if [ -n "$TRUFFLEHOG" ]; then
  "$TRUFFLEHOG" git file://. --since-commit HEAD --only-verified --fail 2>/dev/null
  if [ $? -ne 0 ]; then
    echo "ERROR: trufflehog detected secrets in staged changes. Commit blocked."
    exit 1
  fi
fi

# ---- Gate 2: TypeScript typecheck ----
STAGED_TS=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(ts|tsx)$' || true)

if [ -n "$STAGED_TS" ]; then
  echo "pre-commit: running npx tsc --noEmit (staged .ts/.tsx detected)"
  if ! npx tsc --noEmit; then
    echo ""
    echo "ERROR: typecheck failed. Commit blocked."
    echo "Fix the errors above, or bypass with: git commit --no-verify"
    exit 1
  fi
fi

exit 0
```

After creating the file, make it executable:

```bash
chmod +x .git/hooks/pre-commit
```

The hook auto-detects trufflehog via `command -v`. If trufflehog is not
installed or not on PATH, the secret scan gate is skipped silently.

### Emergency bypass

`git commit --no-verify` skips both gates. Use it when shipping an emergency
fix where the typecheck/secret gate is known to be fine but cannot run
locally. Do not make this a habit.

### Scope choice

The hook runs the **full project** typecheck, not a per-file one. `tsc` needs
the whole project graph to resolve imports correctly, so per-file typecheck
is unreliable. Full project typecheck on this repo takes under 30 seconds in
practice. To keep non-code commits fast, the hook only runs `tsc` when at
least one staged file matches `*.ts` or `*.tsx`.

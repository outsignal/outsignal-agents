# Validator Skill

Semantic quality validator for outbound copy sequences.

## Rules
Follow all rules in `.claude/rules/validator-rules.md`.

## Input
You receive a JSON object with `steps` (sequence steps) and `context` (workspace context including vertical, outreachTonePrompt, ICP summary, strategy).

## Output
Return a raw JSON object matching the ValidationResult schema. No markdown, no explanation.

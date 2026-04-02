# Bug: Railway Worker — Playwright Browsers Not Installed

## Symptoms
- ALL LinkedIn sessions expired and cannot recover
- Worker logs show: `browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell`
- Auto-re-login fails for all 4 senders (Daniel Lazarus, Lucy Marshall, Jonathan Sprague, James Bessey-Saldanha)
- Recovery budget exhausted (2/2 per day per sender) with 0 recoveries
- All workspaces show "No active senders"

## Root Cause
Playwright Chromium binaries are missing from the Railway container. The worker's auto-re-login flow needs a headless browser to perform LinkedIn login, but the browser executable doesn't exist at the expected cache path.

This is likely caused by a Railway container rebuild that wiped the Playwright browser cache. The build process installs Playwright as an npm dependency but doesn't run `npx playwright install` to download the actual browser binaries.

## Evidence (from Railway logs)
```
✗ browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell
╔═════════════════════════════════════════════════════════════════════════╗
║ Looks like Playwright Test or Playwright was just installed or updated. ║
║ Please run the following command to download new browsers:              ║
║     npx playwright install                                              ║
╚═════════════════════════════════════════════════════════════════════════╝
[Worker] Auto-re-login failed for Daniel Lazarus — login returned false
[Worker] Recovery: 0/4 session(s) recovered
```

## Fix Required

### Immediate fix
SSH into the Railway container or use `railway run` to execute:
```
npx playwright install chromium
```

### Permanent fix
Ensure the Dockerfile or build command includes Playwright browser installation so it survives container rebuilds. Check:

1. **Dockerfile** (if exists in the worker repo) — add after `npm install`:
   ```dockerfile
   RUN npx playwright install chromium --with-deps
   ```
   The `--with-deps` flag also installs OS-level dependencies (libglib, libnss, etc.) that Chromium needs on Linux.

2. **railway.toml** or Railway dashboard build settings — if using Nixpacks (Railway's default builder), add a build command:
   ```
   [build]
   buildCommand = "npm install && npx playwright install chromium --with-deps"
   ```

3. **package.json postinstall** — alternative approach:
   ```json
   "scripts": {
     "postinstall": "npx playwright install chromium"
   }
   ```

### After deployment
Once Playwright browsers are installed, the auto-re-login should work and recover the 4 expired sessions automatically (recovery budget resets daily). If sessions still fail to recover:
- Check that stored credentials (encrypted on Sender records) are still valid
- Manual re-authentication may be needed via Chrome extension or headless login endpoint

## Key Files
- Worker repo (Railway): check Dockerfile, railway.toml, package.json build scripts
- `worker/src/linkedin-browser.ts` — uses Playwright to launch headless Chromium
- `worker/src/session-server.ts` — auto-re-login flow that calls browser.login()

## Impact
**CRITICAL** — ALL LinkedIn outreach is completely offline across all workspaces. No sends, no message checks, no connection requests. Blocks all campaign launches.

## Priority
Fix immediately. This is the single blocker for all LinkedIn operations.

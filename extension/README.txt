Outsignal LinkedIn Connector - Chrome Extension

DEVELOPMENT:
1. Open chrome://extensions in Chrome
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select this extension/ directory
5. The Outsignal icon appears in the toolbar

TESTING:
1. Click the Outsignal icon in toolbar
2. Log in with your workspace credentials
3. Make sure you're logged into LinkedIn in the same browser
4. Click "Connect LinkedIn"
5. Verify green checkmark status

CHROME WEB STORE PUBLICATION:
1. Replace placeholder icons with branded Outsignal icons (16/32/48/128 px)
2. Create screenshots (1280x800 or 640x400)
3. Zip the extension/ directory contents (not the directory itself)
4. Upload at https://chrome.google.com/webstore/devconsole
5. One-time $5 developer fee
6. Review typically takes 1-3 business days

NOTES:
- Manifest V3 required for all new Chrome Web Store submissions
- Extension checks LinkedIn cookie health every 4 hours
- Red badge + notification appear when session expires
- API token stored in chrome.storage.local (7-day expiry)

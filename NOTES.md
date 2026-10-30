# NOTES

Things that broke and how we fixed them.

## 2026-10-30: Broadway Direct falsely flagged as a Cloudflare challenge

- **Symptom:** `lottery.broadwaydirect.com` came back HTTP 200, 125 KB, title "Lottery | Broadway Direct", but `detectBlock` said "cloudflare challenge".
- **Cause:** the pattern matched any `challenge-platform`. Cloudflare injects a passive beacon (`/cdn-cgi/challenge-platform/scripts/jsd/main.js`) into normal pages.
- **Fix:** match only real challenge markers: `cf-chl`, `cf_chl_opt`, `challenge-platform/h/`. A blocked page is cached from a destination response, so the corrected check re-runs on the cached copy with no new request.

## 2026-10-30: `.env.*` in .gitignore also ignored `.env.example`

- **Fix:** added `!.env.example` to `.gitignore`.

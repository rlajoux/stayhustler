# StayHustler audit fixes

10 September 2026. Implemented on `codex/audit-fixes`, based on GitHub main `081141373bc809e038563d18464fd576dfd031b2`.

Code changes are prepared on the audit-fixes branch for review. Deployment has not been performed. The original checkout and its existing changes are preserved. Production credentials, hosting configuration and live provider transactions were not accessed. Perceived-value redesign, SEO growth and SEM strategy remain for the next review.

## What changed

| Finding | Implemented change | Evidence |
| --- | --- | --- |
| F01: paid hand-off | Save booking, request type, email and price before Stripe. Signed webhooks and browser returns mark the same order paid. A database worker saves one result and sends a receipt/recovery link plus that result. | PostgreSQL tests cover concurrent checkout, duplicate events, no browser return, refresh and recovery. |
| F02: retired model and hidden failure | Central `gemini-3.1-flash-lite` default, configurable via `GEMINI_MODEL`; structured JSON, 15-second call deadline, two calls per attempt, up to three saved-order attempts with a five-minute retry delay. Invalid output becomes a visible failure, never a successful generic template. | Tests cover invalid JSON, truncation, provider errors, timeout and retry. Real-model writing quality remains a staging check. |
| F03: dropped request type | Preserve all six types and flexibility details. Validate that the output addresses the selected benefit, contains the hotel and dates, and does not turn a view-only request into a category upgrade. | Tests exercise all six types and reject mismatched content. |
| F04: unauthorised work | Results, generation and delivery require an owned paid/free order. Shared database limits use the configured Express proxy boundary. Recipient and delivery IDs cannot override the order. | Tests cover unauthorised calls, ownership, recipient changes, arbitrary leftmost forwarding addresses and origin restrictions. |
| F05: HTML/CSV injection | Results render plain text. Admin values are escaped. Spreadsheet formula prefixes are neutralised. API pages use nonce CSP; static HTML uses generated script hashes. | Malicious stored-value, CSV and CSP tests; results browser checks. |
| F06: resend and recovery | Resend the stored result to the original address, with an order-based delivery ID and cooldown. Show provider acceptance accurately. | API and browser resend checks. |
| F07: guide loops | Remove clean-URL redirects back to `.html`. Keep Cloudflare pretty URLs; provide Apache internal rewrites. | Static route checks and bounded redirect-validator tests, including a deliberately looping fixture. Live URLs change only after deployment. |
| F08: false conversions | Paid order ledger with current refund status, separate free grants, saved feedback, and verified browser GA4 purchases with transaction IDs. Reports label their rolling purchase cohort. | Tests cover free/paid separation, feedback, duplicate payment events, partial/full refunds and refund-before-payment ordering. |
| F09: free access/configuration | Retire reusable public free coupons and grant endpoints. Authenticated admin grants remain available. Require strong secrets; missing cron secret disables that endpoint. Restrict CORS/origins. | Configuration, access, coupon and cron tests. |
| F10: retention/privacy | Thirty-day recovery from payment, daily removal of order personal data and older delivery payloads, shorter-lived usage/limit records. Explain Gemini, hosting, email, analytics and retained transaction records. | Retention tests use disposable database records. No production data was deleted. |
| F11: dependencies/runtime | Node 24, locked clean installs, compatible Express 4 updates and targeted `qs` override. | Clean Node 24 install; npm audit reports zero known vulnerabilities. |
| F12: forms | Reject reversed dates, invalid types/enums and oversized strings. Restore saved answers; editing derived stay details returns to booking dates. Preserve Unicode hotel names. | API tests and browser checks for reversed dates, back-navigation and a Thai hotel name. |
| F13: publishing/CI | `public/` is canonical. Root files are generated mirrors. Tests gate the Hostinger workflow; only `public/` is uploaded. Pin SSH host keys. Static CSP is generated, and obsolete result pages redirect to authenticated results. | Script parsing, sitemap existence, mirror equality, CSP regeneration, redirect-loop tests and diff whitespace checks. |
| F14: operations | Await schema setup before listening. Add readiness and build revision endpoints. Persist scheduled-job timestamps, lock work across processes, expose overdue/failed work, and verify database TLS unless private-network plaintext is explicitly selected. | Readiness-failure, durable-order and provider-failure tests. Runtime topology still requires deployment verification. |

Also removed the unsupported numerical upgrade probabilities and the misleading “Free” homepage title. Corrected instant-delivery and newsletter offline-sync claims. These are corrections to the existing offer, not a new conversion strategy.

The larger deletions remove obsolete payment/generation implementations and duplicate results scripts. The application remains static HTML plus Express/PostgreSQL; no new runtime dependency or frontend framework was introduced.

## Verification

- 30 automated tests passed on Node 24.11.0 using isolated PostgreSQL and mocked Stripe/Gemini/SendGrid. No tests skipped in the full run.
- 29 canonical HTML pages and 40 inline scripts parsed successfully; JSON-LD, sitemap file targets, redirect directions, generated CSP and root mirrors checked.
- Clean `npm ci --ignore-scripts`: zero known dependency vulnerabilities.
- Browser: invalid date rejection, Unicode booking, restored booking/context answers, selected late-checkout preview, recoverable checkout outage, paid-result recovery, copy and resend. No console errors observed in those checks. Results and payment had no horizontal overflow at a 390px viewport (375px content area).
- External analytics were disabled in the browser fixtures. No real payment, newsletter submission, model call or email was made.

To repeat:

```sh
cd api
npm ci --ignore-scripts
TEST_DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/stayhustler_test npm test
```

Use a disposable database. Integration tests create and remove an isolated schema. Without `TEST_DATABASE_URL`, the database suite explicitly skips; that is not a complete release check. CI supplies PostgreSQL automatically.

After editing frontend HTML:

```sh
node scripts/build-headers.js
node scripts/sync-public.js
node scripts/check-site.js
```

The local browser fixture is `api/tests/helpers/preview-server.js`; it requires a local disposable `TEST_DATABASE_URL`, listens on ports 3000/8080, mocks every provider and disables external analytics. It creates a local recovery-link file under `/private/tmp`.

## Before deployment

1. Confirm the active publishing service. Live HTML matched `public/` during the audit, while the repository workflow targeted Hostinger from the root. Both Cloudflare Pages and the repaired Hostinger workflow must publish `public/`, after the same CI checks. Cloudflare build command: `node scripts/check-site.js && node scripts/build-headers.js --check && node scripts/sync-public.js --check`; output directory: `public`. Require the Code checks job before merging to main. Automatic Cloudflare deployment settings and branch protection are account settings and have not been changed here.
2. Configure the API using `api/.env.example`. `ACCESS_TOKEN_SECRET` and `UNSUBSCRIBE_SECRET` need independent random values of at least 32 characters. `ADMIN_PASS` needs at least 16. Keep an existing strong unsubscribe secret to preserve newsletter links. `REPORT_EMAIL` is optional but must be set to receive operational reports. `CRON_SECRET` is optional and the endpoint is disabled without it.
3. Register Stripe endpoint `https://app.stayhustler.com/api/stripe/webhook`, set its signing secret, and enable `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `refund.created`, `refund.updated`, `refund.failed` and `charge.refunded`. Use matching live/test keys and signing secrets. The worker runs inside the API process; keep at least one instance running rather than sleeping the service between requests.
4. Verify the actual proxy chain and database network. The default trusts one Railway ingress proxy. Set explicit trusted proxy CIDRs if different. TLS certificate verification is the default in production; `DATABASE_SSL=disable` is only for the private database network. A publicly accessible database must use verified TLS.
5. For Hostinger, set `SSH_KNOWN_HOSTS` to the host key verified with the hosting provider. The workflow intentionally fails without a pinned host key. It now synchronises only `public/`; review any files maintained manually in the remote public directory before running its existing `--delete` behaviour.
6. Deploy the API and frontend together after review. The hardened API rejects the old incomplete checkout payload, so avoid leaving the old frontend paired with the new API. New tables are additive; back up the database before release. Set the Railway health-check path to `/ready`, and expose a build revision through `RAILWAY_GIT_COMMIT_SHA` or `BUILD_REVISION`. `/version` reports it; the Hostinger workflow writes `/build-info.json` for the frontend.
7. In staging, run a Stripe test-mode purchase for each request type, inspect actual Gemini output, verify SendGrid sender authentication and inbox delivery, cancel/return/recover, replay a signed event, and issue a test refund. Verify CSP on actual Cloudflare/Apache responses and run `bash scripts/validate-sitemap.sh` after deployment. A configured credential or healthy readiness endpoint does not prove provider delivery.

## Operational limits and trade-offs

- SendGrid acceptance does not prove inbox delivery. A lost provider response is marked for attention; it is not blindly retried. A user-triggered resend can duplicate an email if the first provider request succeeded but its response was lost. Exactly-once external email delivery is not claimed.
- After three generation attempts, the order remains visible for support/refund handling. The admin order list and reports expose failures; monitor these operationally. No automatic refund is issued by this patch.
- Reporting uses orders paid in the last 24 hours for revenue/refund cohort totals. Failure and overdue counts cover all unexpired paid/free orders. It does not claim traffic-to-purchase conversion without a verified visitor denominator. GA4 is secondary and can be blocked by browsers; PostgreSQL/Stripe remain the financial source of truth.
- Public free coupons (`TRYITFREE`, `ADMINFREE100`) are retired. Existing paid discounts remain. An admin can create a free order with Basic authentication at `POST /admin/orders/free`, using the same validated booking/context/email schema. Do not put admin credentials in frontend code.
- Old purchases cannot be reliably reconstructed from the former unauthenticated delivery table. Review existing customers and Stripe records before cutover; provide support for any affected historical orders. The 30-day cleanup also applies to historical delivery records once the new worker is deployed. Provider logs/backups have separate retention settings and need review.
- This is verified local implementation, not a live-production certification, load test, independent penetration test or legal compliance review. Actual model writing quality, deliverability, active hosting configuration and production reconciliation are still release checks.

Implementation references: [Stripe fulfilment](https://docs.stripe.com/checkout/fulfillment), [Stripe webhooks](https://docs.stripe.com/webhooks), [Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite), [Gemini structured generation configuration](https://ai.google.dev/api/generate-content#generationconfig).

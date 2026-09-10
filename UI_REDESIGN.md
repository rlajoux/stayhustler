# StayHustler UI redesign

The customer interface now uses a travel-service layout inspired by Agoda: white navigation, blue actions, real hotel photography, a prominent request panel, compact information cards and a clear checkout summary. StayHustler keeps its own name, mark and $7 request product.

## Scope

- Redesigned all 29 static customer pages and the authenticated results page.
- Added a homepage starter that carries the selected request, hotel and city into the existing booking flow. Existing draft dates and preferences remain editable.
- Added shared navigation, mobile menus, progress steps, responsive forms, guide cards, reading layouts and a consistent footer.
- Reworked the saved request around the email, timing advice, desk script, copying and resend actions. Print output includes the entire email, including long requests.
- Connected the legacy save-page newsletter and post-stay notification forms to the existing subscription endpoint. Success is shown only after the server accepts the address; failures permit retry.
- Replaced the save-page placeholder email action with a mailto draft. Removed an unverified local-storage payment badge and an unsupported social-proof line.
- Preserved checkout, payment verification, order recovery, generation, delivery, pricing and verified purchase measurement.

## Files and deployment

`public/` remains the static deployment source. `public/assets/site.css` owns the shared styling. `home.js`, `request-choice.js` and `subscriptions.js` handle the new starter and existing subscription journeys without adding dependencies.

`scripts/sync-public.js` continues to generate the root preview mirrors and now copies the shared stylesheet and favicon to `api/assets/`. Express serves that limited asset directory for the authenticated results page. Deploy both the static site and API to apply the complete redesign.

Photography is self-hosted. Source and licence links are recorded in `public/assets/photos/CREDITS.txt`. The photos illustrate hotel stays and do not represent bookable inventory.

Regenerate deployment output after HTML or style edits:

```sh
node scripts/build-headers.js
node scripts/sync-public.js
```

## Verification

- All 30 existing regression tests passed on Node 24 against an isolated local PostgreSQL database.
- Static checks passed for 29 HTML pages, inline JavaScript syntax, CSP hashes, source mirrors, sitemap destinations and redirects.
- Internal page links, fragment anchors and asset paths resolved; no duplicate IDs or missing script target elements.
- Browser checks covered the homepage starter, booking, request preferences, review, checkout error recovery, saved-order recovery, copying, resend, both free tools, mobile navigation and subscription forms.
- All guide articles and supporting page layouts were checked on mobile. Core request pages were additionally checked at a 320-pixel viewport and the narrow-screen progress layout was corrected.
- Desktop and mobile screenshots were reviewed. Browser checks used mock payment, generation and email providers; no live charge or customer email was sent.

This redesign was developed on `codex/audit-fixes`. Deployment is a separate step and must include both the static site and API.

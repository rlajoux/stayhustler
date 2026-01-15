# SEO Canonical Enforcement

## Overview

This document describes the SEO canonical enforcement for StayHustler:

- **Canonical host**: `https://stayhustler.com` (non-www, HTTPS)
- **App subdomain**: `app.stayhustler.com` (API only, noindex)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        DNS / Edge                                │
├─────────────────────────────────────────────────────────────────┤
│  http://www.stayhustler.com/*  ──301──> https://stayhustler.com/*│
│  https://www.stayhustler.com/* ──301──> https://stayhustler.com/*│
│  http://stayhustler.com/*      ──301──> https://stayhustler.com/*│
│  https://stayhustler.com/*     ──200──> (serves content)         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    App Subdomain (Railway)                       │
├─────────────────────────────────────────────────────────────────┤
│  All responses include:  X-Robots-Tag: noindex, nofollow        │
│  GET /robots.txt returns: Disallow: /                           │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Details

### 1. Redirect Rules (Hostinger .htaccess)

Location: `/.htaccess`

**Rule 1: www → non-www**
```apache
RewriteCond %{HTTP_HOST} ^www\.stayhustler\.com$ [NC]
RewriteRule ^(.*)$ https://stayhustler.com/$1 [R=301,L,QSA]
```

**Rule 2: http → https**
```apache
RewriteCond %{HTTPS} !=on
RewriteCond %{HTTP_HOST} ^stayhustler\.com$ [NC]
RewriteRule ^(.*)$ https://stayhustler.com/$1 [R=301,L,QSA]
```

**Key behaviors:**
- Single-hop redirects (no chains)
- Path preserved via `$1` backreference
- Query string preserved via `QSA` flag
- Case-insensitive matching via `NC` flag

### 2. Canonical Tags (Marketing Site)

All public marketing pages include:
```html
<link rel="canonical" href="https://stayhustler.com{PATH}">
```

**Pages with canonical tags:**
| Page | Canonical URL |
|------|---------------|
| index.html | https://stayhustler.com/ |
| guides/how-to-ask-for-a-hotel-upgrade.html | https://stayhustler.com/guides/how-to-ask-for-a-hotel-upgrade.html |
| guides/best-time-to-ask-for-hotel-upgrade.html | https://stayhustler.com/guides/best-time-to-ask-for-hotel-upgrade.html |
| guides/hotel-upgrade-email-template.html | https://stayhustler.com/guides/hotel-upgrade-email-template.html |
| guides/independent-vs-chain-hotel-upgrades.html | https://stayhustler.com/guides/independent-vs-chain-hotel-upgrades.html |
| guides/late-checkout-vs-room-upgrade.html | https://stayhustler.com/guides/late-checkout-vs-room-upgrade.html |

**Note:** Canonical URLs are static and do not include tracking parameters (utm_*, gclid, fbclid).

### 3. App Subdomain SEO Isolation

Location: `api/server.js`

**Global middleware (all routes):**
```javascript
app.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
});
```

**robots.txt endpoint:**
```javascript
app.get('/robots.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.send(`User-agent: *\nDisallow: /\n`);
});
```

### 4. Funnel Pages (noindex)

All funnel pages have both `<meta name="robots">` and are listed in robots.txt Disallow:

| Page | Status |
|------|--------|
| booking.html | noindex, nofollow |
| context.html | noindex, nofollow |
| preview.html | noindex, nofollow |
| payment.html | noindex, nofollow |
| results.html | noindex, nofollow |
| stripe-success.html | noindex, nofollow |
| stripe-cancel.html | noindex, nofollow |
| save.html | noindex, nofollow |
| feedback.html | noindex, nofollow |
| reengage.html | noindex, nofollow |
| 404.html | noindex, nofollow |

---

## Verification

### Manual curl checks

Run these commands to verify redirect behavior:

```bash
# Test 1: http://www.stayhustler.com → should 301 to https://stayhustler.com
curl -I http://www.stayhustler.com/
# Expected: HTTP/1.1 301 Moved Permanently
# Expected: Location: https://stayhustler.com/

# Test 2: https://www.stayhustler.com → should 301 to https://stayhustler.com
curl -I https://www.stayhustler.com/
# Expected: HTTP/1.1 301 Moved Permanently
# Expected: Location: https://stayhustler.com/

# Test 3: http://stayhustler.com → should 301 to https://stayhustler.com
curl -I http://stayhustler.com/
# Expected: HTTP/1.1 301 Moved Permanently
# Expected: Location: https://stayhustler.com/

# Test 4: https://stayhustler.com → should return 200
curl -I https://stayhustler.com/
# Expected: HTTP/1.1 200 OK

# Test 5: Path + query preservation
curl -I "http://www.stayhustler.com/guides/how-to-ask-for-a-hotel-upgrade.html?utm_source=test"
# Expected: Location: https://stayhustler.com/guides/how-to-ask-for-a-hotel-upgrade.html?utm_source=test

# Test 6: App subdomain robots.txt
curl https://app.stayhustler.com/robots.txt
# Expected: User-agent: *
#           Disallow: /

# Test 7: App subdomain X-Robots-Tag header
curl -I https://app.stayhustler.com/health
# Expected: X-Robots-Tag: noindex, nofollow
```

### Expected Results Summary

| URL | Expected Status | Expected Location |
|-----|-----------------|-------------------|
| http://www.stayhustler.com/ | 301 | https://stayhustler.com/ |
| https://www.stayhustler.com/ | 301 | https://stayhustler.com/ |
| http://stayhustler.com/ | 301 | https://stayhustler.com/ |
| https://stayhustler.com/ | 200 | - |
| http://www.stayhustler.com/path?q=1 | 301 | https://stayhustler.com/path?q=1 |
| https://app.stayhustler.com/* | 200 | - (with X-Robots-Tag: noindex, nofollow) |

### Automated verification script

Save as `scripts/verify-seo.sh`:

```bash
#!/bin/bash
# SEO Canonical Verification Script

set -e

echo "=== SEO Canonical Verification ==="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; exit 1; }

# Test 1: www redirect
echo "Test 1: http://www.stayhustler.com → https://stayhustler.com"
LOCATION=$(curl -sI http://www.stayhustler.com/ | grep -i "^location:" | tr -d '\r')
if [[ "$LOCATION" == *"https://stayhustler.com/"* ]]; then
    pass "www redirects to non-www"
else
    fail "www redirect not working. Got: $LOCATION"
fi

# Test 2: https www redirect
echo "Test 2: https://www.stayhustler.com → https://stayhustler.com"
LOCATION=$(curl -sI https://www.stayhustler.com/ | grep -i "^location:" | tr -d '\r')
if [[ "$LOCATION" == *"https://stayhustler.com/"* ]]; then
    pass "https www redirects to non-www"
else
    fail "https www redirect not working. Got: $LOCATION"
fi

# Test 3: http to https
echo "Test 3: http://stayhustler.com → https://stayhustler.com"
LOCATION=$(curl -sI http://stayhustler.com/ | grep -i "^location:" | tr -d '\r')
if [[ "$LOCATION" == *"https://stayhustler.com/"* ]]; then
    pass "http redirects to https"
else
    fail "http redirect not working. Got: $LOCATION"
fi

# Test 4: Final destination returns 200
echo "Test 4: https://stayhustler.com returns 200"
STATUS=$(curl -sI https://stayhustler.com/ | head -1 | grep -o "200")
if [[ "$STATUS" == "200" ]]; then
    pass "Canonical URL returns 200"
else
    fail "Canonical URL did not return 200"
fi

# Test 5: Path preservation
echo "Test 5: Path + query string preserved in redirect"
LOCATION=$(curl -sI "http://www.stayhustler.com/booking.html?test=1" | grep -i "^location:" | tr -d '\r')
if [[ "$LOCATION" == *"booking.html?test=1"* ]]; then
    pass "Path and query string preserved"
else
    fail "Path/query not preserved. Got: $LOCATION"
fi

# Test 6: App subdomain robots.txt
echo "Test 6: App subdomain robots.txt blocks crawling"
ROBOTS=$(curl -s https://app.stayhustler.com/robots.txt)
if [[ "$ROBOTS" == *"Disallow: /"* ]]; then
    pass "App robots.txt blocks all crawling"
else
    fail "App robots.txt not blocking. Got: $ROBOTS"
fi

# Test 7: App subdomain X-Robots-Tag
echo "Test 7: App subdomain returns X-Robots-Tag header"
HEADER=$(curl -sI https://app.stayhustler.com/health | grep -i "x-robots-tag" | tr -d '\r')
if [[ "$HEADER" == *"noindex"* ]]; then
    pass "App returns X-Robots-Tag: noindex"
else
    fail "App missing X-Robots-Tag. Got: $HEADER"
fi

echo ""
echo "=== All tests passed ==="
```

Run with:
```bash
chmod +x scripts/verify-seo.sh
./scripts/verify-seo.sh
```

---

## Deployment Checklist

### Hostinger (Marketing Site)
- [ ] Upload `.htaccess` to root directory
- [ ] Verify redirects work (run curl tests)
- [ ] Check no redirect loops in browser

### Railway (App Subdomain)
- [ ] Deploy updated `api/server.js`
- [ ] Verify `curl https://app.stayhustler.com/robots.txt` returns Disallow
- [ ] Verify `curl -I https://app.stayhustler.com/health` includes X-Robots-Tag

### Google Search Console
- [ ] Submit sitemap: https://stayhustler.com/sitemap.xml
- [ ] Request indexing for key pages
- [ ] Monitor for crawl errors
- [ ] Verify canonical URLs are being respected

---

## Troubleshooting

### Redirect loops
If you see ERR_TOO_MANY_REDIRECTS:
1. Clear browser cache
2. Check .htaccess rules order (www before http)
3. Verify no conflicting redirects in Hostinger panel

### Canonical not being respected
1. Check page source for correct `<link rel="canonical">`
2. Use Google URL Inspection tool
3. Ensure no JavaScript is modifying the canonical tag

### App pages appearing in search
1. Verify X-Robots-Tag header is present
2. Check robots.txt is accessible
3. Request removal via Google Search Console if already indexed

---

## Files Changed

| File | Change |
|------|--------|
| `.htaccess` | NEW - Redirect rules for www→non-www, http→https |
| `api/server.js` | Added global X-Robots-Tag middleware and /robots.txt endpoint |
| `SEO_CANONICAL_ENFORCEMENT.md` | NEW - This documentation |

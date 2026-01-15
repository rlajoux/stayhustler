#!/bin/bash
# SEO Canonical Verification Script
# Usage: ./scripts/verify-seo.sh

set -e

echo "=== SEO Canonical Verification ==="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; exit 1; }
warn() { echo -e "${YELLOW}⚠ WARN${NC}: $1"; }

# Test 1: www redirect (http)
echo "Test 1: http://www.stayhustler.com → https://stayhustler.com"
RESPONSE=$(curl -sI -o /dev/null -w "%{http_code}|%{redirect_url}" http://www.stayhustler.com/ 2>/dev/null || echo "error|")
STATUS=$(echo "$RESPONSE" | cut -d'|' -f1)
LOCATION=$(echo "$RESPONSE" | cut -d'|' -f2)
if [[ "$STATUS" == "301" ]] && [[ "$LOCATION" == "https://stayhustler.com/"* ]]; then
    pass "http://www.* → https://stayhustler.com (301)"
else
    warn "Got status=$STATUS, location=$LOCATION (may need .htaccess deployed)"
fi

# Test 2: www redirect (https)
echo "Test 2: https://www.stayhustler.com → https://stayhustler.com"
RESPONSE=$(curl -sI -o /dev/null -w "%{http_code}|%{redirect_url}" https://www.stayhustler.com/ 2>/dev/null || echo "error|")
STATUS=$(echo "$RESPONSE" | cut -d'|' -f1)
LOCATION=$(echo "$RESPONSE" | cut -d'|' -f2)
if [[ "$STATUS" == "301" ]] && [[ "$LOCATION" == "https://stayhustler.com/"* ]]; then
    pass "https://www.* → https://stayhustler.com (301)"
else
    warn "Got status=$STATUS, location=$LOCATION (may need .htaccess deployed)"
fi

# Test 3: http to https (non-www)
echo "Test 3: http://stayhustler.com → https://stayhustler.com"
RESPONSE=$(curl -sI -o /dev/null -w "%{http_code}|%{redirect_url}" http://stayhustler.com/ 2>/dev/null || echo "error|")
STATUS=$(echo "$RESPONSE" | cut -d'|' -f1)
LOCATION=$(echo "$RESPONSE" | cut -d'|' -f2)
if [[ "$STATUS" == "301" ]] && [[ "$LOCATION" == "https://stayhustler.com/"* ]]; then
    pass "http://stayhustler.com → https://stayhustler.com (301)"
else
    warn "Got status=$STATUS, location=$LOCATION (may need .htaccess deployed)"
fi

# Test 4: Canonical URL returns 200
echo "Test 4: https://stayhustler.com returns 200"
STATUS=$(curl -sI -o /dev/null -w "%{http_code}" https://stayhustler.com/ 2>/dev/null || echo "error")
if [[ "$STATUS" == "200" ]]; then
    pass "Canonical URL returns 200 OK"
else
    fail "Canonical URL returned $STATUS (expected 200)"
fi

# Test 5: Path + query preservation
echo "Test 5: Path and query string preserved in redirect"
RESPONSE=$(curl -sI -o /dev/null -w "%{redirect_url}" "http://www.stayhustler.com/booking.html?test=1" 2>/dev/null || echo "")
if [[ "$RESPONSE" == *"booking.html"* ]] && [[ "$RESPONSE" == *"test=1"* ]]; then
    pass "Path and query string preserved"
else
    warn "Path/query may not be preserved. Got: $RESPONSE"
fi

# Test 6: App subdomain robots.txt
echo "Test 6: App subdomain robots.txt blocks crawling"
ROBOTS=$(curl -s https://app.stayhustler.com/robots.txt 2>/dev/null || echo "error")
if [[ "$ROBOTS" == *"Disallow: /"* ]]; then
    pass "App robots.txt blocks all crawling"
else
    fail "App robots.txt missing or not blocking. Got: $ROBOTS"
fi

# Test 7: App subdomain X-Robots-Tag header
echo "Test 7: App subdomain returns X-Robots-Tag header"
HEADER=$(curl -sI https://app.stayhustler.com/health 2>/dev/null | grep -i "x-robots-tag" | tr -d '\r\n' || echo "")
if [[ "$HEADER" == *"noindex"* ]]; then
    pass "App returns X-Robots-Tag: noindex, nofollow"
else
    fail "App missing X-Robots-Tag header. Got: '$HEADER'"
fi

# Test 8: Canonical tag on index page
echo "Test 8: Canonical tag present on index.html"
CANONICAL=$(curl -s https://stayhustler.com/ 2>/dev/null | grep -o '<link rel="canonical"[^>]*>' || echo "")
if [[ "$CANONICAL" == *'href="https://stayhustler.com/"'* ]]; then
    pass "Index has correct canonical tag"
else
    warn "Canonical tag issue. Got: $CANONICAL"
fi

# Test 9: No redirect chains (single hop)
echo "Test 9: No redirect chains (single hop from www)"
HOPS=$(curl -sI -L -o /dev/null -w "%{num_redirects}" https://www.stayhustler.com/ 2>/dev/null || echo "error")
if [[ "$HOPS" == "1" ]]; then
    pass "Single redirect hop (no chains)"
elif [[ "$HOPS" == "0" ]]; then
    warn "No redirects detected (may need .htaccess deployed)"
else
    fail "Multiple redirect hops detected: $HOPS"
fi

echo ""
echo "=== Verification Complete ==="

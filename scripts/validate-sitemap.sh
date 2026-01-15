#!/bin/bash
# Sitemap URL Validation Script
# Ensures all URLs in sitemap.xml return HTTP 200
# Usage: ./scripts/validate-sitemap.sh [sitemap_url]

set -e

SITEMAP_URL="${1:-https://stayhustler.com/sitemap.xml}"

echo "=== Sitemap URL Validation ==="
echo "Sitemap: $SITEMAP_URL"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Fetch sitemap and extract URLs
echo "Fetching sitemap..."
URLS=$(curl -s "$SITEMAP_URL" | grep -oP '(?<=<loc>)[^<]+' || echo "")

if [ -z "$URLS" ]; then
    echo -e "${RED}ERROR: Could not fetch or parse sitemap${NC}"
    exit 1
fi

URL_COUNT=$(echo "$URLS" | wc -l | tr -d ' ')
echo "Found $URL_COUNT URLs in sitemap"
echo ""

FAILED=0
PASSED=0

# Check each URL
while IFS= read -r url; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")

    if [ "$STATUS" = "200" ]; then
        echo -e "${GREEN}[200]${NC} $url"
        ((PASSED++))
    elif [ "$STATUS" = "301" ] || [ "$STATUS" = "302" ]; then
        echo -e "${YELLOW}[$STATUS]${NC} $url (redirect)"
        ((PASSED++))
    else
        echo -e "${RED}[$STATUS]${NC} $url"
        ((FAILED++))
    fi
done <<< "$URLS"

echo ""
echo "=== Results ==="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ "$FAILED" -gt 0 ]; then
    echo -e "${RED}FAILED: $FAILED URLs did not return 200${NC}"
    exit 1
else
    echo -e "${GREEN}SUCCESS: All sitemap URLs return 200${NC}"
    exit 0
fi

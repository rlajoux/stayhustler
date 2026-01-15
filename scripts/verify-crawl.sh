#!/bin/bash
# Crawl Verification Script
# Verifies that all guide pages are reachable from homepage within 3 clicks
# Usage: ./scripts/verify-crawl.sh [base_url]

set -e

BASE_URL="${1:-https://stayhustler.com}"

echo "=== Crawl Verification ==="
echo "Starting from: $BASE_URL"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Expected guide URLs (all should be reachable)
EXPECTED_GUIDES=(
    "/guides/"
    "/guides/how-to-ask-for-a-hotel-upgrade.html"
    "/guides/best-time-to-ask-for-hotel-upgrade.html"
    "/guides/hotel-upgrade-email-template.html"
    "/guides/independent-vs-chain-hotel-upgrades.html"
    "/guides/late-checkout-vs-room-upgrade.html"
)

# Track discovered URLs
declare -A DISCOVERED
declare -A DEPTH

# Function to extract internal links from a page
extract_links() {
    local url="$1"
    curl -sf "$url" 2>/dev/null | \
        grep -oE 'href="[^"]*"' | \
        sed 's/href="//g; s/"//g' | \
        grep -E '^/|^https?://stayhustler\.com' | \
        sed "s|^/|$BASE_URL/|g" | \
        sed 's|//|/|g; s|https:/|https://|g; s|http:/|http://|g' | \
        sort -u
}

# Function to normalize URL
normalize_url() {
    echo "$1" | sed 's|/$||; s|/index\.html$||'
}

echo "Step 1: Crawling homepage (depth 0)..."
HOMEPAGE_LINKS=$(extract_links "$BASE_URL/")
DISCOVERED["$BASE_URL"]=1
DEPTH["$BASE_URL"]=0

echo "Found $(echo "$HOMEPAGE_LINKS" | wc -l | tr -d ' ') links on homepage"

echo ""
echo "Step 2: Crawling depth 1 pages..."
DEPTH1_URLS=""
while IFS= read -r link; do
    if [[ -n "$link" && -z "${DISCOVERED[$link]}" ]]; then
        # Only crawl guide-related and internal pages
        if [[ "$link" == *"/guides"* || "$link" == "$BASE_URL" || "$link" == "$BASE_URL/" ]]; then
            DISCOVERED["$link"]=1
            DEPTH["$link"]=1
            DEPTH1_URLS="$DEPTH1_URLS$link"$'\n'
        fi
    fi
done <<< "$HOMEPAGE_LINKS"

echo ""
echo "Step 3: Crawling depth 2 pages (from guides hub)..."
while IFS= read -r url; do
    if [[ -n "$url" ]]; then
        PAGE_LINKS=$(extract_links "$url" 2>/dev/null || echo "")
        while IFS= read -r link; do
            if [[ -n "$link" && -z "${DISCOVERED[$link]}" ]]; then
                if [[ "$link" == *"/guides"* ]]; then
                    DISCOVERED["$link"]=1
                    DEPTH["$link"]=2
                fi
            fi
        done <<< "$PAGE_LINKS"
    fi
done <<< "$DEPTH1_URLS"

echo ""
echo "=== Results ==="
echo ""

ORPHANS=0
for guide in "${EXPECTED_GUIDES[@]}"; do
    FULL_URL="$BASE_URL$guide"
    FULL_URL_NORMALIZED=$(normalize_url "$FULL_URL")

    FOUND=0
    for discovered_url in "${!DISCOVERED[@]}"; do
        if [[ "$(normalize_url "$discovered_url")" == "$FULL_URL_NORMALIZED" ]]; then
            FOUND=1
            GUIDE_DEPTH="${DEPTH[$discovered_url]}"
            break
        fi
    done

    if [[ "$FOUND" -eq 1 ]]; then
        echo -e "${GREEN}[OK]${NC} $guide (depth: $GUIDE_DEPTH)"
    else
        echo -e "${RED}[ORPHAN]${NC} $guide - NOT reachable from homepage!"
        ((ORPHANS++))
    fi
done

echo ""
echo "=== Summary ==="
echo "Total expected pages: ${#EXPECTED_GUIDES[@]}"
echo "Orphan pages: $ORPHANS"
echo ""

if [[ "$ORPHANS" -gt 0 ]]; then
    echo -e "${RED}FAILED: $ORPHANS orphan pages found${NC}"
    exit 1
else
    echo -e "${GREEN}SUCCESS: All guides reachable within 3 clicks${NC}"
    exit 0
fi

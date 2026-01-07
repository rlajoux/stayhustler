#!/bin/bash

# SEO Verification Script for StayHustler
# Verifies all SEO best practices have been implemented correctly

echo "========================================="
echo "StayHustler SEO Verification"
echo "========================================="
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS_COUNT=0
FAIL_COUNT=0

# Test function
test_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $2"
        ((PASS_COUNT++))
    else
        echo -e "${RED}✗${NC} $2"
        ((FAIL_COUNT++))
    fi
}

echo "1. Checking robots.txt exists..."
if [ -f "robots.txt" ]; then
    test_result 0 "robots.txt exists"
else
    test_result 1 "robots.txt missing"
fi

echo ""
echo "2. Checking sitemap.xml exists..."
if [ -f "sitemap.xml" ]; then
    test_result 0 "sitemap.xml exists"
else
    test_result 1 "sitemap.xml missing"
fi

echo ""
echo "3. Checking canonical URLs in HTML files..."
FILES=(
    "index.html"
    "qualify.html"
    "booking.html"
    "context.html"
    "preview.html"
    "payment.html"
    "results.html"
    "save.html"
    "feedback.html"
    "reengage.html"
    "stripe-success.html"
    "stripe-cancel.html"
)

for file in "${FILES[@]}"; do
    if grep -q 'rel="canonical"' "$file" 2>/dev/null; then
        test_result 0 "$file has canonical URL"
    else
        test_result 1 "$file missing canonical URL"
    fi
done

echo ""
echo "4. Checking noindex meta tags on private pages..."
NOINDEX_PAGES=(
    "booking.html"
    "context.html"
    "preview.html"
    "payment.html"
    "results.html"
    "save.html"
    "feedback.html"
    "reengage.html"
    "stripe-success.html"
    "stripe-cancel.html"
)

for file in "${NOINDEX_PAGES[@]}"; do
    if grep -q 'name="robots" content="noindex' "$file" 2>/dev/null; then
        test_result 0 "$file has noindex meta"
    else
        test_result 1 "$file missing noindex meta"
    fi
done

echo ""
echo "5. Verifying indexable pages DO NOT have noindex..."
INDEXABLE_PAGES=("index.html" "qualify.html")

for file in "${INDEXABLE_PAGES[@]}"; do
    if ! grep -q 'name="robots"' "$file" 2>/dev/null; then
        test_result 0 "$file is indexable (no robots meta)"
    else
        test_result 1 "$file has robots meta (should be indexable)"
    fi
done

echo ""
echo "6. Checking h1 tags (should be exactly 1 per page)..."
for file in "${FILES[@]}"; do
    h1_count=$(grep -c '<h1' "$file" 2>/dev/null || echo "0")
    if [ "$h1_count" -eq 1 ]; then
        test_result 0 "$file has exactly 1 h1 tag"
    else
        test_result 1 "$file has $h1_count h1 tags (should be 1)"
    fi
done

echo ""
echo "7. Checking meta descriptions..."
for file in "${FILES[@]}"; do
    if grep -q 'name="description"' "$file" 2>/dev/null; then
        test_result 0 "$file has meta description"
    else
        test_result 1 "$file missing meta description"
    fi
done

echo ""
echo "8. Checking Open Graph tags..."
for file in "${FILES[@]}"; do
    if grep -q 'property="og:title"' "$file" 2>/dev/null; then
        test_result 0 "$file has Open Graph tags"
    else
        test_result 1 "$file missing Open Graph tags"
    fi
done

echo ""
echo "9. Checking robots.txt content..."
if grep -q "User-agent: \*" robots.txt 2>/dev/null && \
   grep -q "Allow: /" robots.txt 2>/dev/null && \
   grep -q "Sitemap:" robots.txt 2>/dev/null; then
    test_result 0 "robots.txt has proper directives"
else
    test_result 1 "robots.txt missing required directives"
fi

echo ""
echo "10. Checking sitemap.xml content..."
if grep -q "https://stayhustler.com/" sitemap.xml 2>/dev/null && \
   grep -q "https://stayhustler.com/qualify.html" sitemap.xml 2>/dev/null; then
    test_result 0 "sitemap.xml includes indexable pages"
else
    test_result 1 "sitemap.xml missing indexable pages"
fi

echo ""
echo "========================================="
echo "Verification Summary"
echo "========================================="
echo -e "${GREEN}Passed: $PASS_COUNT${NC}"
echo -e "${RED}Failed: $FAIL_COUNT${NC}"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}✓ All SEO checks passed!${NC}"
    echo "Ready for deployment to Hostinger."
    exit 0
else
    echo -e "${RED}✗ Some SEO checks failed.${NC}"
    echo "Please review the failures above."
    exit 1
fi

#!/bin/bash
set -eu
# Follow at most five redirects; a redirect alone is not a passing result.
SITEMAP_URL="${1:-https://stayhustler.com/sitemap.xml}"
TASK_SITEMAP=$(mktemp)
trap 'rm -f "$TASK_SITEMAP"' EXIT
curl -fLsS --connect-timeout 5 --max-time 20 --max-redirs 5 -A 'StayHustler deployment validation' "$SITEMAP_URL" > "$TASK_SITEMAP"
URLS=$(python3 -c 'import sys,xml.etree.ElementTree as E; print("\n".join(e.text for e in E.parse(sys.argv[1]).iter() if e.tag.endswith("}loc") or e.tag=="loc"))' "$TASK_SITEMAP")
[ -n "$URLS" ] || { echo 'Sitemap contains no URLs'; exit 1; }
FAILED=0
while IFS= read -r url; do
    if STATUS=$(curl -LsS --connect-timeout 5 --max-time 20 --max-redirs 5 -A 'StayHustler deployment validation' -o /dev/null -w '%{http_code}' "$url") && [ "$STATUS" = 200 ]; then
        echo "[200] $url"
    else
        echo "[FAIL] $url ($STATUS)"
        FAILED=$((FAILED + 1))
    fi
done <<< "$URLS"
[ "$FAILED" -eq 0 ]

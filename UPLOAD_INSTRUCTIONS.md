# URGENT: Upload Updated Files to Hostinger

## Problem
You're seeing "Couldn't generate a custom request—showing a default template" because **Hostinger still has the OLD version of results.html**.

The fixes were pushed to Railway (backend is updated), but the frontend HTML file on Hostinger was NOT updated.

## Solution: Upload These Files to Hostinger

### Files to Upload (in order of priority):

1. **results.html** (CRITICAL - contains all the fixes)
   - Location: `/Users/raph/stayhustler/results.html`
   - Upload to: Hostinger root directory (overwrite existing)
   - This file contains:
     - Detection of X-Generation-Source header
     - Only shows fallback notice when source === 'fallback'
     - Enhanced error handling for 429 rate limits
     - Field validation before API call

2. **diagnostic.html** (OPTIONAL - for troubleshooting)
   - Location: `/Users/raph/stayhustler/diagnostic.html`
   - Upload to: Hostinger root directory
   - Visit: https://stayhustler.com/diagnostic.html
   - Use this to:
     - Check localStorage contents
     - Validate required fields
     - Test API connection
     - See if X-Generation-Source header is working

## How to Verify the Fix

### Before Upload:
Visit https://stayhustler.com/results.html and open browser console (F12).
Look for these logs:
```
[Frontend] Starting generation request
[Frontend] API response: {status: 200, generation_source: null, ...}
```
Note: `generation_source: null` means OLD version is still loaded

### After Upload:
1. Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)
2. Open browser console (F12)
3. Complete the payment flow
4. Check console logs - you should see:
```
[Frontend] Starting generation request
[Frontend] Payload check: {has_booking: true, has_hotel: true, ...}
[Frontend] Calling API...
[Frontend] API response: {status: 200, ok: true, request_id: 'a7f3k2m', generation_source: 'first'}
[Frontend] Custom content generated successfully
```

5. The page should show custom content WITHOUT the "Couldn't generate..." notice

## Quick Test with Diagnostic Page

After uploading both files:

1. Visit: https://stayhustler.com/diagnostic.html
2. Check "localStorage Contents" section
   - Should show your booking and context data
3. Check "Field Validation" section
   - All required fields should be green (OK)
4. Click "Test Generate Request API"
   - Should return: `{"status": 200, "generation_source": "first" or "second" or "repaired", ...}`
   - If you see `"generation_source": "fallback"`, check Railway logs to see why

## Troubleshooting

### If you still see the notice after upload:

1. **Hard refresh** the page (clear cache)
2. Check browser console for logs starting with `[Frontend]`
3. Visit diagnostic.html and run API test
4. Check Railway logs for the request_id shown in console
5. Look for validation failures or Gemini errors

### If localStorage is empty:

- Go back through the flow: booking.html → context.html → preview.html → payment.html → results.html
- Each page should populate localStorage
- Use diagnostic.html to verify data at each step

## Expected Behavior After Fix

| Scenario | What You Should See |
|----------|-------------------|
| Normal flow after payment | Custom email content, NO fallback notice |
| Backend uses fallback | Custom email content + "Couldn't generate..." notice |
| Rate limited (429) | "Temporarily rate-limited" message with Retry button |
| Missing fields | "Missing trip details: hotel, city..." with link back |
| Backend error (500) | Default template + generic error message |

## Files Modified Summary

- **Backend (Railway)**: Already deployed ✅
  - Added X-Generation-Source header
  - Added repair function
  - Added correlation IDs
  
- **Frontend (Hostinger)**: NEEDS UPLOAD ❌
  - results.html - Enhanced error handling
  - diagnostic.html - New troubleshooting tool

---

**Next Step**: Upload `results.html` to Hostinger immediately, then test with the full payment flow.

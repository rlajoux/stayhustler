# Troubleshooting: "Couldn't generate" Message & Email Not Sending

## Problem Summary

You're experiencing two issues:
1. **"Couldn't generate a custom request—showing a default template"** message appearing on results page
2. **Emails are not being delivered** to user's email address

## Root Causes

### Issue 1: "Couldn't generate" Message
This message appears when the backend's `X-Generation-Source` header is set to `fallback`, which happens when:
- Gemini API key is missing or invalid
- Gemini API call fails (rate limit, network error, invalid response)
- Generated content fails validation twice

**Located in:** `results.html` line 982-988

### Issue 2: Email Not Sending
Email delivery fails when:
- `SENDGRID_API_KEY` is missing or invalid
- `SENDGRID_FROM_EMAIL` is not configured
- `DATABASE_URL` is missing (required to log deliveries)

**Located in:** `api/server.js` lines 1304-1313

---

## Step-by-Step Fix

### Step 1: Check Railway Environment Variables

Go to your Railway dashboard → `stayhustler-production` project → Variables tab

**Verify these variables are set:**

```bash
# Required for AI generation
GEMINI_API_KEY=<your_google_ai_studio_key>

# Required for email delivery
SENDGRID_API_KEY=<your_sendgrid_api_key>
SENDGRID_FROM_EMAIL=noreply@stayhustler.com

# Required for database logging
DATABASE_URL=<postgresql_connection_string>

# Security
UNSUBSCRIBE_SECRET=<random_secret>

# Environment
NODE_ENV=production
```

### Step 2: Verify Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create or copy your API key
3. Test it with this curl command:

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=YOUR_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"parts":[{"text":"Say hello"}]}]}'
```

**Expected response:** JSON with generated text
**If error:** Key is invalid or expired

### Step 3: Verify SendGrid API Key

1. Go to [SendGrid Settings → API Keys](https://app.sendgrid.com/settings/api_keys)
2. Ensure your API key has "Mail Send" permissions
3. Verify sender email at [Sender Authentication](https://app.sendgrid.com/settings/sender_auth)

**Important:** SendGrid requires you to verify `noreply@stayhustler.com` as a single sender OR verify your domain

### Step 4: Check Railway Deployment Logs

In Railway dashboard → Deployments → Latest Deployment → View Logs

**Look for these error messages:**

```
[DB] DATABASE_URL not set - subscriber features disabled
```
→ Database not configured, emails can't be logged

```
[Delivery] SendGrid not configured
```
→ SendGrid API key or FROM email missing

```
GEMINI_API_KEY not configured
```
→ Gemini key missing

```
Gemini API error: 400
```
→ Invalid Gemini API key or request format

```
Gemini API error: 429
```
→ Rate limited by Google (too many requests)

### Step 5: Test the API Endpoints Directly

**Test generation endpoint:**

```bash
curl -X POST https://stayhustler-production.up.railway.app/api/generate-request \
  -H "Content-Type: application/json" \
  -d '{
    "booking": {
      "hotel": "Test Hotel",
      "city": "New York",
      "checkin": "2026-02-15",
      "checkout": "2026-02-17",
      "room": "Standard King",
      "channel": "direct"
    },
    "context": {
      "lengthOfStay": "short",
      "arrivalDay": "weekday",
      "loyaltyStatus": "none",
      "askPreference": "email",
      "flexibility": "any"
    }
  }'
```

**Check response headers:**
- `X-Generation-Source: first` = SUCCESS (Gemini worked)
- `X-Generation-Source: fallback` = FAILED (using default template)

**Test email delivery:**

```bash
curl -X POST https://stayhustler-production.up.railway.app/api/deliver-request \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-test-email@example.com",
    "booking": {
      "hotel": "Test Hotel",
      "city": "New York",
      "checkin": "2026-02-15",
      "checkout": "2026-02-17",
      "room": "Standard King",
      "channel": "direct"
    },
    "context": {
      "lengthOfStay": "short",
      "arrivalDay": "weekday",
      "loyaltyStatus": "none",
      "askPreference": "email",
      "flexibility": "any"
    },
    "order": {
      "price": 7,
      "currency": "USD",
      "method": "stripe"
    }
  }'
```

**Expected response:** `{"ok": true, "delivery_id": "123"}`
**If error:** Check Railway logs for SendGrid error details

---

## Quick Fixes

### If Gemini is failing:

**Option A: Check API quota**
- Go to [Google Cloud Console](https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas)
- Verify you haven't hit free tier limits (1500 requests/day for free tier)

**Option B: Use fallback temporarily**
- The system will automatically use fallback templates
- Users will see the notice but still get content
- Fix the API key when convenient

### If SendGrid is failing:

**Option A: Verify sender authentication**
```bash
# Check if domain is verified
curl https://api.sendgrid.com/v3/verified_senders \
  -H "Authorization: Bearer YOUR_SENDGRID_API_KEY"
```

**Option B: Use single sender verification (quick fix)**
1. Go to SendGrid → Settings → Sender Authentication
2. Click "Verify Single Sender"
3. Add `noreply@stayhustler.com`
4. Check your domain email for verification link
5. Click to verify

### If Database is missing:

**Railway should auto-provision PostgreSQL:**
1. In Railway dashboard → Add → Database → PostgreSQL
2. Railway will automatically set `DATABASE_URL`
3. Restart your deployment

---

## Monitoring & Prevention

### Check system health:

**View admin dashboard:**
```
https://stayhustler-production.up.railway.app/admin
```
(requires ADMIN_USER and ADMIN_PASS to be set)

**Monitor deliveries:**
- Go to Admin → Deliveries
- Filter by `status = 'failed'` to see errors
- Check error messages for patterns

### Set up alerts:

**Add this to your monitoring (optional):**
```javascript
// In server.js, log errors to a service like Sentry
if (process.env.SENTRY_DSN) {
  const Sentry = require('@sentry/node');
  Sentry.init({ dsn: process.env.SENTRY_DSN });
}
```

---

## Expected Behavior After Fix

### ✅ Successful Flow:

1. User completes booking form → context form → preview page
2. User clicks "Pay $7" → redirected to Stripe
3. User completes payment → redirected to results page
4. **Results page:**
   - Shows loading spinner
   - Calls `/api/generate-request`
   - Receives custom content (X-Generation-Source: first/second/repaired)
   - NO "Couldn't generate" message
   - Content is personalized based on inputs

5. **Email delivery (background):**
   - Payment page calls `/api/deliver-request`
   - Email sent via SendGrid to user's email
   - Logged to database with `status='sent'`
   - User receives email with full content

### 🔍 How to Verify It's Working:

**Test 1: Generation**
1. Go through the flow without paying
2. On results page, open browser console (F12)
3. Look for: `[Frontend] Custom content generated successfully, source: first`
4. Fallback notice should NOT appear

**Test 2: Email Delivery**
1. Complete a real payment ($7)
2. Check email inbox (including spam folder)
3. Should receive email within 30 seconds
4. Email should contain:
   - Email subject for hotel
   - Email body to send
   - Timing guidance (3 tips)
   - Fallback script

**Test 3: Database Logging**
1. Log into Railway → PostgreSQL → Query
2. Run: `SELECT * FROM request_deliveries ORDER BY created_at DESC LIMIT 5;`
3. Should see recent deliveries with `status='sent'`

---

## Still Not Working?

### Check these common issues:

**1. Gemini API quota exceeded:**
- Symptom: Works sometimes, fails other times
- Fix: Upgrade to paid tier or wait for quota reset

**2. SendGrid sender not verified:**
- Symptom: Email API returns 403 Forbidden
- Fix: Complete sender verification in SendGrid dashboard

**3. Database connection issues:**
- Symptom: `[DB] Error initializing tables` in logs
- Fix: Check DATABASE_URL format and network access

**4. CORS issues:**
- Symptom: Browser console shows CORS error
- Fix: Ensure ALLOWED_ORIGIN includes `https://stayhustler.com`

**5. Rate limiting:**
- Symptom: Some requests fail with 429 status
- Fix: This is intentional (3 requests/minute), not a bug

---

## Contact Information

If issues persist after following this guide:

1. **Check Railway logs** for specific error messages
2. **Test API endpoints directly** using curl commands above
3. **Verify all environment variables** are set correctly
4. **Check SendGrid dashboard** for bounced/failed emails
5. **Review Google AI Studio quota** usage

**Most common fix:** Missing or invalid `GEMINI_API_KEY` or `SENDGRID_API_KEY` in Railway environment variables.

---

## Files to Review

If you need to modify the code:

**Generation logic:**
- `api/server.js` lines 848-910 (callGemini function)
- `api/server.js` lines 920-999 (generateRequestPayload function)

**Email delivery:**
- `api/server.js` lines 1301-1422 (deliver-request endpoint)
- `api/server.js` lines 1293-1298 (SendGrid initialization)

**Frontend display:**
- `results.html` lines 982-988 (fallback notice logic)
- `results.html` lines 598-600 (fallback notice HTML)

**Environment setup:**
- `api/.env.example` (template for required variables)

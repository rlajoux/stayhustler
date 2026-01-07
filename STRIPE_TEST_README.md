# Stripe Test Endpoint

## Overview

Added a sandbox test endpoint to create Stripe Checkout Sessions for testing payment integration.

## Endpoint

**POST** `/api/stripe/test`

**Request**: No body required (empty POST)

**Response**:
```json
{
  "ok": true,
  "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_..."
}
```

## Setup

### 1. Add Stripe Secret Key to Railway

Go to Railway → Your Project → Variables:

```
STRIPE_SECRET_KEY=sk_test_...
```

Get your test key from: https://dashboard.stripe.com/test/apikeys

### 2. Optional: Set PUBLIC_BASE_URL

If not set, defaults to `https://stayhustler.com`:

```
PUBLIC_BASE_URL=https://stayhustler.com
```

### 3. Create Success/Cancel Pages (Optional)

Create these pages on Hostinger:
- `stripe-success.html` - Shown after successful payment
- `stripe-cancel.html` - Shown if user cancels

## Testing

### Test 1: cURL (Check Response)

```bash
curl -X POST https://stayhustler-production.up.railway.app/api/stripe/test \
  -H "Content-Type: application/json" \
  | jq .
```

**Expected**:
```json
{
  "ok": true,
  "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4..."
}
```

### Test 2: Browser (Full Flow)

1. Create `stripe-test.html` on Hostinger:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Stripe Test</title>
</head>
<body>
    <h1>Stripe Checkout Test</h1>
    <button id="test-btn">Test Stripe Checkout</button>
    <pre id="result"></pre>

    <script>
        const API_BASE = "https://stayhustler-production.up.railway.app";
        
        document.getElementById('test-btn').addEventListener('click', async () => {
            const result = document.getElementById('result');
            result.textContent = 'Creating checkout session...';
            
            try {
                const response = await fetch(`${API_BASE}/api/stripe/test`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                const data = await response.json();
                
                if (data.ok && data.checkout_url) {
                    result.textContent = 'Redirecting to Stripe...';
                    window.location.href = data.checkout_url;
                } else {
                    result.textContent = `Error: ${JSON.stringify(data, null, 2)}`;
                }
            } catch (error) {
                result.textContent = `Exception: ${error.message}`;
            }
        });
    </script>
</body>
</html>
```

2. Visit `https://stayhustler.com/stripe-test.html`
3. Click "Test Stripe Checkout"
4. Should redirect to Stripe Checkout page
5. Use test card: `4242 4242 4242 4242`, any future expiry, any CVC
6. Complete payment → redirects to `stripe-success.html`

### Test 3: Stripe Dashboard

After completing a test payment:
1. Go to https://dashboard.stripe.com/test/payments
2. You should see the $7.00 payment
3. Check the payment details

## Payment Details

| Field | Value |
|-------|-------|
| Amount | $7.00 USD |
| Product | StayHustler Test Request |
| Mode | payment (one-time) |
| Success URL | {PUBLIC_BASE_URL}/stripe-success.html |
| Cancel URL | {PUBLIC_BASE_URL}/stripe-cancel.html |

## Error Handling

### 500 - Missing STRIPE_SECRET_KEY

```json
{
  "error": "Missing STRIPE_SECRET_KEY",
  "message": "Stripe is not configured on the server"
}
```

**Fix**: Add `STRIPE_SECRET_KEY` environment variable to Railway

### 502 - Stripe API Error

```json
{
  "error": "Stripe test failed",
  "message": "Unable to create checkout session"
}
```

**Possible causes**:
- Invalid Stripe secret key
- Network issue with Stripe API
- Stripe account issue

**Check**: Railway logs for detailed error message

## Stripe Test Cards

| Card Number | Result |
|-------------|--------|
| 4242 4242 4242 4242 | Success |
| 4000 0000 0000 0002 | Card declined |
| 4000 0000 0000 9995 | Insufficient funds |
| 4000 0025 0000 3155 | Requires authentication (3D Secure) |

Full list: https://stripe.com/docs/testing

## Integration with Existing Flow

This endpoint is **separate** from the existing payment simulation flow:

**Current Flow** (no changes):
- `payment.html` → Simulated payment (no actual charge)
- `results.html` → Shows generated content

**New Test Flow**:
- Call `/api/stripe/test` → Get checkout URL
- Redirect to Stripe Checkout
- Complete payment (test mode)
- Redirects back to success/cancel page

## Next Steps (Not Implemented Yet)

To integrate Stripe into the main flow:

1. **Replace payment simulation** in `payment.html`:
   - Call `/api/stripe/test` (or new endpoint `/api/stripe/checkout`)
   - Redirect to Stripe instead of simulating payment
   
2. **Handle webhook** for payment confirmation:
   - Add POST `/api/stripe/webhook` endpoint
   - Verify webhook signature
   - Deliver email on successful payment
   
3. **Update success URL**:
   - Change from `stripe-success.html` to `results.html`
   - Pass session_id or metadata
   
4. **Store payment records**:
   - Add `payments` table to database
   - Link payment to delivery record

## Security Notes

- ✅ Stripe secret key stored in environment variable (not in code)
- ✅ No secret key exposure in error responses
- ✅ Checkout Session creation server-side only
- ✅ Test mode (sk_test_) vs production (sk_live_) keys
- ⚠️ Add webhook signature verification when implementing webhooks
- ⚠️ Validate amounts server-side (don't trust client input)

## Monitoring

Check Railway logs for:
```
[Stripe] Creating test Checkout Session
[Stripe] Checkout Session created: cs_test_...
```

Or errors:
```
[Stripe] STRIPE_SECRET_KEY not configured
[Stripe] Error creating Checkout Session: ...
```

## Resources

- Stripe Checkout Docs: https://stripe.com/docs/checkout
- Test Mode: https://stripe.com/docs/testing
- Webhook Events: https://stripe.com/docs/webhooks
- Dashboard: https://dashboard.stripe.com/test

# Browser Console Test Script

## Run this in browser console on results.html to diagnose the issue

Open browser console (F12) on https://stayhustler.com/results.html and paste this:

```javascript
// Test 1: Check localStorage
console.log('=== TEST 1: localStorage ===');
const booking = JSON.parse(localStorage.getItem('stayhustler_booking') || '{}');
const context = JSON.parse(localStorage.getItem('stayhustler_context') || '{}');
console.log('Booking:', booking);
console.log('Context:', context);
console.log('Has required fields?', {
  hotel: !!booking.hotel,
  city: !!booking.city,
  checkin: !!booking.checkin,
  checkout: !!booking.checkout,
  arrivalDay: !!context.arrivalDay,
  lengthOfStay: !!context.lengthOfStay
});

// Test 2: Test API call
console.log('\n=== TEST 2: API Call ===');
fetch('https://stayhustler-production.up.railway.app/api/generate-request', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ booking, context })
})
.then(response => {
  console.log('Response status:', response.status);
  console.log('Response headers:');
  console.log('  X-Request-Id:', response.headers.get('X-Request-Id'));
  console.log('  X-Generation-Source:', response.headers.get('X-Generation-Source'));
  console.log('  Retry-After:', response.headers.get('Retry-After'));
  return response.json().then(data => ({ response, data }));
})
.then(({ response, data }) => {
  console.log('Response data:', data);
  console.log('\n=== DIAGNOSIS ===');
  const source = response.headers.get('X-Generation-Source');
  if (source === 'fallback') {
    console.error('❌ Backend returned FALLBACK - this is why notice shows');
    console.log('Check Railway logs for validation failures');
  } else if (source === 'first' || source === 'second' || source === 'repaired') {
    console.log('✅ Backend returned CUSTOM content, source:', source);
    console.log('Notice should NOT show. If it does, check:');
    console.log('  1. Is results.html uploaded to Hostinger?');
    console.log('  2. Hard refresh (Ctrl+Shift+R)?');
    console.log('  3. Check Network tab for 304 (cached)');
  } else if (source === 'error') {
    console.error('❌ Backend had an error - check Railway logs');
  } else {
    console.warn('⚠️ No X-Generation-Source header - CORS issue or old backend');
  }
})
.catch(error => {
  console.error('❌ API call failed:', error);
});

// Test 3: Check DOM elements
console.log('\n=== TEST 3: DOM Elements ===');
const elements = {
  'fallback-notice': document.getElementById('fallback-notice'),
  'email-subject': document.getElementById('email-subject'),
  'email-request': document.getElementById('email-request'),
  'loading-indicator': document.getElementById('loading-indicator'),
  'timing-list': document.getElementById('timing-list'),
  'script-block': document.querySelector('.script-block')
};
Object.entries(elements).forEach(([name, el]) => {
  console.log(`${name}:`, el ? '✅ found' : '❌ MISSING');
  if (name === 'fallback-notice' && el) {
    console.log(`  display: ${el.style.display}`);
    console.log(`  textContent: ${el.textContent.substring(0, 50)}...`);
  }
});
```

## Expected Output

### If everything is working:
```
✅ Backend returned CUSTOM content, source: first
Notice should NOT show
```

### If backend is using fallback:
```
❌ Backend returned FALLBACK - this is why notice shows
Check Railway logs for validation failures
```

### If CORS headers missing:
```
⚠️ No X-Generation-Source header - CORS issue or old backend
```

## Next Steps Based on Results

### If source is 'fallback':
1. Check Railway logs: https://railway.app
2. Search for your request_id (shown in console)
3. Look for validation failures like:
   - "email_body must be 160-210 words (got 155)"
   - "email_subject must include a date token"
4. The repair function should fix these, but may not be working

### If source is 'first'/'second'/'repaired' but notice still shows:
1. results.html on Hostinger is OLD - reupload it
2. Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
3. Try incognito mode to bypass cache
4. Check Network tab: If you see "304 Not Modified", it's cached

### If source is null/undefined:
1. Backend not deployed yet (wait 2-3 min after push)
2. CORS headers not exposed (check backend logs)
3. Using wrong API endpoint URL

### If API call fails entirely:
1. Check if booking/context data exists in localStorage
2. Missing required fields: hotel, city, checkin, checkout, arrivalDay, lengthOfStay
3. Go back through flow: booking.html → context.html → payment.html → results.html

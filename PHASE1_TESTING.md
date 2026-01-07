# Phase 1 Upgrade Odds Enhancement - Testing Guide

## Overview

Phase 1 adds 4 high-signal factors to improve upgrade odds accuracy without adding user friction. All factors are optional and backward compatible.

## New Factors

### 1. First-Time Stay (Independent Hotels)
**Weight:** +0.20 for independents  
**Input:** `context.first_time_stay` (boolean)  
**Chip:** "First stay at this property"

### 2. Advance Notice
**Weight:** +0.10 (24-72h advance) or -0.05 (<12h last-minute)  
**Derived from:** `booking.checkin` vs current timestamp  
**Chips:** "Asked with advance notice" / "Very last-minute request"

### 3. Length × Arrival Day Interaction
**Weight:** +0.10 (short+soft) or -0.15 (long+peak)  
**Derived from:** `context.lengthOfStay` + `context.arrivalDay` + city market type  
**Chips:** "Short stay on softer arrival day" / "Long stay during peak demand"

### 4. Booked Room Category
**Weight:** +0.10 (base) or -0.10 (premium)  
**Input:** `booking.room` (string, keywords parsed)  
**Chips:** "Base room booked" / "Already booked a premium room"

## Test Scenarios

### Scenario 1: High Odds (Independent + First-Time + Advance + Base Room)

**Setup localStorage:**
```javascript
localStorage.setItem('stayhustler_booking', JSON.stringify({
  hotel: 'The Independent Boutique',
  hotel_type: 'independent',
  city: 'Austin, TX',
  checkin: '2026-01-15', // 8 days from now
  room: 'Standard King'
}));

localStorage.setItem('stayhustler_context', JSON.stringify({
  lengthOfStay: '2',
  arrivalDay: 'tuesday',
  loyaltyStatus: 'none',
  askPreference: 'both',
  flexibility: 'any',
  first_time_stay: true
}));
```

**Expected Result:**
- Percentage: ~65-75%
- Chips should include:
  - "First stay at this property"
  - "Asked with advance notice"
  - "Base room booked"
  - "Flexible on room type" or "Independent property"

---

### Scenario 2: Lower Odds (Chain + Long Stay + Peak Day + Premium Room)

**Setup localStorage:**
```javascript
localStorage.setItem('stayhustler_booking', JSON.stringify({
  hotel: 'Marriott Downtown',
  hotel_type: 'chain',
  city: 'New York, NY',
  checkin: '2026-01-09', // 2 days from now (last minute)
  room: 'Executive Suite'
}));

localStorage.setItem('stayhustler_context', JSON.stringify({
  lengthOfStay: '5+',
  arrivalDay: 'tuesday', // peak for business city
  loyaltyStatus: 'silver',
  askPreference: 'email',
  flexibility: 'specific',
  first_time_stay: false
}));
```

**Expected Result:**
- Percentage: ~25-35%
- Chips should include:
  - "High-demand city"
  - "Long stay during peak demand"
  - "Already booked a premium room"
  - "Mid-tier loyalty" (may not show if prioritized out)

---

### Scenario 3: Missing Optional Fields (Backward Compatibility)

**Setup localStorage:**
```javascript
localStorage.setItem('stayhustler_booking', JSON.stringify({
  hotel: 'Hilton Garden Inn',
  city: 'Seattle, WA',
  bookingChannel: 'direct'
  // No hotel_type, no checkin, no room
}));

localStorage.setItem('stayhustler_context', JSON.stringify({
  lengthOfStay: '3-4',
  arrivalDay: 'friday',
  loyaltyStatus: 'gold',
  askPreference: 'both',
  flexibility: 'any'
  // No first_time_stay
}));
```

**Expected Result:**
- Percentage: ~55-65%
- Chips should include:
  - "Direct booking"
  - "Top-tier loyalty"
  - "Asking before arrival"
  - "Flexible on room type"
- No errors or crashes
- No Phase 1 chips since inputs missing

---

### Scenario 4: Resort Market + Short Stay + Soft Day

**Setup localStorage:**
```javascript
localStorage.setItem('stayhustler_booking', JSON.stringify({
  hotel: 'The Resort at Cabo',
  hotel_type: 'independent',
  city: 'Cabo San Lucas, Mexico',
  checkin: '2026-01-10', // 3 days from now
  room: 'Garden View Standard'
}));

localStorage.setItem('stayhustler_context', JSON.stringify({
  lengthOfStay: '2',
  arrivalDay: 'monday', // soft day for resort
  loyaltyStatus: 'none',
  askPreference: 'both',
  flexibility: 'any',
  first_time_stay: true
}));
```

**Expected Result:**
- Percentage: ~70-80%
- Chips should include:
  - "Resort / elastic market"
  - "First stay at this property"
  - "Short stay on softer arrival day"
  - "Base room booked"

---

## Browser Console Testing

Open preview.html in browser, then run in console:

```javascript
// Clear existing data
localStorage.clear();

// Set test scenario (use any scenario above)
localStorage.setItem('stayhustler_booking', JSON.stringify({
  hotel: 'Test Hotel',
  hotel_type: 'independent',
  city: 'Austin, TX',
  checkin: '2026-01-15',
  room: 'Standard Room'
}));

localStorage.setItem('stayhustler_context', JSON.stringify({
  lengthOfStay: '2',
  arrivalDay: 'tuesday',
  loyaltyStatus: 'none',
  askPreference: 'both',
  flexibility: 'any',
  first_time_stay: true
}));

// Reload page
location.reload();
```

## Validation Checklist

### Functional Tests
- [ ] First-time stay chip appears for independents only
- [ ] Advance notice chip appears when checkin date is 24-72h away
- [ ] Last-minute chip appears when checkin <12h away
- [ ] Length × day interaction chips appear correctly
- [ ] Room category chips appear based on keywords
- [ ] Max 4 chips displayed
- [ ] Chips prioritized correctly (market > first-time > advance > interaction)

### Edge Cases
- [ ] Missing `first_time_stay` → no error, no chip
- [ ] Missing `checkin` → no advance notice calculation, no error
- [ ] Missing `room` → no room category chip
- [ ] Invalid date format → gracefully skipped
- [ ] Unknown city → no market tier, but other factors still work
- [ ] Missing all Phase 1 inputs → original odds still computed

### UI/UX
- [ ] Percentage stays within 5-85% clamp
- [ ] Disclaimer still shows: "Estimate based on common hotel practices; availability varies."
- [ ] "Less precise" notice shows when core fields missing
- [ ] Driver chips readable on mobile
- [ ] No layout shifts or visual glitches

### Performance
- [ ] Page loads without console errors
- [ ] No infinite loops or freezing
- [ ] localStorage read/write works correctly

## Deployment Verification

After deploying to stayhustler.com:

1. **Visit:** https://stayhustler.com/preview.html
2. **Prerequisite:** Must have booking + context data in localStorage (go through booking flow)
3. **Check console:** No JavaScript errors
4. **Verify:** Percentage displays correctly
5. **Verify:** Driver chips appear below percentage
6. **Test:** Add `first_time_stay: true` via console and reload

## Rollback Plan

If issues arise:

```bash
git revert c6b1533
git push origin main
```

This will restore the previous odds calculation without Phase 1 factors.

## Success Criteria

✅ All 4 Phase 1 factors implemented  
✅ Backward compatible (no required fields)  
✅ No errors with missing data  
✅ Chips prioritized and limited to 4  
✅ Percentage stays within clamp  
✅ Original disclaimer maintained  
✅ No backend changes needed  
✅ No new form fields added  

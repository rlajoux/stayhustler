# Baseline vs Optimized Odds Testing Guide

## Overview

The preview page now displays TWO probabilities instead of one:
1. **Baseline odds** - Based on structural factors only (market, booking, loyalty)
2. **Optimized odds** - Baseline + execution factors (ask method, flexibility, timing)
3. **Lift** - The estimated improvement from using a well-crafted request

## Scoring Breakdown

### Baseline Score (Structural Factors)

**Cannot be changed by guest execution:**
- Booking channel (direct/OTA/corporate)
- Loyalty tier (none/member/silver/gold)
- Length of stay (1 night / 2-4 nights / 5+ nights)
- Arrival day (weekday vs weekend)
- Market tier (compressed/neutral/resort)
- Hotel type (chain/independent)
- Booked room category (base/mid/premium)
- Length × arrival day interaction

**Example:** OTA booking + Saturday arrival + New York = structurally difficult

---

### Optimized Score (Baseline + Execution)

**Can be improved by guest execution:**
- Ask preference (email only / both email+in-person)
- Flexibility (any / category / view / timing / none)
- Occasion (anniversary, honeymoon, birthday)
- First-time stay (at independent properties)
- Advance notice (24-72 hours optimal)
- Mitigation credit (well-phrased request for difficult scenarios)

**Example:** Same OTA + Saturday + NYC, BUT with both+flexible+advance notice = lift applied

---

## Test Scenarios

### Scenario 1: Low Baseline, Modest Lift

**Input (Structural disadvantages):**
```json
{
  "booking": {
    "hotel": "Hilton Midtown",
    "city": "New York, NY",
    "hotel_type": "chain",
    "channel": "ota",
    "room": "Standard King",
    "checkin": "2026-01-17" // 10 days out
  },
  "context": {
    "lengthOfStay": "2",
    "arrivalDay": "saturday",
    "loyaltyStatus": "none",
    "askPreference": "both",
    "flexibility_primary": "any"
  }
}
```

**Expected:**
- Baseline: ~20-30% (OTA penalty, weekend, compressed market)
- Optimized: ~35-45% (lift from both+flexible)
- Lift: ~10-15 points
- Message: Emphasizes friction reduction

---

### Scenario 2: Moderate Baseline, Good Lift

**Input (Balanced with execution factors):**
```json
{
  "booking": {
    "hotel": "Marriott Downtown",
    "city": "Austin, TX",
    "hotel_type": "chain",
    "channel": "direct",
    "room": "Standard Room",
    "checkin": "2026-01-20" // 13 days out
  },
  "context": {
    "lengthOfStay": "3-4",
    "arrivalDay": "tuesday",
    "loyaltyStatus": "gold",
    "askPreference": "both",
    "flexibility_primary": "any",
    "occasion": "anniversary"
  }
}
```

**Expected:**
- Baseline: ~55-60% (direct, gold, neutral market, weekday)
- Optimized: ~70-75% (lift from both+flexible+occasion)
- Lift: ~15 points
- Message: "Strong setup"

---

### Scenario 3: High Baseline, Small Lift

**Input (Already strong, limited execution upside):**
```json
{
  "booking": {
    "hotel": "The Independent Boutique",
    "city": "Portland, OR",
    "hotel_type": "independent",
    "channel": "direct",
    "room": "Standard Queen",
    "checkin": "2026-01-15" // 8 days out
  },
  "context": {
    "lengthOfStay": "2",
    "arrivalDay": "wednesday",
    "loyaltyStatus": "silver",
    "askPreference": "email", // Not "both"
    "flexibility_primary": "category", // Not "any"
    "first_time_stay": true
  }
}
```

**Expected:**
- Baseline: ~60-65% (direct, independent, silver, weekday)
- Optimized: ~70-75% (lift from first-time+flexibility+timing)
- Lift: ~8-10 points (moderate since not maximal execution)
- Note: Lift capped by already-high baseline

---

### Scenario 4: Minimal Execution (No Lift)

**Input (No execution factors provided):**
```json
{
  "booking": {
    "hotel": "Holiday Inn",
    "city": "Dallas, TX",
    "hotel_type": "chain",
    "channel": "corporate",
    "room": "Standard King",
    "checkin": "2026-01-22"
  },
  "context": {
    "lengthOfStay": "1",
    "arrivalDay": "thursday",
    "loyaltyStatus": "member"
    // No askPreference, no flexibility_primary
  }
}
```

**Expected:**
- Baseline: ~40-45% (corporate rate, member, 1-night)
- Optimized: ~40-45% (same as baseline - no execution factors)
- Lift: 0 points
- Message: "No lift (limited execution factors)"

---

### Scenario 5: Max Lift Cap Test

**Input (Everything favorable for execution):**
```json
{
  "booking": {
    "hotel": "The Resort at Cabo",
    "city": "Cabo San Lucas",
    "hotel_type": "independent",
    "channel": "direct",
    "room": "Garden View",
    "checkin": "2026-01-18" // 11 days out (advance notice window)
  },
  "context": {
    "lengthOfStay": "3-4",
    "arrivalDay": "monday", // Soft day for resort
    "loyaltyStatus": "gold",
    "askPreference": "both",
    "flexibility_primary": "any",
    "occasion": "honeymoon",
    "first_time_stay": true
  }
}
```

**Expected:**
- Baseline: ~60-65% (already strong structural factors)
- Optimized: ~80-85% (capped at 85%)
- Lift: 20 points (CAPPED - would be higher without cap)
- Message: "Strong setup"
- Note: Demonstrates conservative lift cap working

---

## UI Validation

### Visual Check
- [ ] Baseline percentage displayed in muted color
- [ ] Baseline sublabel: "Based on market and booking factors"
- [ ] Optimized percentage displayed in accent color (larger)
- [ ] Optimized label: "With a hotel-ready request"
- [ ] Lift display shows "+X points" or "No lift"
- [ ] Lift disclaimer visible: "Availability drives outcomes..."

### Content Check
- [ ] Customization note adapts based on optimized odds (<35%, 35-55%, >55%)
- [ ] Drivers section labeled "Optimized factors"
- [ ] Drivers chips show execution + structural factors
- [ ] Max 4 chips displayed
- [ ] No crashes with missing data

### Edge Cases
- [ ] Negative lift forced to zero (optimized = baseline)
- [ ] Lift capped at 20 points max
- [ ] Both percentages clamped 5-85%
- [ ] Missing execution data → lift = 0, no error
- [ ] Missing baseline data → hasMissingFields notice

---

## Browser Console Testing

Open `preview.html` in browser, then run:

```javascript
// Clear and set test data
localStorage.clear();

// Test Scenario 1: OTA + Weekend (Low baseline, modest lift)
localStorage.setItem('stayhustler_booking', JSON.stringify({
  hotel: 'Hilton Midtown',
  city: 'New York, NY',
  hotel_type: 'chain',
  channel: 'ota',
  room: 'Standard King',
  checkin: '2026-01-17'
}));

localStorage.setItem('stayhustler_context', JSON.stringify({
  lengthOfStay: '2',
  arrivalDay: 'saturday',
  loyaltyStatus: 'none',
  askPreference: 'both',
  flexibility_primary: 'any'
}));

location.reload();

// Expected: Baseline ~25%, Optimized ~35-40%, Lift ~10-15 points
```

---

## Expected Lift Ranges

### By Structural Difficulty

| Structural Setup | Typical Baseline | Typical Lift | Optimized Range |
|------------------|------------------|--------------|-----------------|
| Very Difficult (OTA+peak+compressed) | 15-25% | 8-12 pts | 25-35% |
| Difficult (OTA+weekday or chain+peak) | 25-35% | 10-15 pts | 35-50% |
| Moderate (Direct+neutral or corp+member) | 40-50% | 12-18 pts | 55-65% |
| Favorable (Direct+independent+soft day) | 55-65% | 10-15 pts | 65-75% |
| Very Favorable (Direct+gold+independent) | 65-75% | 5-10 pts | 70-80% |

### By Execution Quality

| Execution Factors | Typical Lift Contribution |
|-------------------|---------------------------|
| askPreference: both | +20 score (~+5-8 pts) |
| flexibility_primary: any | +25 score (~+6-10 pts) |
| Advance notice (24-72h) | +10 score (~+3-5 pts) |
| First-time stay (independent) | +20 score (~+5-8 pts) |
| Special occasion | +10-20 score (~+3-8 pts) |
| Mitigation credit | +5 score (~+1-2 pts) |

**Max theoretical lift:** ~30-40 points, but capped at 20 points for conservative estimates

---

## Deployment Verification

After deploying to stayhustler.com:

1. **Visit:** https://stayhustler.com/preview.html
2. **Prerequisite:** Must have booking + context data (go through flow)
3. **Check:**
   - Two percentages displayed (baseline & optimized)
   - Lift calculation shown
   - Baseline sublabel present
   - Lift disclaimer present
   - No JavaScript console errors

4. **Test lift cap:**
   - Enter max favorable scenario
   - Verify lift doesn't exceed 20 points
   - Verify optimized doesn't exceed 85%

---

## Success Criteria

✅ Baseline odds computed from structural factors only  
✅ Optimized odds = baseline + execution factors  
✅ Lift calculated and displayed (+X points)  
✅ Lift capped at 20 points max  
✅ Negative lift forced to zero  
✅ Both odds clamped 5-85%  
✅ UI clearly distinguishes baseline vs optimized  
✅ Lift disclaimer present  
✅ No crashes with missing data  
✅ Mitigation credit (+0.05) applied for disadvantaged scenarios  
✅ Trust-building language maintained  

---

## Rollback Plan

If issues arise:

```bash
git revert 5fdac70
git push origin main
```

This restores the single-odds display.

---

## Future Calibration

After collecting real-world data:
- Adjust lift cap if consistently hitting ceiling
- Tune mitigation credit based on actual outcomes
- Refine execution factor weights
- Consider A/B testing lift display variants

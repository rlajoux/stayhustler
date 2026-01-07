# Odds Microcopy Testing Guide

## Overview

The preview page now displays **tier-based microcopy** under the odds comparison that adapts to the baseline odds difficulty. This keeps the UI credible and motivating even when baseline odds are low.

## Tier System

### LOW Tier (baselinePct < 25)
**Trigger:** Structurally very difficult scenarios
- OTA + peak weekend + compressed market
- Premium room already booked + no loyalty + 1-night stay

**Microcopy:**
```
[Primary] This is a tougher scenario—but not a dead end.
[Support] The request below is written to reduce friction and make it easy for staff to help if anything opens up.
[Optional] Even when upgrades are unlikely, flexibility can lead to partial wins (view, location, or timing).
[Footer] Availability always comes first. This request focuses on timing, tone, and flexibility—not guarantees.
```

**Tone:** Honest but not discouraging, focuses on partial wins

---

### MEDIUM Tier (25% ≤ baselinePct ≤ 50%)
**Trigger:** Balanced scenarios with mixed factors
- Direct booking + weekday + neutral market
- Corporate rate + mid-tier loyalty + moderate stay

**Microcopy:**
```
[Primary] This is a workable setup.
[Support] The request is tailored to your stay and written to align with how hotels typically handle situations like yours.
[Optional] Timing and flexibility are doing most of the work here.
[Footer] Availability always comes first. This request focuses on timing, tone, and flexibility—not guarantees.
```

**Note:** Optional line hidden for MEDIUM tier to keep it compact (2 lines + footer)

**Tone:** Matter-of-fact, explains the approach

---

### HIGH Tier (baselinePct > 50%)
**Trigger:** Structurally favorable scenarios
- Direct + independent + soft day + base room
- Gold loyalty + resort market + weekday + short stay

**Microcopy:**
```
[Primary] This is a strong setup.
[Support] The request below is written to take advantage of the timing and flexibility in your case.
[Optional] Availability still drives outcomes, but this is about as favorable as it gets.
[Footer] Availability always comes first. This request focuses on timing, tone, and flexibility—not guarantees.
```

**Tone:** Confident but realistic, acknowledges favorable conditions

---

## Test Scenarios

### Test 1: LOW Tier (baselinePct = 18%)

**Setup:**
```javascript
localStorage.clear();

localStorage.setItem('stayhustler_booking', JSON.stringify({
  hotel: 'Hilton Times Square',
  city: 'New York, NY',
  hotel_type: 'chain',
  channel: 'ota',
  room: 'Executive Suite',
  checkin: '2026-01-17'
}));

localStorage.setItem('stayhustler_context', JSON.stringify({
  lengthOfStay: '1',
  arrivalDay: 'saturday',
  loyaltyStatus: 'none',
  askPreference: 'inperson',
  flexibility_primary: 'none'
}));

location.reload();
```

**Expected:**
- Baseline: ~15-20%
- Microcopy tier: **LOW**
- Primary: "This is a tougher scenario—but not a dead end."
- Support: Friction reduction message
- Optional: **VISIBLE** - Mentions partial wins
- Footer: **VISIBLE** - Availability disclaimer
- Border: Left accent border
- Background: Warm tone (not warning/error)

---

### Test 2: MEDIUM Tier (baselinePct = 38%)

**Setup:**
```javascript
localStorage.clear();

localStorage.setItem('stayhustler_booking', JSON.stringify({
  hotel: 'Marriott Downtown',
  city: 'Dallas, TX',
  hotel_type: 'chain',
  channel: 'direct',
  room: 'Standard King',
  checkin: '2026-01-22'
}));

localStorage.setItem('stayhustler_context', JSON.stringify({
  lengthOfStay: '3-4',
  arrivalDay: 'thursday',
  loyaltyStatus: 'member',
  askPreference: 'email',
  flexibility_primary: 'category'
}));

location.reload();
```

**Expected:**
- Baseline: ~35-40%
- Microcopy tier: **MEDIUM**
- Primary: "This is a workable setup."
- Support: Tailored request message
- Optional: **HIDDEN** (compact for medium tier)
- Footer: **VISIBLE**
- Clean, professional appearance

---

### Test 3: HIGH Tier (baselinePct = 62%)

**Setup:**
```javascript
localStorage.clear();

localStorage.setItem('stayhustler_booking', JSON.stringify({
  hotel: 'The Independent Boutique',
  city: 'Portland, OR',
  hotel_type: 'independent',
  channel: 'direct',
  room: 'Standard Queen',
  checkin: '2026-01-21'
}));

localStorage.setItem('stayhustler_context', JSON.stringify({
  lengthOfStay: '2',
  arrivalDay: 'wednesday',
  loyaltyStatus: 'gold',
  askPreference: 'both',
  flexibility_primary: 'any',
  first_time_stay: true
}));

location.reload();
```

**Expected:**
- Baseline: ~60-65%
- Microcopy tier: **HIGH**
- Primary: "This is a strong setup."
- Support: Taking advantage message
- Optional: **VISIBLE** - "As favorable as it gets"
- Footer: **VISIBLE**
- Confident but not overpromising tone

---

### Test 4: Boundary Test (baselinePct = 25% exactly)

**Expected:**
- Should trigger **MEDIUM** tier (25 <= baselinePct <= 50)
- Optional line should be **HIDDEN**

---

### Test 5: Boundary Test (baselinePct = 50% exactly)

**Expected:**
- Should trigger **MEDIUM** tier
- Optional line should be **HIDDEN**

---

### Test 6: Edge Case (baselinePct = 5% - clamped minimum)

**Expected:**
- Should trigger **LOW** tier (< 25)
- All LOW tier messaging displayed
- No crashes or errors

---

## Visual Validation

### Styling Checklist
- [ ] Background is warm tone (`--color-bg-warm`), not warning yellow/red
- [ ] Left border is accent color (`--color-accent`)
- [ ] Primary text is bold, readable
- [ ] Support text is muted color (`--color-text-muted`)
- [ ] Optional text (when shown) is muted color
- [ ] Footer is smaller, italic, with top border separator
- [ ] Mobile: Text wraps properly, remains readable
- [ ] Desktop: Maintains max-width, centered

### Placement Checklist
- [ ] Appears after lift display
- [ ] Appears before customization note
- [ ] Inside outlook-card section
- [ ] Doesn't overlap other elements
- [ ] Padding and margins appropriate

### Content Checklist
- [ ] Primary line matches tier exactly
- [ ] Support line matches tier exactly
- [ ] Optional line shown for LOW and HIGH only
- [ ] Optional line hidden for MEDIUM
- [ ] Footer line always visible
- [ ] No typos or grammatical errors
- [ ] Text fits comfortably in box (no overflow)

---

## Functional Tests

### Tier Switching
1. Start with LOW tier scenario (baselinePct = 18%)
2. Update localStorage to HIGH tier scenario (baselinePct = 65%)
3. Reload page
4. Verify microcopy changes to HIGH tier
5. Verify optional line appears again (was hidden for MEDIUM)

### Missing Data
1. Clear localStorage completely
2. Load preview.html
3. Verify page doesn't crash
4. Verify microcopy still renders (likely MEDIUM tier with default values)

### Integration with Other Elements
1. Verify microcopy doesn't interfere with:
   - Baseline/optimized odds display
   - Lift display
   - Customization note
   - Drivers chips
   - Summary section
2. Scroll behavior works correctly
3. Mobile sticky bar (if applicable) not affected

---

## Acceptance Criteria

✅ **Tier Logic**
- baselinePct < 25 → LOW tier
- 25 ≤ baselinePct ≤ 50 → MEDIUM tier  
- baselinePct > 50 → HIGH tier

✅ **Content Display**
- Primary line always shown
- Support line always shown
- Optional line shown for LOW and HIGH, hidden for MEDIUM
- Footer line always shown

✅ **Styling**
- Warm background, not warning/error
- Left accent border
- Proper text hierarchy (bold → regular → muted → italic)
- Mobile-friendly, no overflow

✅ **Tone**
- LOW: Honest but not discouraging
- MEDIUM: Matter-of-fact, explanatory
- HIGH: Confident but realistic
- All: Never oversell or guarantee

✅ **Integration**
- Doesn't break existing odds display
- Doesn't interfere with other UI elements
- Works with missing/incomplete data
- No console errors

---

## User Experience Goals

### For LOW Baseline Scenarios
**Before:** User sees 18% and might feel discouraged
**After:** User understands it's tough BUT request is designed to reduce friction, and partial wins are possible

### For MEDIUM Baseline Scenarios
**Before:** User sees 38% without context
**After:** User understands it's workable, request is tailored, and timing/flexibility matter

### For HIGH Baseline Scenarios
**Before:** User sees 62% but unsure why
**After:** User understands they have a strong setup and request leverages favorable factors

### Universal
- Footer disclaimer prevents overpromising
- Microcopy builds confidence without false expectations
- Language is hotel-native and professional
- Focus on execution (timing, tone, flexibility) not guarantees

---

## Browser Testing

### Chrome/Edge
```bash
# Open in browser
open https://stayhustler.com/preview.html

# Or locally
open preview.html
```

### Firefox
```bash
firefox https://stayhustler.com/preview.html
```

### Safari
```bash
open -a Safari https://stayhustler.com/preview.html
```

### Mobile
- Test on iOS Safari
- Test on Android Chrome
- Verify text wraps properly
- Verify no horizontal scroll
- Verify touch targets adequate

---

## Rollback Plan

If microcopy causes confusion or UI issues:

```bash
git revert 09409da
git push origin main
```

This removes the microcopy section but keeps baseline vs optimized odds display.

---

## Future Enhancements

Potential improvements (NOT in current scope):
- A/B test different messaging
- Add icons/emoji for visual interest
- Animate tier transitions
- Add "Why?" tooltip explaining tier logic
- Localize messaging for different markets
- Track which tier users see most often

---

## Success Metrics

Post-deployment, monitor:
1. **User sentiment** - Do users with LOW baseline still proceed to payment?
2. **Comprehension** - Do users understand the tiered messaging?
3. **Confidence** - Does microcopy build trust or create confusion?
4. **Conversion** - Does LOW tier messaging maintain conversion vs without?

Target: LOW tier users should proceed at similar rates to MEDIUM tier (microcopy prevents drop-off)

# LLM Prompt Mitigation Testing Guide

## Overview

The LLM prompt now includes mitigation strategies that add hotel-native language to reduce friction when structural disadvantages are present. The email content itself helps offset negative scoring factors.

## Mitigation Strategies Implemented

### 1. OTA Booking Mitigation
**Triggers when:** `booking.channel` contains "ota" or "travel agency"

**Mitigation language:**
- Explicit flexibility: "I'm very flexible on room type/timing"
- Easy guest signal: "completely understand availability comes first"
- No entitlement tone

**Expected in email:**
- More flexibility language than standard emails
- Operational courtesy emphasized
- Calm, understanding tone

---

### 2. Peak / High-Demand Mitigation
**Triggers when:** 
- `arrivalDay` = "friday" or "saturday"
- OR city suggests compressed market (New York, Paris, London, etc.)

**Mitigation language:**
- Acknowledge demand: "I know this is a busy arrival period"
- Express gratitude: "appreciate any consideration if something opens up"

**Expected in email:**
- ONE sentence acknowledging peak timing
- Positioned after main ask, before soft close

---

### 3. Long Stay Mitigation
**Triggers when:** `lengthOfStay` = "5+" or "3-4" (upper range)

**Mitigation language:**
- Partial flexibility: "Even for part of the stay, I'd be grateful to be considered"

**Expected in email:**
- Offers flexibility on duration of upgrade
- Reduces perceived inventory pressure

---

### 4. Premium Room Mitigation
**Triggers when:** `booking.room` contains "suite", "executive", "premium", "deluxe"

**Mitigation strategy:**
- **Pivot primary ask** to placement/view/timing instead of category
- Keep category mention secondary: "If a higher category is forecasted to remain available, wonderful, but primarily interested in..."
- Emphasize: better location, view, floor, quiet placement

**Expected in email:**
- Main ask focuses on VIEW or LOCATION, not room category
- Room category upgrade mentioned as optional/secondary
- Reduces perception of difficult request

---

### 5. Last-Minute Timing Mitigation
**Triggers when:** Check-in date is same day or within 24 hours

**Mitigation language:**
- Remove urgency: "If anything becomes available later today or during my stay..."
- Patience signal: no rush, no pressure

**Expected in email:**
- Explicitly calm tone
- No urgency or time pressure
- Understanding of operational constraints

---

## Test Scenarios

### Scenario 1: OTA + Peak Weekend (Multiple Disadvantages)

**Input:**
```json
{
  "booking": {
    "hotel": "Hilton Midtown Manhattan",
    "city": "New York, NY",
    "checkin": "2026-01-17",
    "checkout": "2026-01-19",
    "room": "Standard King",
    "channel": "ota"
  },
  "context": {
    "lengthOfStay": "2",
    "arrivalDay": "saturday",
    "loyalty": "none",
    "askPreference": "both",
    "flexibility_primary": "any"
  }
}
```

**Expected Mitigations Applied:**
1. OTA booking mitigation → Extra flexibility language
2. Peak weekend + compressed market → Acknowledge busy period

**Validation:**
- Email includes "very flexible" or similar
- Mentions "weekend arrival" or "busy period"
- Tone is humble, not entitled
- Still 160-210 words
- Includes "forecasted to remain available" exactly once

---

### Scenario 2: Long Stay (5+ nights)

**Input:**
```json
{
  "booking": {
    "hotel": "The Resort at Cabo",
    "city": "Cabo San Lucas",
    "checkin": "2026-01-15",
    "checkout": "2026-01-22",
    "room": "Garden View",
    "channel": "direct"
  },
  "context": {
    "lengthOfStay": "5+",
    "arrivalDay": "wednesday",
    "loyalty": "silver",
    "askPreference": "email",
    "flexibility_primary": "any"
  }
}
```

**Expected Mitigations Applied:**
- Long stay mitigation → Partial flexibility offered

**Validation:**
- Email includes "even for part of the stay" or similar
- Reduces inventory pressure perception
- Still professional and warm

---

### Scenario 3: Premium Room Booked (Category Pivot)

**Input:**
```json
{
  "booking": {
    "hotel": "Four Seasons",
    "city": "Miami, FL",
    "checkin": "2026-01-20",
    "checkout": "2026-01-23",
    "room": "Executive Suite",
    "channel": "direct"
  },
  "context": {
    "lengthOfStay": "3-4",
    "arrivalDay": "tuesday",
    "loyalty": "gold",
    "askPreference": "both",
    "flexibility_primary": "any"
  }
}
```

**Expected Mitigations Applied:**
- Premium room mitigation → Pivot to view/location

**Validation:**
- **Primary ask** is for better location, view, or floor
- Room category upgrade mentioned only as secondary/optional
- Does NOT push hard for suite upgrade
- Tone: interested in experience, not just category

---

### Scenario 4: Last-Minute Request (Same Day)

**Input:**
```json
{
  "booking": {
    "hotel": "Marriott Downtown",
    "city": "Seattle, WA",
    "checkin": "2026-01-07", // Today
    "checkout": "2026-01-09",
    "room": "Standard Room",
    "channel": "direct"
  },
  "context": {
    "lengthOfStay": "2",
    "arrivalDay": "wednesday",
    "loyalty": "member",
    "askPreference": "email",
    "flexibility_primary": "any"
  }
}
```

**Expected Mitigations Applied:**
- Last-minute timing mitigation → Remove urgency

**Validation:**
- Email includes "if anything becomes available later today" or similar
- No pressure or urgency
- Calm, patient tone
- Understanding of constraints

---

### Scenario 5: Standard Request (No Disadvantages - Baseline)

**Input:**
```json
{
  "booking": {
    "hotel": "The Independent Boutique",
    "city": "Austin, TX",
    "checkin": "2026-01-20",
    "checkout": "2026-01-22",
    "room": "Standard King",
    "channel": "direct"
  },
  "context": {
    "lengthOfStay": "2",
    "arrivalDay": "tuesday",
    "loyalty": "none",
    "askPreference": "both",
    "flexibility_primary": "any"
  }
}
```

**Expected Mitigations Applied:**
- NONE (no structural disadvantages)

**Validation:**
- Standard professional tone
- No extra mitigation language
- Baseline request quality
- Still 160-210 words and all validation rules

---

## Validation Checklist

### Functional Requirements
- [ ] OTA bookings get extra flexibility language
- [ ] Peak dates (Fri/Sat) get busy period acknowledgment
- [ ] Long stays (5+ nights) get partial flexibility offer
- [ ] Premium rooms pivot ask to view/location
- [ ] Last-minute requests remove urgency
- [ ] Standard requests (no disadvantages) remain unchanged

### Quality Guardrails
- [ ] No more than 2 mitigation sentences per email
- [ ] Mitigation language fits naturally
- [ ] No fabricated facts (occasions, loyalty)
- [ ] No apologetic tone (humble but not sorry)
- [ ] Professional, warm, seasoned traveler voice

### Validation Compliance
- [ ] Still 160-210 words
- [ ] Still includes "Reservation: [Confirmation Number]"
- [ ] Still includes "forecasted to remain available" exactly once
- [ ] No banned words (hack, trick, free, guarantee, owed, must, demand)
- [ ] Subject line 6-12 words with date
- [ ] JSON output only

### Edge Cases
- [ ] Multiple disadvantages (OTA + peak) → max 2 mitigations applied
- [ ] No booking.channel → no OTA mitigation, no error
- [ ] No booking.room → no premium room mitigation
- [ ] Invalid dates → no last-minute mitigation
- [ ] Unknown city → no compressed market mitigation

---

## Testing Method

### Option 1: API Testing with curl

```bash
curl -X POST https://stayhustler-production.up.railway.app/api/generate-request \
  -H "Content-Type: application/json" \
  -d '{
    "booking": {
      "hotel": "Hilton Midtown",
      "city": "New York, NY",
      "checkin": "2026-01-17",
      "checkout": "2026-01-19",
      "room": "Standard King",
      "channel": "ota"
    },
    "context": {
      "lengthOfStay": "2",
      "arrivalDay": "saturday",
      "loyalty": "none",
      "askPreference": "both",
      "flexibility_primary": "any"
    }
  }'
```

### Option 2: Frontend Flow Testing

1. Go through complete booking flow on stayhustler.com
2. Enter booking details with disadvantage triggers:
   - OTA booking channel
   - Friday/Saturday arrival
   - Premium room booked
3. Complete payment
4. Check delivered email for mitigation language

### Option 3: Manual Prompt Testing

Copy the prompt from `buildPrompt()`, populate with test data, and run through Gemini API directly to see output.

---

## Success Criteria

✅ **Mitigation strategies reduce friction** - Emails for "hard" scenarios read realistic and respectful  
✅ **No validation errors** - All outputs pass existing validation rules  
✅ **Natural language** - Mitigation fits seamlessly, not forced  
✅ **No over-mitigation** - Max 2 sentences, not excessive  
✅ **Maintains tone** - Professional, warm, never apologetic  
✅ **Backward compatible** - Works with missing optional fields  

---

## Rollback Plan

If mitigation causes validation failures or tone issues:

```bash
git revert 7c4156c
git push origin main
```

This will restore the previous prompt without mitigation strategies.

---

## Next Steps

1. **Monitor generation logs** - Check for validation failures
2. **Review sample outputs** - Ensure mitigation language is natural
3. **A/B test** (optional) - Compare success rates with/without mitigation
4. **Iterate** - Refine mitigation language based on user feedback

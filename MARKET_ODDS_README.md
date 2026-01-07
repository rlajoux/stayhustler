# Market-Aware Upgrade Odds

## Overview

The upgrade odds calculator now incorporates **real-world market dynamics** to provide more accurate estimates based on:
1. **City market tier** - Compressed vs resort vs neutral markets
2. **Hotel type** - Independent/boutique vs chain properties

## What Changed

### Booking.html
Added optional "Hotel type" dropdown:
- **Not sure** (default) → stored as `hotel_type: "unknown"`
- **Chain / branded** → stored as `hotel_type: "chain"`
- **Independent / boutique** → stored as `hotel_type: "independent"`

Stored in `localStorage.stayhustler_booking.hotel_type`

### Preview.html
Added two new scoring factors:

#### 1. Market Tier Scoring
Based on city from booking data, mapped to three tiers:

**Compressed Markets** (-0.20 score modifier)
- High demand, constrained inventory, harder to upgrade
- Cities: Paris, London, NYC, Tokyo, Singapore, Hong Kong, San Francisco, Barcelona, Amsterdam, Dubai, Rome, Venice, Sydney
- Chip: "High-demand city"

**Resort Markets** (+0.15 score modifier)
- Seasonal/elastic pricing, more inventory flexibility
- Cities: Las Vegas, Miami, Bali, Phuket, Cancun, Maldives, Santorini, Maui, Aspen, Cabo, Turks & Caicos, Key West
- Chip: "Resort / elastic market"

**Neutral Markets** (0.00 score modifier)
- Balanced dynamics
- Cities: Bangkok, Austin, Seattle, Boston, Chicago, Denver, Portland, Nashville, Atlanta, Dallas, Houston, Phoenix, San Diego, Washington DC, LA, Melbourne, Toronto, Vancouver, Montreal
- No chip shown

**Unknown Markets** (0.00 score modifier)
- Cities not in the map default to neutral
- No penalty for smaller cities
- No chip shown

#### 2. Hotel Type Scoring

**Independent / Boutique** (+0.10 score modifier)
- More operational flexibility
- Discretionary upgrade decisions
- Chip: "Independent property"

**Chain / Branded** (0.00 score modifier)
- Standardized policies
- No chip shown

**Not sure** (0.00 score modifier)
- User selected default
- No chip shown

## Impact Examples

### Example 1: Paris vs Las Vegas (Same Profile)
**Profile**: Direct booking, Gold loyalty, weekday, flexible, asking before arrival

| City | Market Tier | Score Modifier | Estimated Odds |
|------|-------------|----------------|----------------|
| Paris | Compressed | -0.20 | ~65% |
| Las Vegas | Resort | +0.15 | ~73% |

**Difference**: 8 percentage points due to market dynamics alone

### Example 2: Hotel Type Impact
**Profile**: Direct booking in Bangkok, Silver loyalty, weekday

| Hotel Type | Score Modifier | Estimated Odds |
|------------|----------------|----------------|
| Chain | 0.00 | ~58% |
| Independent | +0.10 | ~62% |

**Difference**: 4 percentage points for independent properties

### Example 3: Combined Impact
**Worst case**: OTA booking, Paris (compressed), chain, Saturday arrival, no loyalty
→ Estimated odds: ~18%

**Best case**: Direct booking, Las Vegas (resort), independent, weekday, Gold loyalty, flexible
→ Estimated odds: ~81%

## Technical Details

### City Normalization
```javascript
normalizeCity("Paris, France") → "paris"
normalizeCity("New York, NY") → "new york"
normalizeCity("London (UK)") → "london"
```

Removes country suffixes, parentheses, lowercases, trims whitespace.

### Scoring Formula
```
score = base_score (-0.25)
  + channel_modifier
  + loyalty_modifier
  + length_of_stay_modifier
  + arrival_day_modifier
  + ask_preference_modifier
  + flexibility_modifier
  + occasion_modifier
  + market_tier_modifier  ← NEW
  + hotel_type_modifier   ← NEW

probability = 1 / (1 + exp(-score))
percentage = clamp(round(probability * 100), 5, 85)
```

### Graceful Degradation
- If `city` is missing → no market tier adjustment
- If `hotel_type` is "unknown" or missing → no hotel type adjustment
- If city not in `CITY_TIER` map → defaults to "unknown" tier (neutral)
- No error shown to user, scoring continues with available data

## City Coverage

Currently mapped: **60+ cities**

**To add more cities**: Edit `CITY_TIER` object in preview.html line ~700

```javascript
const CITY_TIER = {
    "your_city": "compressed",  // or "resort" or "neutral"
    // ...
};
```

Recommendation: Add cities based on user data - track which cities users enter and categorize the top 100.

## Testing

Open `test-market-odds.html` in browser to verify:
- Paris (compressed) reduces odds
- Las Vegas (resort) increases odds
- Independent hotels add boost
- Side-by-side comparisons show expected differences

## User Experience

### Before Market Awareness
User sees: "52% upgrade odds"
No context about city or property type impact.

### After Market Awareness
User sees: "52% upgrade odds"
Chips: "Direct booking" | "Top-tier loyalty" | "High-demand city" | "Independent property"

User understands WHY the estimate is what it is, and that Paris/NYC are harder than Las Vegas.

## Future Enhancements

1. **Seasonal adjustments**: Track peak vs off-peak periods
2. **Hotel-specific data**: If user provides hotel name, look up brand tier
3. **Historical data**: Machine learning on actual upgrade success rates
4. **Event-based**: Detect major events (conferences, holidays) impacting demand
5. **Room type spreads**: Different odds for suite vs room upgrade

## Deployment

**Backend**: No changes required ✅

**Frontend**:
1. Upload `booking.html` to Hostinger (has hotel type dropdown)
2. Upload `preview.html` to Hostinger (has market-aware scoring)
3. Optional: Upload `test-market-odds.html` for testing

**Backward Compatible**: 
- Old bookings without `hotel_type` → defaults to "unknown" (neutral)
- Cities not in map → defaults to "unknown" tier (neutral)
- No breaking changes

## Analytics Recommendations

Track these metrics:
1. % of users selecting each hotel type
2. Distribution of cities entered
3. Average odds by market tier
4. Correlation between estimated odds and actual upgrade reports (if collecting feedback)

Use this data to:
- Refine market tier assignments
- Add more cities to the map
- Validate scoring weights
- Identify outlier cities that should be recategorized

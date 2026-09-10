# StayHustler loyalty selection: proposal for review

Prepared 10 September 2026. Raphael confirmed **select programme and tier**, rather than connect a loyalty account, and subsequently authorised implementation. The selector, benefit card and request integration are implemented on the feature branch. Production deployment remains pending. The wider pricing and offer work remains for review.

## Recommendation

Add a programme selector, its matching membership tiers and a concise benefit card to the booking form. Use the selected status and applicable benefit conditions to improve the paid request. This adds a concrete reason to use StayHustler: understand which benefits may already apply, then make a relevant request without overstating entitlement.

Start with the ten programmes below, selected for coverage across international hotel groups and different price segments. This is a coverage shortlist, not a measured ranking by membership or customer demand. Show them alphabetically in the selector, with “No membership”, “Other programme” and “Not sure” paths.

## First ten programmes

| Programme | Core tiers and invitation-only levels to recognise |
| --- | --- |
| [Marriott Bonvoy](https://www.marriott.com/loyalty/member-benefits.mi) | Member, Silver Elite, Gold Elite, Platinum Elite, Titanium Elite, Ambassador Elite |
| [Hilton Honors](https://www.hilton.com/en/hilton-honors/member-benefits/) | Member, Silver, Gold, Diamond, Diamond Reserve |
| [IHG One Rewards](https://www.ihg.com/onerewards/content/us/en/tier-benefits) | Club Member, Silver Elite, Gold Elite, Platinum Elite, Diamond Elite |
| [World of Hyatt](https://world.hyatt.com/content/gp/en/tiers-and-benefits.html) | Member, Discoverist, Explorist, Globalist |
| [ALL Accor](https://all.accor.com/loyalty-program/cards-status-benefits-details/index.en.shtml) | Classic, Silver, Gold, Platinum, Diamond, Limitless (invitation only) |
| [Wyndham Rewards](https://www.wyndhamhotels.com/wyndham-rewards/member-levels) | Blue, Gold, Platinum, Diamond, [Titanium (invitation/designation)](https://www.wyndhamhotels.com/wyndham-rewards/terms/titanium) |
| [Choice Privileges](https://www.choicehotels.com/choice-privileges/benefits) | Member, Gold, Platinum, Diamond, Titanium |
| [Best Western Rewards](https://www.bestwestern.com/en_US/best-western-rewards.html) | Blue, Gold, Platinum, Diamond, Diamond Select |
| [Radisson Rewards](https://www.radissonhotels.com/en-us/rewards/benefits) | Club, Premium, VIP |
| [GHA DISCOVERY](https://www.ghadiscovery.com/gha-discovery-benefits) | Silver, Gold, Platinum, Titanium |

Recognise verified lifetime labels as variants of their corresponding stay tier. Do not treat them as a higher automatic benefit level. InterContinental Ambassador, Royal Ambassador and Kimpton Inner Circle are separate brand-specific recognition, not extra core IHG tiers. Their detailed benefits can be a later addition; an unsupported recognition label should remain unverified in the first version.

Radisson requires a location check: its current Rewards programme covers Europe, the Middle East, Africa and Asia Pacific. Radisson Rewards Americas was incorporated into Choice Privileges. A brand name alone cannot decide the applicable programme. See the research notes below.

## Proposed customer flow

1. **Programme and tier.** Ask “Do you have hotel loyalty status?” The second selector contains only that programme's tiers. Membership is supplied by the traveller; no account login, card image or membership number is needed.
2. **Booking relevance.** Reuse the known hotel, country and booking channel. Where the brand or eligibility is unclear, ask for confirmation only if it changes the advice. Do not infer programme participation from a similar hotel name.
3. **Benefit card.** Show the selected programme/tier and the useful stay benefits: room upgrade, early arrival, late checkout, breakfast and lounge access. Display timing, conditions, source and checked date where verified. Lead with the customer's chosen request; keep other benefits expandable.
4. **Paid request.** Carry the selected status and the relevant verified conditions into the email, short message and reception script. The customer reviews the wording before sending it.

A “Compare tiers” view can show differences, but browsing a higher tier must not change the traveller's selected status. One relevant programme per booking is sufficient for the first version; a saved wallet of multiple cards is unnecessary at this stage.

## How the benefit card should communicate certainty

| Label | When to use it |
| --- | --- |
| Included on eligible bookings | The published rule supports it. State any brand, rate, guest or property restrictions; do not imply this traveller's booking has been independently verified. |
| Subject to availability | The hotel must confirm the room or timing. A fixed requested checkout time can still be conditional. |
| Requires a choice or reward | Breakfast may be a welcome choice; a confirmed suite may require a separately held certificate. Status alone does not prove that reward exists. |
| Not verified for this booking | A relevant property rule, rate condition, source or membership detail is missing or conflicting. |

Do not turn an omission in a benefit table into “you cannot get this”. A hotel may still grant a discretionary request. Likewise, do not assign a probability or cash value without supporting evidence.

Avoid a universal “booked through an OTA means no benefits” rule. Most reviewed programmes restrict these bookings, but Radisson's terms expressly preserve benefits for online-travel-company rates. Choice also has benefit-specific eligibility rules. Resolve eligibility per programme and benefit.

## Example: GHA DISCOVERY Platinum

For a participating hotel and eligible booking, the card can show:

> **Your selected status: GHA DISCOVERY Platinum**
>
> Room upgrade: one category, subject to availability.
>
> Late checkout: until 3 pm, subject to availability. Request at arrival.
>
> Based on published programme rules, checked 10 September 2026. The hotel confirms availability.

The paid request could then include, if the traveller selected late checkout:

> “As a GHA DISCOVERY Platinum member, may I request a 3 pm checkout on [departure date], subject to availability? I would be happy to confirm this with reception when I arrive.”

This is an illustrative example, not output for a real booking. Source: [GHA terms, section 4.6](https://www.ghadiscovery.com/terms-conditions).

## What remains paid

The public benefit card can appear before checkout. It shows published rules and helps the customer understand the offer. Keep the booking-specific email, short message, reception script and follow-up assistance behind verified payment, as agreed in the offer review.

The paid value is applying the rules to the customer's request, producing useful wording and helping with the next step. Do not charge merely to reveal a public tier chart. Where the chosen benefit is already included and a simple confirmation is sufficient, say so clearly.

Recommendation: include loyalty support in the proposed $7 package initially. Do not introduce a separate loyalty surcharge or change price at the same time. Whether this increases purchases is a hypothesis to measure, not an established uplift.

## Implementation boundaries for a later approved build

- Replace the ambiguous shared `loyaltyStatus` value with programme and tier identifiers. Changing programme must clear an incompatible tier. Older “Gold” drafts must be reconfirmed, not silently mapped to a programme; preserve existing paid output.
- Keep benefit rules in a small, reviewed catalogue with source URL, checked date, effective dates where published and applicable conditions. The language model writes from supplied facts; it must not invent policy from memory.
- Validate programme/tier pairs on the server as well as in the form. Use the same rule result for the benefit card and generation. Save the rule version used for a paid request so its advice can be traced.
- Mention status only when relevant to the booked property. Do not imply that StayHustler has verified membership or connected an account.
- Preserve the customer's main request. Do not append every possible perk, claim a guaranteed suite or assume ownership of a milestone reward. Never accept a quoted fee on the customer's behalf.
- When a benefit cannot be established, use neutral request wording with no entitlement claim. Missing sources should reduce certainty, not prevent the customer from making a reasonable request.
- Assign an owner and a review cadence for the catalogue before launch. Recheck sources after announced programme changes. No scheduled automation is proposed or created by this document.

## Acceptance checks before release

1. Every listed programme has the correct tier choices, including verified 2026 additions. A tier from another programme is rejected.
2. “Gold” produces different advice for different programmes. GHA Gold is not given Platinum checkout; Hilton Gold is not given Diamond Reserve checkout.
3. Brand, region and channel exceptions affect the displayed benefit and the generated request consistently. Test Radisson in both the Americas and Asia, and an OTA booking with programme-specific rules.
4. Availability-dependent benefits never become guarantees. Club-floor upgrades never automatically become lounge access. Certificates and welcome choices are kept distinct.
5. Unknown status, unsupported hotels, incomplete eligibility and conflicting sources all produce honest conditional wording. Existing saved drafts and paid outputs remain usable.
6. The unpaid browser receives no personalised paid text. Purchase and fulfilment still use the existing verified-payment boundary.

## Evidence and unresolved coverage

- [Marriott, Hilton, IHG and Hyatt research](LOYALTY_RESEARCH_MAJOR_FOUR.md)
- [ALL Accor, Wyndham and Choice research](LOYALTY_RESEARCH_ACCOR_WYNDHAM_CHOICE.md)
- [Best Western, Radisson and GHA research](LOYALTY_RESEARCH_BW_RADISSON_GHA.md)

All three notes use official sources checked on 10 September 2026. They establish programme-level rules, not a complete hotel-by-hotel eligibility database. Hyatt's full current terms were not readable during research, although official tier and benefit pages were verified. Accor's grid, directory and detailed terms conflict on some breakfast details. Those cases must remain qualified until resolved for the relevant property.

## Local implementation and verification

The preferences form now supports all ten programmes and their matching tiers, including verified lifetime variants. It shows the requested benefit first, with other perks and sources expandable. The traveller confirms hotel participation before status is included in the generated request. Changing programme or hotel clears the relevant confirmation. Membership and booking eligibility remain self-reported.

The static site and API share one catalogue. Server validation rejects incompatible programme/tier pairs, and generation uses the relevant reviewed conditions. OTA exclusions suppress entitlement claims. Existing generic drafts require a fresh selection in the UI; their original server data format is preserved for pending checkout retries. Existing saved paid output is unchanged.

Validation: 37 automated tests pass, including order persistence, verified payment, recovery and loyalty-specific cases. Browser checks cover all ten selectors, tier reset, saved draft restoration, migration from the previous generic form, the review/payment handoff and a 390-pixel mobile viewport. A synthetic checkout saved the exact programme, tier, participation confirmation and catalogue version in local PostgreSQL before a mocked payment outage.

Generation was tested with mocked model responses; no live model call was made because the local environment has no Gemini key. No real payment or email was sent. Pricing and production deployment are unchanged.

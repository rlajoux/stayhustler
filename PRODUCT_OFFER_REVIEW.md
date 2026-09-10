# StayHustler: product, pricing and offer review

Prepared 10 September 2026 for discussion. Recommendations only; no product, price or production changes are authorised by this document.

The commercial objective is to increase paid purchases. My recommendation is to improve the usefulness and visibility of the package at the existing $7 price, measure the response, then test a higher price separately. The proposed prices below are hypotheses, not estimates of proven willingness to pay.

## What the current product establishes

The deployed product charges $7 for a personalised email, three timing tips and an in-person script. The customer sends the request. Checkout, recovery and fulfilment have regression coverage, but those tests do not establish that the writing or advice is better than a free alternative.

| Verified finding | Customer consequence | Recommended response |
| --- | --- | --- |
| The review page shows booking details and a list of deliverables, with no personalised output before payment. | The customer must judge an unfamiliar product without seeing evidence of its quality. | Show a clearly labelled worked example and a booking-specific summary of the paid package. Keep all personalised, ready-to-send wording behind payment. |
| Generation checks plain text, placeholders, dates, request keywords and size limits. Current generation tests use mocked responses. | A technically valid response can still be generic, repetitive or unhelpful. | Add representative output evaluations and a clear editorial standard. |
| The form groups loyalty status into generic choices including “Gold / top-tier”. | Different programmes and tiers can be confused; an included benefit can be presented as a discretionary favour. | Collect the actual programme and tier. Use verified rules where supported, and mark unknown cases. |
| The free “Probability Checker” uses fixed point weights and phrases such as “good odds”. It rewards longer stays and presents a general 24–36-hour window. | The presentation implies predictive evidence the implementation does not provide. | Rework it as a request-planning tool, with reasons and constraints instead of a probability rating. |
| Saved orders and recovery links expire 30 days after purchase. | Customers booking further ahead can lose online access before travelling, although the emailed copy remains available. | Propose access through checkout plus seven days, with a published maximum booking horizon and aligned retention terms. |
| WELCOME5 reduces the $7 price to $2; UPGRADE10 reduces it to $6.30. | Coupon traffic can distort conclusions about demand at the headline price. | Segment existing discounts in analysis. Avoid layering a new broad discount onto the offer test. |

Code references: `api/generation.js`, `api/tests/generation.test.js`, `api/validation.js`, `api/orders.js`, `public/context.html`, `public/preview.html`, `public/tools/upgrade-checker.html`, `public/privacy.html` and `public/terms.html`.

A free substitute is a serious positioning consideration. ChatGPT offers a free plan, and vvSearch advertises a dedicated hotel-upgrade email generator with 50 free credits. I reviewed those published offers, not their output quality or conversion performance. StayHustler needs to make its booking-specific guidance and follow-through tangible. [ChatGPT plans](https://chatgpt.com/pricing/), [vvSearch offer](https://vvsearch.com/tool/hotel-upgrade-email-generator)

Programme details matter in practice: Marriott distinguishes benefits by tier and property, and enhanced room upgrades depend on availability for the entire stay. Those rules do not support treating all “Gold” members alike or assigning a universal advantage to longer stays. [Marriott programme terms](https://www.marriott.com/loyalty/terms/default.mi)

## The proposed customer and job

Initial audience hypothesis: leisure travellers with an existing booking who care about a particular benefit and want help making a sensible request. Prioritise travellers who do not already know how their booking benefits and loyalty status work. Validate this audience before narrowing acquisition around it.

The job: “Help me decide what to ask for, send a suitable message, and know what to do when the hotel replies.”

For a customer who already has the requested benefit included, acknowledge that and explain how to confirm it. This builds trust even when the paid package is unnecessary.

## Three offer options

These are alternative directions and a possible later bundle, not three simultaneous checkout tiers.

| Option | Proposed contents | Price hypothesis | Assessment |
| --- | --- | --- | --- |
| A. Improve the current request | Better email, short booking-app message, specific timing advice, desk script and one revision. | $7 per stay | Smallest implementation. Easier to explain, but still readily compared with general writing tools. |
| B. A complete request plan for one stay | A booking-specific recommendation, email and short message, timing and follow-up plan, desk script, one revision and one response to the hotel's reply. Saved through the agreed trip window. | Start at $7; test $9 once quality and usage are measured | Recommended. Helps at multiple points in the customer's actual task. Requires bounded revisions, reply handling and better retention. |
| C. A trip pass | Three packages from option B for three separate hotel bookings. | $19, only after repeat or multi-hotel demand is demonstrated | Potentially useful for touring travellers. Needs credit tracking, clear validity and support rules. Introduce after the single-stay offer works. |

Do not introduce a subscription yet. The current evidence does not establish a recurring usage pattern. A human concierge tier would also require a defined staffing and service-cost model before it can be offered.

## Recommended package, made concrete

Before payment, show a clearly labelled worked example plus a summary of the customer's chosen request, booking facts and exact package contents. The review confirms what the customer is buying; it does not reveal their generated email, messaging text, desk script or reply assistance. Personalised generation and access remain gated by verified payment.

This payment boundary addresses the copy-and-leave concern raised during the review. Do not deliver the paid text to an unpaid browser and merely blur or hide it. A public worked example can still be adapted manually, so the commercial proposition must rest on useful personalisation, convenience and follow-through rather than making text impossible to copy. No free generation endpoint is proposed for this first version.

The paid package would include:

1. **What to ask for:** the selected priority, an acceptable alternative if the customer wants one, and the reason for the approach. Separate verified benefits, discretionary requests and possible paid options.
2. **Words ready to use:** a concise email and a shorter version suitable for the booking platform's messaging system. Use readable dates, preserve the room and party's constraints, and show obvious fields to complete before sending.
3. **A practical next step:** a send window relative to this booking, when a single follow-up may be appropriate, and what to ask at reception. Same-day arrivals need different advice from stays booked months ahead.
4. **Help after the first message:** one revision and one suggested reply to the hotel's response, for the same booking and request. Account for a refusal, an included benefit, or a quoted fee without accepting any charge on the customer's behalf.
5. **Access for the trip:** save, copy and export the plan; keep the recovery link usable through the clearly stated access window.

Only ask additional questions when they affect the request: exact loyalty programme/tier if applicable, the desired departure time for late checkout, complimentary-only versus willingness to consider a quoted fee, and an acceptable alternative. Preserve known dates and room details. Avoid a longer universal questionnaire.

Raphael confirmed programme and tier selection rather than connecting a loyalty account, then authorised this feature's implementation. The [ten-programme loyalty review](LOYALTY_PROGRAMMES_REVIEW.md) records the feature-branch implementation, benefit card, request integration, payment boundary and source limitations. Production deployment is pending; the wider offer and pricing recommendations still require review.

Policy guidance must use a maintained source with an effective or checked date. Start with a limited supported set and show “not verified” outside it. Do not imply live room availability, hotel contact, a guaranteed benefit or knowledge of occupancy. Property-level research is a later capability unless it can be reliably sourced and checked.

## Proposed presentation

Draft headline:

> Make the most of the hotel you've booked.

Draft explanation:

> Know what to ask for, when to ask and what to say next. Get a personalised request plan for your stay, with help responding to the hotel.

Primary entry button: **Build my request**.

At the preview: **Get my full package — $7**. If the $9 experiment is approved later, the displayed price must follow the assigned offer consistently through Stripe.

The product should still clearly state that the guest sends the messages and the hotel decides benefits. Place that explanation beside the offer, alongside a concrete sample. Retain clear AI disclosure in the product explanation and relevant privacy information.

Proposed reassurance for review: a rewrite or refund within seven days if the wording is unsuitable. This would be a service-quality promise, with an operational refund process and clear terms. It is not an upgrade guarantee. It must not be published until the policy and support handling are approved.

Use examples labelled as examples. Collect authentic customer feedback with permission before adding testimonials or outcome claims. Avoid invented savings, countdowns, success percentages and unsupported “best timing” claims.

## Quality standard before relaunching the offer

Evaluate the actual configured model on a fixed set of synthetic bookings. Include all six request types, same-day arrivals, future bookings, a long stay, a sold-out claim supplied by a customer, specific programme tiers, an already-included benefit, complimentary-only preferences, a refusal and a paid counteroffer. Include hostile text and incomplete inputs as separate failure cases.

Assess each output on five dimensions, scored 1–5: factual faithfulness, usefulness of the recommendation, practical next steps, natural wording and respect for the customer's constraints. Treat invented policy, invented entitlement, changed dates, wrong request or implied acceptance of a fee as release-blocking failures regardless of the total score.

Compare the current generator, the proposed version and a basic free-assistant prompt using the same booking facts. Review them blind where practical. A suggested initial gate is no critical failures in the fixed set and a median of at least 4/5 in each dimension, plus a clear reviewer preference for the paid package's usefulness. These are proposed acceptance criteria, not results already achieved.

A deterministic layer should handle dates, input requirements and verified rule references. The model should produce wording from those facts. Changing model alone will not correct inaccurate inputs or unsupported policy assumptions.

## Price and offer testing

1. Establish a clean baseline for the newly deployed UI. Separate full-price purchases, coupons and free grants; exclude internal tests and bots. Historical records from the old checkout cannot be assumed comparable.
2. Test the improved package, worked examples and pre-payment summary at $7. Keep acquisition mix and price stable enough to interpret the result. With very low traffic, use a small usability review first rather than an inconclusive multi-variant experiment.
3. If customers use and value the package, compare $7 and $9 with the same contents and messaging. Assign an offer consistently per visitor and preserve the quoted amount on the order. Do not alter existing pending or paid orders.
4. Consider a $19 three-stay pass only after evidence of repeat use or demand for a multi-hotel trip.

Primary commercial measure: completed paid purchases per eligible unique visitor, using verified Stripe payment events. Also report paid purchases net of full refunds over a defined follow-up window. Diagnostic steps are request started, package summary seen, checkout started and payment completed.

Guardrails: successful delivery, time to a usable result, rewrite and refund rates, support burden and contribution after payment fees, generation, email and expected refunds. Copy/export actions and customer-reported usefulness help identify whether buyers actually use the output. A reported hotel outcome is observational feedback, not proof of incremental upgrade lift.

At $9, a conversion rate equal to 7/9 of the $7 conversion rate gives the same gross revenue per visitor, before fees and refunds. That would mean about 22.2% fewer purchases, so revenue alone is insufficient for Raphael's stated purchase-growth objective. Select a higher price only against an explicitly agreed trade-off.

There is no verified traffic, conversion, fee, refund or repeat-purchase baseline in this review. Therefore no uplift estimate, acquisition budget, optimal price or fixed A/B-test sample size is justified yet. A later SEM plan should use observed contribution and funnel conversion to establish an affordable acquisition cost.

## Decisions for the review

- Choose option A or B; my recommendation is B delivered in a small, measured first version.
- Decide whether one revision and one reply response are the right limits for a single stay.
- Agree on the trip access window and the rewrite/refund promise before offering either publicly.
- Keep $7 for the first offer test, or explicitly prioritise testing $9 despite the limited pricing evidence.

Implementation sequence after agreement: quality evaluation and input corrections; package and saved-access changes; worked examples and offer presentation; measured price experiment; then acquisition work. Only the separately authorised loyalty selection feature has been implemented locally. No deployment or price change has been performed in this review.

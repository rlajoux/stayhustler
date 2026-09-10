# StayHustler: CMO website and copy review

Prepared 10 September 2026. Objective: increase completed paid purchases.

This review and copy deck was approved for website implementation on 10 September 2026. It does not authorise price changes, advertising or publication. The live homepage, About page, guides and tools hubs, and purchase pages were inspected in the browser. Individual article, tool, results and lifecycle details were also checked in the repository. No new paid transaction or live model-quality evaluation was performed for this review.

## 1. The commercial decision

Keep the new travel-site design. Change what it helps customers understand.

The site now looks credible and shows the $7 price clearly. It also explains that the customer sends the request and the hotel decides. Those are strengths. The weakness is that the customer still has to infer why this package is worth buying when writing a polite hotel email is easy to do elsewhere.

I would position StayHustler around a specific task: preparing a suitable request for a hotel the customer has already booked. Lead with room upgrades and late checkout. Make the email, timing advice and reception script visible as a complete package. Keep other requests available, but give them less prominence until purchase data supports equal treatment.

The initial audience is a hypothesis: travellers with an existing booking and a specific request who value convenient preparation. We have not established which traveller segment or request type converts best.

Keep $7 for the first marketing revision. A price increase, a new package and new positioning tested together would make the result difficult to interpret. The earlier $9 and three-stay offer proposals remain separate options for review.

### What marketing can honestly sell today

- A personalised email based on the supplied booking and preferences.
- Three timing tips and a short script for reception.
- Copying, email delivery and a saved request with a recovery link available for 30 days after purchase.
- A single $7 USD payment for one stay, subject to any valid discount.
- A self-service product using AI to prepare the wording. The customer reviews and sends it.

The ten-programme loyalty feature is committed and pushed on the feature branch, but was not live during this review. Programme-aware marketing needs to wait for deployment and verification.

Do not advertise reply assistance, revisions, human review, live loyalty connections, points balances, property research or access throughout the trip. Those are not current capabilities. Do not promise a higher upgrade success rate: the product tests do not establish that outcome.

## 2. Positioning, tagline and voice

**Recommended positioning:** Personalised hotel requests for travellers who have already booked.

**Recommended tagline:** Hotel requests, made personal.

**One-sentence explanation:** Get a personalised email, timing advice and a short reception script for the hotel request you want to make.

**Recommended hero headline:**

> Ask for a better room.
> Or a little more time.

This headline names two concrete customer desires without claiming the hotel will grant them. It is a proposed starting point, not a proven conversion winner. The existing “You’ve booked the hotel. Now make more of your stay.” is a reasonable broader control if traffic supports a comparison.

Write like a useful travel service: specific, calm and practical. Use “room upgrade”, “late checkout”, “email”, “reception” and “your hotel”. Cut generic language such as “the little extras”, “hotel know-how” and “any enhancement” where a concrete description would work. Remove “insider”, “secret window” and unsupported odds language.

Keep StayHustler as the name for this revision. A possible association with gaming hotels is a brand hypothesis, not an observed customer reaction. Test comprehension before considering the cost of a rename. Avoid visual or verbal suggestions that this is an official hotel partner or a booking service.

## 3. Homepage: the proposed page and replacement copy

### Navigation

Use **How it works**, **Example package**, **Hotel guides** and a secondary **Free tools** link. Keep **Help** accessible. The main header button is **Build my hotel request**. On mobile, preserve one obvious primary action and put secondary navigation in the menu.

“Hotel requests” currently says little about what the link will reveal. Anchor links to the package and explanation are more useful for a new visitor deciding whether to pay.

### Hero

Eyebrow:

> FOR THE HOTEL YOU’VE ALREADY BOOKED

Headline:

> Ask for a better room.
> Or a little more time.

Supporting copy:

> Get a personalised hotel request, advice on when to send it and a short script for check-in.

Primary button:

> Build my hotel request

Secondary link:

> See an example package

Price and reassurance beside the primary action:

> $7 USD for one stay. One payment. No subscription.
>
> You send the request. Your hotel confirms what’s possible.

Keep the existing hotel and destination entry fields if usability checks show that they help people start. Preserve entered details and the chosen request throughout the flow. Label the block **Start with your booking** so the form does not resemble an accommodation search engine.

Make **Room upgrade** and **Late checkout** the two prominent request choices. Place **Other requests** beside them, revealing breakfast, lounge access, a better view and other supported options. This is an interaction change requiring implementation; it is not accomplished by copy alone.

### Put the package example immediately after the hero

Current issue: the homepage already has a labelled illustrative email. However, it sits after lifestyle cards and does not demonstrate the timing advice or reception script. Move a fuller example above those cards.

Section heading:

> See what your $7 includes

Introduction:

> An email to send before your stay. Advice on when to ask. A short script for reception.

Use a visible scenario label and show all three deliverables together. On mobile, keep the scenario and first useful lines visible without requiring a carousel interaction.

#### Draft example for the page

**Illustrative example: requesting a room upgrade for a three-night stay. This is example copy, not a customer result.**

**Email subject**

> Room upgrade enquiry for 13 October

**Email**

> Hello,
>
> I’m looking forward to my stay from 13 to 16 October. I’ve booked a Deluxe King room under reservation [Confirmation Number].
>
> If a higher room category is available for the full stay, would you be able to consider an upgrade? Please let me know whether there would be an additional charge before making any change to my booking.
>
> Thank you,
> [Your Name]

**Timing advice**

> Ask whether the hotel can consider your request before arrival. If it cannot confirm in advance, ask when to check again. You can also raise the request at reception during check-in.

**Reception script**

> Hello, I wanted to check whether an upgrade might be available for my stay. Could you let me know about any additional charge before changing my booking?

Caption:

> Your package uses the booking details and preferences you provide. Review it and add your name and reservation number before sending.

This is an editorial draft. Validate representative real generator outputs against this standard before presenting it as representative of what customers will receive. An example must not quietly promise a level of quality the paid output cannot reproduce.

Later, add an equally complete late-checkout example and a programme-aware example after that feature is live. Do not fabricate customer names, hotel approvals, savings or endorsements.

**Payment boundary:** public examples are generic. The pre-payment review shows the customer's details and package contents. Their personalised, ready-to-send output stays behind verified payment. Do not deliver it to an unpaid browser and hide it with blur or CSS.

### Explain the package through the customer's actions

Heading:

> Prepare your request before you arrive

| Component | Proposed copy |
| --- | --- |
| Your email | A concise request based on your booking and what you want to ask for. Review it, add your details and send it to your hotel. |
| Your timing advice | Guidance on when to raise the request and when to confirm it with the hotel. |
| Your reception script | A short way to ask in person when you arrive. |
| Saved access | Keep the email and return to your saved request for 30 days after purchase. |

Price block:

> One hotel stay. One request package.
>
> **$7 USD**
>
> No subscription. Any charge for a hotel benefit is separate and must be agreed with the hotel.

Button: **Build my hotel request**.

Avoid stacking multiple panels that repeat this same list. One clear package explanation and a compact checkout summary are sufficient.

### Use-case cards

**Room upgrade**

> Ask whether a higher room category is available for your stay.

Button: **Prepare an upgrade request**.

**Late checkout**

> Ask whether you can keep your room longer on departure day.

Button: **Prepare a late-checkout request**.

**Something else in mind?**

> Prepare a request for breakfast, lounge access, a better view or another hotel benefit.

Button: **See other requests**.

These labels are more informative than “A room to settle into”, “A little longer on holiday” and “Find your extra”. Retain useful travel photography, but reduce decorative sections if they delay understanding the product.

### How it works

Heading:

> From your booking to your hotel request

1. **Add your booking.** Tell us your hotel, dates and room type.
2. **Choose your request.** Add relevant preferences and review your details.
3. **Pay, then receive your package.** Review your personalised wording and send it to your hotel.

Do not suggest that the personalised email is visible before payment. Avoid a measured completion-time claim until there is evidence for it.

### Loyalty section, after deployment

Heading:

> Already have hotel loyalty status?

Body:

> Choose your programme and tier to see published benefits and include relevant membership details in your request.

Clarification:

> You select your membership details. StayHustler does not connect to your loyalty account or check your points balance.

Link: **See supported programmes**.

List the actual ten supported programmes and their source-check dates on the supporting view. Keep published benefit information free to inspect. The paid value is the personalised request package, not access to public programme rules.

A source-backed benefit is still conditional on the programme, booking and property. Do not convert the traveller's selected tier into a claim of verified membership or guaranteed eligibility.

### Trust section

Heading:

> Clear about what we do

Body:

> StayHustler uses your booking details and AI to prepare your request. You review and send the message. Your hotel handles availability, eligibility and any additional charges.

Use links to **About StayHustler**, **How we use your information** and **Contact support**. Add a genuine founder photo and approved, verifiable travel-industry credentials when available. A real identity is more useful than an anonymous initials badge or an unsupported “insider” claim.

Do not add star ratings, customer counts or hotel logos implying endorsement before there is evidence and permission to use them.

### FAQ replacement

**What am I paying for?**

> A personalised hotel request email, three timing tips and a short reception script for one stay. Your package is saved and an email gives you a link to return to it.

**Does this guarantee an upgrade or late checkout?**

> No. Your hotel decides what it can offer. Availability, your booking and the hotel's rules can affect the answer. The $7 is for your request package, not a hotel benefit.

**Will StayHustler contact my hotel?**

> No. You check the wording and send it yourself, using your hotel's contact details or your booking's messaging service.

**Could I write the request myself?**

> Yes. Our guides include free examples you can adapt. The paid package brings together wording based on your booking, timing advice and a reception script in one place.

**Is the wording generated with AI?**

> Yes. AI uses the booking details and preferences you provide to prepare the package. Review the wording before sending it. StayHustler does not access the hotel's reservation system.

**Could the hotel charge for my request?**

> It may. An upgrade, late checkout or another benefit can have a separate hotel charge. Check the price and conditions with the hotel before agreeing to a change.

**How long can I access my request?**

> Your saved request and recovery link are available for 30 days after purchase. Keep a copy if your stay is further away.

**What if my request is not delivered?**

> Contact support@stayhustler.com with your order reference. We will help resolve a technical delivery problem or issue a refund, as described in our terms.

The current terms do not promise a satisfaction refund once content has been generated. Do not imply one in this FAQ. Any broader service guarantee needs a separate approved policy and operating process.

### Closing action and newsletter

Final purchase block:

> **Have your booking ready?**
>
> Prepare the request you want to make before you arrive.
>
> **Build my hotel request**
>
> $7 USD for one stay. No subscription.

Move newsletter signup below this action or into the footer. It is a secondary path, not a competing offer halfway through the buying decision.

Newsletter heading: **Hotel request tips for your next stay**.

Body: **Get practical advice on upgrades, late checkout and hotel benefits by email.**

Button: **Send me hotel tips**.

Reassurance: **Unsubscribe at any time. Read our privacy policy.**

Do not promise a weekly frequency or a free reward unless it is actually maintained and delivered.

Footer line: **Personalised requests for the hotel you've booked.**

## 4. CTA system across the journey

Use a consistent entry action, then make each later button describe the next step. A customer should not have to guess whether a button generates text, opens a review or starts payment.

| Location | Proposed primary CTA | Adjacent context |
| --- | --- | --- |
| Homepage and global header | Build my hotel request | $7 USD for one stay |
| Room-upgrade content | Prepare an upgrade request | Keep the request type selected when the form opens |
| Late-checkout content | Prepare a late-checkout request | Keep the request type selected when the form opens |
| Booking page | Continue to preferences | Preserve any request already selected |
| Preferences page | Review my details | Explain that this is a booking summary |
| Review page | Continue to payment · $7 | The personalised package follows payment |
| Payment page | Continue to Stripe · $7 | This button redirects to Stripe |
| Results page | Copy email | Separate Copy subject and Open in my email app actions |
| Guide with a generic example | Tailor this to my stay | $7 for a personalised package |
| Free tool result | Build my hotel request | Explain the paid package explicitly |
| Feedback | Share my feedback | No public testimonial permission implied |

Prices in buttons are illustrative at the current base price. Render the actual server-quoted price, including a valid discount. Do not hard-code a contradictory $7 label alongside a discounted checkout amount. Keep ordinary “Back” and “Edit” links for navigation.

## 5. Booking, preferences and review copy

### Booking

H1: **Tell us about your booking**.

Introduction:

> Add the details of the hotel you've already booked. We'll use them to prepare your request.

Field guidance:

| Field | Proposed helper |
| --- | --- |
| Hotel | Use the name shown on your confirmation. |
| Destination | The city or area where you're staying. |
| Dates | Enter your check-in and check-out dates. |
| Room type | Copy the room name from your booking confirmation. |
| Booking channel | How did you book this stay? This can affect which membership benefits apply. |
| Property type | Is this an independent hotel or part of a chain? |

Keep one short reassurance near the form: **We don't access your reservation or contact your hotel.** Avoid repeating a list of limitations under several fields.

The property-type question has limited explanatory value for a customer. Assess whether the product still needs it before changing or removing it. Copy cannot fix an unnecessary input requirement by itself.

### Preferences

H1: **What would make your stay better?**

Introduction:

> Choose your main request. Add any relevant preferences so the wording fits your stay.

Keep terminology identical to the homepage. Replace “Any enhancement” with **Another hotel benefit** only if the flow lets the customer specify what that means. Otherwise retain a clearly explained flexible choice: **I'm flexible** / **A better room, more time or another available benefit.**

Occasion field: **Special occasion? Optional.**

Helper: **Include it only if you'd like it mentioned in your request.**

Arrival-time question: **When do you expect to arrive?**

Helper: **This helps us phrase your request for check-in.** Remove the broad implication that the answer reliably predicts upgrade availability.

A later product improvement should ask for the desired departure time when late checkout is selected. Do not advertise a request tailored to an exact preferred time unless the product actually collects and uses it.

The email/in-person/both choice currently needs clearer purpose because the package supplies an email and script. Rename it **How do you expect to ask?** if it changes emphasis. Remove it later if it does not affect the output.

### Loyalty fields

After the already-built feature is deployed:

> **Your hotel membership**
>
> Choose your programme and tier to see relevant published benefits.

Labels: **Programme** / **Membership tier**.

Participation confirmation:

> This hotel participates in [programme].

Helper:

> Confirm this before we include your selected membership in the request.

Benefit-card introduction:

> Based on the programme and tier you selected.

Keep the actual booking exclusions, availability conditions and source links visible. Consolidate repeated verification warnings, but preserve the distinction between a selected tier and verified entitlement. Hotel or programme changes must continue to clear the confirmation.

### Review

H1: **Review your details**.

Introduction:

> Check your booking and selected request before continuing to payment.

Show the hotel, dates, room, request and relevant membership details with direct **Edit** links. Follow with one package summary:

> **Your package for this stay**
>
> Personalised email · Three timing tips · Reception script
>
> **$7 USD. One payment. No subscription.**
>
> Your personalised package is prepared after payment.

Button: **Continue to payment · $7**.

Remove repeated “How it works” sales sections at this stage. The customer needs confidence in their details and the purchase, not another homepage.

## 6. Payment copy

H1: **Your hotel request package**.

Summary:

> One personalised email, three timing tips and a reception script for your stay at [hotel].

Email label: **Email for your request**.

Helper:

> We'll send your request and a link to your saved package to this address.

Price:

> **$7 USD**
>
> One payment for one stay. No subscription.

Button:

> Continue to Stripe · $7

Reassurance:

> Secure card payment through Stripe.

Scope:

> You're buying the request package. Your hotel decides what it can offer and whether any hotel charge applies.

Keep links to terms, privacy and support within easy reach. Keep the promo-code field secondary. Remove **Why we charge** and its explanation about funding the business: it centres the seller's costs instead of the buyer's useful result.

Remove **Best used 24–72 hours before check-in** as a universal instruction. If timing affects whether the product can help, use booking-aware guidance based on supported rules. Do not create artificial urgency for an early booking or imply the service is useless for a same-day stay without evidence.

A later flow test could combine review and payment details to reduce a step. That requires implementation, payment-state checks and measurement. Do not change it as an incidental copy edit.

## 7. Results, recovery and feedback

### Successful preparation

Page title and H1: **Your hotel request is ready**.

Introduction:

> Check the details, add your name and reservation number, and send the message to your hotel.

Sections: **Your email** / **When to ask** / **What to say at reception**.

Actions: **Copy email**, **Copy subject**, **Open in my email app**, **Print or save as PDF**.

Email-app helper: **Add your hotel's email address before sending.** Do not imply that the app already knows the hotel's recipient address.

Saved-access note:

> Keep a copy for your trip. Your saved request is available for 30 days after purchase.

Remove “insider request” from the document title and sharing metadata. Do not label the reception script a “fallback” to the customer; it is a useful part of the purchased package.

### State-specific messages

| Verified state | Proposed copy |
| --- | --- |
| Paid, generation pending | Payment received. We're preparing your hotel request. |
| Paid order saved, retry pending | Your order is saved. We're still preparing your request and will email you when it's ready. |
| Output ready, email delivery unconfirmed | Your request is ready here. Email delivery is not confirmed yet. You can copy it now or resend the email below. |
| Generation failed and support needed | We couldn't prepare your request. Contact support@stayhustler.com with order [reference] for help or a refund. |
| Payment cannot yet be verified | We couldn't confirm payment yet. If you've paid, use your order email or contact support before trying again. |
| Access expired | This saved link has expired. Check the copy in your order email, or contact support for help. |

Only show “Payment received” after server verification. Free grants need different wording. Remove technical details such as the number of generation attempts from customer-facing failure messages. Do not promise recovery of deleted content or another payment attempt as the default remedy.

### Transactional email

These are copy proposals for existing transactional messages, not authorisation to send mail.

Ready subject: **Your hotel request is ready | StayHustler**.

Opening:

> Your request for [hotel] is ready. Review the wording, add your name and reservation number, and send it to your hotel.

Button: **Open my request**.

Retain the existing useful content in the email and the access-expiry explanation. Do not insert discount campaigns or newsletter enrolment into a purchase confirmation.

Pending subject: **Your StayHustler order is saved**.

Opening:

> We've saved your order for [hotel]. Your request is still being prepared. We'll send another email when it's ready.

Use this only where the actual workflow sends that later email. Existing receipt, ready and retry states must stay distinct.

### Feedback and repeat use

H1: **How did your hotel request go?**

Introduction:

> Tell us what happened. Your feedback helps us improve the service.

Button: **Share my feedback**.

Later, collect three different facts: whether the customer used the package, whether it was useful, and what the hotel offered. They answer different questions. Do not interpret an accepted hotel request as proof that StayHustler caused the outcome.

Thank-you copy: **Thanks for sharing your experience.**

Secondary action: **Prepare a request for another stay** with the normal price visible. Avoid pushing a subscription or another purchase as the first response to reported dissatisfaction.

Obtain explicit permission before turning feedback into a public testimonial. Check legacy save, return and feedback routes for actual reachability before spending time rewriting inactive screens.

## 8. About page and credibility

The current About page combines a useful founder story with broad claims about how hotels make decisions. The assertion that upgrade decisions happen 24–72 hours before arrival rather than at reception is too universal. Remove it unless a narrowly scoped claim can be supported.

Proposed H1: **A clearer way to ask your hotel**.

Proposed introduction:

> StayHustler helps travellers prepare requests for hotels they've already booked. Choose what you'd like to ask for, add your booking details and receive an email, timing advice and a short reception script.

Founder paragraph, explicitly for Raphael to approve:

> I built StayHustler to make hotel requests easier to prepare. The aim is straightforward: useful wording, clear expectations and a traveller who feels ready to ask.

Add approved career details with specific roles or organisations and a profile link. The site currently claims 20 years in travel technology; this review has not independently verified that biography. Do not expand it into invented hotel-operating experience or claim affiliations from the founder's previous employment.

Add **How our guidance is prepared** explaining supplied booking inputs, AI-generated wording, human review by the customer, and maintained programme sources where applicable. Publish a contactable support address. Do not describe the service as hotel-approved or expert-reviewed unless that process exists.

## 9. Guides: editorial and conversion changes

The guides should solve the question that brought the reader there, then show when the paid package is useful. Free useful content and a paid personalised package can coexist. Withholding a generic template would weaken the content without creating a durable advantage.

| Existing article | Proposed title | Required editorial change |
| --- | --- | --- |
| How to ask for a hotel upgrade | How to ask for a hotel room upgrade | Put a practical example near the top. Distinguish a request from an entitlement and ask about charges. |
| Best time to ask for hotel upgrade | When to ask a hotel for an upgrade | Replace the universal timing window with context and sourced exceptions. Do not dismiss reception requests. |
| Hotel upgrade email template | Hotel upgrade email template and examples | Provide genuinely useful generic examples, explain what to customise, then offer the paid package. |
| Upgrade myths that don't work anymore | Hotel upgrade advice: claims to treat with caution | Avoid asserting that tactics used to work without evidence. Explain uncertainty and property differences. |
| How hotel inventory systems work | How room availability affects upgrade requests | Remove suggestions of access to live hotel systems or universal allocation rules. Source operational claims. |
| Independent vs chain hotel upgrades | Asking independent and chain hotels for an upgrade | Avoid blanket rankings. Explain the difference between published programme benefits and property discretion. |
| Late checkout vs room upgrade | Late checkout or a room upgrade: choosing your request | Help the reader choose based on their actual stay and priorities, without invented expected-value estimates. |
| Does loyalty status get upgrades | Hotel loyalty upgrades: what your tier may include | Use the maintained programme catalogue and primary terms. Clearly show exclusions and checked dates. |
| How StayHustler improves your upgrade chances | What a StayHustler hotel request includes | Make this a transparent product explanation. Remove causal success and secret-window claims. |

Keep existing URLs by default. A change in heading does not require a URL migration. Review search traffic and backlinks before considering redirects, particularly for the self-promotional article.

A standard article should have a direct answer, a useful example, relevant limitations, identifiable authorship, sources and a meaningful reviewed date. Use only genuinely reviewed dates, not an automatically refreshed badge. Google recommends useful original content, clear sourcing and information about who created it. [Google's helpful-content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)

Contextual CTA example:

> **Want this tailored to your booking?**
>
> Get a personalised email, timing advice and a reception script for your stay.
>
> **Tailor this to my stay**
>
> $7 USD. One payment. No subscription.

Place it after a useful example and at the end. Avoid interrupting the opening answer with repeated sales panels. Preserve the article's request type when entering the form.

## 10. Free tools need a product correction

### Upgrade Probability Checker

The current fixed-weight score and ratings imply a measured probability model. The repository does not establish predictive validation. Relabelling the heading while retaining “good odds” and a score bar would leave the underlying problem intact.

Proposed replacement: **Hotel request planner**.

Introduction:

> Check the details to consider before asking your hotel for an upgrade.

Results should explain known booking facts, benefits to verify, availability questions and the next action. Remove numerical odds, ranked likelihood labels and unsupported multipliers. Programme guidance should use the shared maintained catalogue rather than generic Gold/Silver assumptions.

This requires logic changes. Until corrected, reduce its prominence and avoid using its score as a conversion device.

### Email Send-Timing Calculator

The current calculation uses a fixed 24–36-hour window relative to an assumed 3pm check-in. It cannot establish an exact best time for a particular hotel.

Proposed replacement: **When to contact your hotel**.

Introduction:

> Plan when to raise your request and what to confirm with the hotel.

Use date-aware practical guidance with explicit assumptions and no “maximum impact” or universal optimum. Same-day, future and already-started stays need distinct handling. Unsupported exact send times should be removed, not cosmetically softened.

A suitable result CTA is **Prepare my hotel request**, with the $7 price and package contents visible.

## 11. Search snippets, social previews and landing pages

Proposed homepage title:

> Hotel Upgrade & Late Checkout Requests | StayHustler

Proposed meta description:

> Prepare a hotel upgrade or late-checkout request for your booking. Get a personalised email, timing advice and a reception script. $7 per stay.

Proposed social title:

> Ask for a better room. Or a little more time.

Social description:

> A personalised hotel request, timing advice and a reception script. $7 USD for one stay.

Use an actual product example alongside hotel imagery in the share image, with no fabricated success badge. Remove “under 2 minutes” until typical completion and delivery times are measured. Keep page titles, visible headings, social metadata and structured data consistent. Google may generate a different search title; this is not a guarantee of exact display. [Google title-link guidance](https://developers.google.com/search/docs/appearance/title-link)

Preserve noindex on private results, checkout and other transaction pages. Match FAQ structured data to visible copy if it is retained; do not promise FAQ rich results. Do not add review ratings without genuine eligible reviews.

Start with two distinct commercial landing-page proposals:

| Search intent | Suggested page | Heading and message |
| --- | --- | --- |
| Help asking for an upgrade | /hotel-upgrade-request | Ask your hotel about a room upgrade. A personalised request, timing advice and a reception script for your booking. |
| Help requesting late checkout | /late-checkout-request | Need a later checkout? Prepare your request. Get wording to ask your hotel, timing advice and a reception script. |

Each needs its own useful example, relevant FAQ, visible $7 price and a form with the matching request selected. Do not create dozens of almost identical destination or loyalty-tier pages merely to target more keywords.

For SEM, carry the same request, price and promise from the advert to the page. Google explicitly recommends matching landing-page relevance to the advert and its call to action. [Google Ads landing-page guidance](https://support.google.com/google-ads/answer/6238826?hl=en)

Do not advertise “free upgrades”, guaranteed outcomes or official hotel relationships. Keep broad paid acquisition on hold until verified conversion, contribution and fulfilment data can support an acquisition budget. No traffic or return forecast is established here.

## 12. Copy consistency and claims to remove

| Current pattern | Action |
| --- | --- |
| Improved upgrade chances, better odds, reliable probability ratings | Remove unless supported by appropriately designed outcome evidence. |
| Universal 24–36-hour or 24–72-hour decision windows | Replace with qualified, sourced guidance and booking-aware assumptions. |
| Insider request, hotel secrets, privileged operational access | Replace with a precise description of the actual service. |
| Immediate delivery or a fixed completion time | Use state-specific delivery wording; measure latency before adding a time promise. |
| Generic Gold/top-tier benefits | Use programme-specific tiers and conditions after the feature is deployed. |
| Free hotel benefits implied by the $7 package | Explain that hotel charges are separate and require agreement. |
| Multiple negative disclaimers repeated at every step | Consolidate into one clear scope statement and accessible details. |
| “Why we charge” company-cost explanation | Show the useful package and example instead. |
| “Personalized”, “program” and “check-out” used inconsistently | Standardise editorial copy to personalised, programme and late checkout; preserve official names. |

Audit visible copy, metadata, JSON-LD, form states, transactional emails and support messages together. Legacy documentation such as the older odds-microcopy guide should be marked superseded when implementation changes, so it does not reintroduce removed claims.

Terms currently include an improved-chances statement and immediate-delivery language. Align those descriptions with actual service behaviour. This review does not assess the legal validity of the terms or authorise a substantive refund-policy rewrite.

## 13. Price, value and evidence

Free general-purpose writing is a real alternative; ChatGPT has a free plan. That establishes an available substitute, not a finding that either product's output is better. [ChatGPT plans](https://chatgpt.com/pricing/)

The current package should justify its price through a convenient booking flow, useful request-specific guidance and coherent deliverables. Copy alone cannot create that advantage. Evaluate real outputs against free alternatives using identical booking facts before claiming superior quality.

I would not use “less than a coffee”, fictional $49 crossed-out values, invented hotel savings, countdowns or blanket discounts. Keep the actual package, sample and price together. Separate full-price purchases from existing coupon use when assessing results.

A broader quality promise, one revision, reply help and saved access through the trip could make a stronger future offer. They require product and policy changes first. Do not borrow those promises from the earlier proposal to improve today's sales copy.

## 14. Delivery order and success measures

| Priority | Work | Verification |
| --- | --- | --- |
| 1 | Remove unsupported operational, probability and outcome claims across pages and metadata. | Claim inventory checked against source evidence; tool logic corrected where needed. |
| 2 | Publish the clearer homepage offer and complete representative example at $7. | Target travellers can explain what they buy, who sends it, what the hotel decides and when they pay. |
| 3 | Align booking, preferences, review and payment copy; preserve inputs and actual price. | Mobile and desktop purchase-flow checks, including discounts and payment return states. |
| 4 | Deploy and verify the already-built loyalty feature, then add the related marketing. | Programme, tier, hotel confirmation and generated wording remain consistent. |
| 5 | Rewrite the guides and tools; add two intent-specific landing pages. | Accurate guidance, useful examples, matched CTAs, sensible indexation and redirects only where justified. |
| 6 | Assess customer usefulness, then test price or acquisition separately. | Verified purchase and contribution data, delivery quality and a predefined decision rule. |

Primary measure: completed paid purchases per eligible unique visitor, with purchase confirmation from the payment system. Define the attribution and refund follow-up windows before comparing periods. Exclude internal tests, free grants and bots where identifiable; report coupons separately.

Track request started, details reviewed, checkout started and verified payment to locate friction. Segment by request type, device and acquisition source. Monitor successful generation, time to usable output, refunds and support demand so higher conversion does not conceal worse delivery.

Measure whether customers copy or use the package and whether they find it useful. Treat reported hotel outcomes as observational feedback. Do not convert those reports into an implied causal upgrade rate.

Begin with a small qualitative review by target travellers if traffic is low. After a coherent first revision, test one material proposition at a time. There is no verified baseline here from which to claim uplift, an optimal price, a sufficient A/B sample size or an affordable advertising budget.

## Recommendation for approval

Approve the marketing direction first: a specific hotel-request service, two leading use cases, a complete public example, one clear $7 package and honest programme-aware guidance once deployed. Implement the claim corrections and copy changes as a bounded release. Keep broader offer additions and price tests separate.

The approved website and copy changes were subsequently implemented on the feature branch. The $7 price and verified-payment boundary remain unchanged. No campaign or production publication was performed by this review.

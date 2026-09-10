// Shared by the static form and API. Sources were reviewed on the version date.
(function () {
    'use strict';
    /** @typedef {{status: string, detail: string}} Benefit */
    /** @typedef {{id: string, name: string, benefits: Record<string, Benefit>}} Tier */
    const version = '2026-09-10';
    const categories = { upgrade: 'Room upgrade', arrival: 'Early check-in', checkout: 'Late checkout', breakfast: 'Breakfast', lounge: 'Lounge access' };
    const requestCategories = { upgrade: ['upgrade'], late_checkout: ['checkout'], breakfast_lounge: ['breakfast', 'lounge'], better_view: ['upgrade'], credit_spa_fb: [], any_upgrade: ['upgrade', 'checkout', 'breakfast', 'lounge'] };
    const available = detail => ({ status: 'Subject to availability', detail });
    const conditional = detail => ({ status: 'Check conditions', detail });
    const choice = detail => ({ status: 'Requires a choice or reward', detail });
    const unknown = { status: 'Not verified', detail: 'No general tier entitlement established in the reviewed sources. You can still ask the hotel.' };
    /** @param {string} id @param {string} name @param {Partial<Record<string, Benefit>>} benefits @returns {Tier} */
    const tier = (id, name, benefits = {}) => ({ id, name, benefits: { ...Object.fromEntries(Object.keys(categories).map(key => [key, unknown])), ...benefits } });

    const marriottGold = { upgrade: available('Enhanced room at participating brands.'), checkout: available('Up to 2 pm.') };
    const marriottPlatinum = {
        upgrade: available('Enhanced room, including selected suites; brand and room exclusions apply.'),
        checkout: conditional('Up to 4 pm. Availability applies at resorts, convention hotels, Design Hotels and StudioRes. Apartments guarantees 2 pm; some brands are excluded.'),
        breakfast: choice('A welcome choice at selected brands. Other brands offer points or food credit instead.'),
        lounge: conditional('Participating brands and properties only; resort and regional exceptions apply.')
    };
    const hiltonGold = {
        upgrade: available('At participating brands, up to Executive Floor room types.'),
        checkout: available('On request; no fixed programme-wide time.'),
        breakfast: choice('MyWay continental breakfast or food/beverage credit, depending on brand and region.'),
        lounge: conditional('Only when an eligible room upgrade includes Executive Lounge access.')
    };
    const hiltonDiamond = { ...hiltonGold, upgrade: available('At participating brands, up to a one-bedroom suite.'), lounge: conditional('Executive Lounge access where eligible; member plus one registered guest.') };
    const ihgBase = { checkout: available('Up to 2 pm, on request.') };
    const ihgPlatinum = { ...ihgBase, upgrade: available('May include suites; property exclusions apply. Club-room upgrades do not add lounge access.'), arrival: available('On request; the hotel sets the time.') };
    const hyattDiscoverist = { upgrade: available('Preferred room within your booked category.'), checkout: conditional('2 pm on request. Availability applies at resorts, casinos and Destination Residences; exclusions apply.') };
    const accorSilver = { checkout: available('On request; the hotel sets the time.') };
    const accorGold = { ...accorSilver, upgrade: available('Next category, or an enhanced room within the booked category. Brand and room exclusions apply.'), arrival: available('Early check-in OR late checkout; the hotel sets the time.') };
    const accorPlatinum = { ...accorGold, arrival: available('Early check-in AND late checkout; the hotel sets the times.'), breakfast: conditional('Daily at eligible Asia-Pacific hotels; country and property exclusions apply. Confirm the breakfast venue.'), lounge: conditional('At participating hotels. Fairmont Gold Lounge requires Diamond or Limitless.') };
    const accorDiamond = { ...accorPlatinum, breakfast: conditional('Eligible Asia-Pacific daily breakfast, plus weekend breakfast elsewhere. Country, weekend-day and property rules apply.'), lounge: conditional('At participating hotels, including eligible Fairmont Gold Lounges; guest and child limits apply.') };
    const wyndhamGold = { upgrade: available('Preferred room within the category booked, not a higher room category.'), checkout: available('Up to two hours after the hotel’s normal checkout time.') };
    const wyndhamPlatinum = { ...wyndhamGold, arrival: available('Up to two hours before the hotel’s normal check-in time.') };
    const wyndhamDiamond = { ...wyndhamPlatinum, upgrade: available('Suite upgrade at check-in where suites are available; advance reservation required.') };
    const choiceGold = { upgrade: available('Selected Cambria/Ascend hotels worldwide and selected Radisson brands in the Americas. No category guaranteed.'), arrival: available('Up to two hours before normal check-in.'), checkout: available('Up to 2 pm in the US, Canada, Mexico, Central America and Caribbean; up to two hours later in other covered regions.') };
    const choiceDiamond = { ...choiceGold, breakfast: conditional('Member plus one registered guest at participating restaurants of selected Radisson brands in the Americas.') };
    const bestWesternPlatinum = { arrival: available('At participating hotels; no fixed time in the reviewed grid.'), checkout: available('At participating hotels; no fixed time in the reviewed grid.') };
    const radissonPremium = { upgrade: available('Next room category.'), arrival: available('Up to two hours before normal check-in.'), checkout: available('Up to two hours after normal checkout.') };

    const programmes = [
        {
            id: 'accor', name: 'ALL Accor', ota: 'excluded',
            note: 'Eligible stays only. Upgrade exclusions include ibis, ibis Styles, Adagio and JO&JOE. Breakfast country and venue rules need confirmation. Suite Night Upgrades are separate rewards.',
            sources: ['https://all.accor.com/loyalty-program/cards-status-benefits-details/index.en.shtml', 'https://all.accor.com/a/en/loyalty-program/legal/terms-and-conditions.html', 'https://all.accor.com/loyalty-program/user/hotels-lounge/index.en.shtml?menu=2'],
            tiers: [tier('classic', 'Classic'), tier('silver', 'Silver', accorSilver), tier('gold', 'Gold', accorGold), tier('platinum', 'Platinum', accorPlatinum), tier('diamond', 'Diamond', accorDiamond), tier('limitless', 'Limitless (invitation only)', accorDiamond)]
        },
        {
            id: 'best_western', name: 'Best Western Rewards', ota: 'excluded',
            note: 'Third-party reservations do not qualify for elite benefits. Gold adds selected arrival amenities; the reviewed grid does not establish general upgrade, breakfast or lounge rights.',
            sources: ['https://www.bestwestern.com/en_US/best-western-rewards.html', 'https://www.bestwestern.com/en_US/legal/bwr-terms-conditions.html'],
            tiers: [tier('blue', 'Blue'), tier('gold', 'Gold'), tier('platinum', 'Platinum', bestWesternPlatinum), tier('diamond', 'Diamond', bestWesternPlatinum), tier('diamond_select', 'Diamond Select', bestWesternPlatinum)]
        },
        {
            id: 'choice', name: 'Choice Privileges', ota: 'benefit-specific',
            note: 'Includes participating Radisson hotels in the Americas, not Radisson hotels elsewhere. Eligibility varies by benefit, rate and property. Titanium’s annual travel award requires separate redemption.',
            sources: ['https://www.choicehotels.com/choice-privileges/benefits', 'https://www.choicehotels.com/choice-privileges/rules-regulations'],
            tiers: [tier('member', 'Member'), tier('gold', 'Gold', choiceGold), tier('platinum', 'Platinum', choiceGold), tier('diamond', 'Diamond', choiceDiamond), tier('titanium', 'Titanium', choiceDiamond)]
        },
        {
            id: 'gha', name: 'GHA DISCOVERY', ota: 'excluded',
            note: 'Eligible rates and participating hotels only. Special suites, villas and residences may be excluded. Request early arrival at least two days ahead and late checkout at arrival. Club-floor upgrades do not automatically include lounge access.',
            sources: ['https://www.ghadiscovery.com/gha-discovery-benefits', 'https://www.ghadiscovery.com/terms-conditions'],
            tiers: [tier('silver', 'Silver'), tier('gold', 'Gold'), tier('platinum', 'Platinum', { upgrade: available('One room category.'), checkout: available('Until 3 pm; request at arrival.') }), tier('titanium', 'Titanium', { upgrade: available('Two room categories.'), arrival: available('From 11 am; request at least two days ahead.'), checkout: available('Until 4 pm; request at arrival.'), breakfast: conditional('Only participating brands and hotels; not alliance-wide.') })]
        },
        {
            id: 'hilton', name: 'Hilton Honors', ota: 'excluded',
            note: 'Eligible bookings only. Many limited-service brands exclude upgrades. Breakfast/credit rules vary by brand and region. Diamond Reserve upgrade rewards must be earned and redeemed separately.',
            sources: ['https://www.hilton.com/en/hilton-honors/member-benefits/', 'https://www.hilton.com/en/hilton-honors/terms/', 'https://www.hilton.com/en-gb/help-center/reservations/small-luxury-hotels-partnership/'],
            tiers: [tier('member', 'Member', { checkout: hiltonGold.checkout }), tier('silver', 'Silver', { checkout: hiltonGold.checkout }), tier('gold', 'Gold', hiltonGold), tier('diamond', 'Diamond', hiltonDiamond), tier('diamond_reserve', 'Diamond Reserve', { ...hiltonDiamond, checkout: conditional('4 pm on eligible stays; at Small Luxury Hotels it remains subject to availability.'), lounge: conditional('Eligible Executive Lounges and Premium Clubs; Enclave and other exclusions apply.') }), tier('lifetime_diamond', 'Lifetime Diamond', hiltonDiamond)]
        },
        {
            id: 'ihg', name: 'IHG One Rewards', ota: 'excluded',
            note: 'Eligible bookings only; qualifying group bookings retain on-property benefits. Lounge memberships, suite awards and InterContinental Ambassador benefits are separate from the core tier.',
            sources: ['https://www.ihg.com/onerewards/content/us/en/tier-benefits', 'https://www.ihg.com/content/us/en/customer-care/member-tc/2nd-page'],
            tiers: [tier('club', 'Club Member', ihgBase), tier('silver', 'Silver Elite', ihgBase), tier('gold', 'Gold Elite', ihgBase), tier('platinum', 'Platinum Elite', ihgPlatinum), tier('diamond', 'Diamond Elite', { ...ihgPlatinum, breakfast: choice('Welcome choice at participating brands for member plus one registered guest. Other brands may offer points or credit.') })]
        },
        {
            id: 'marriott', name: 'Marriott Bonvoy', ota: 'excluded',
            note: 'Qualifying rates or award stays only. Benefits concern the member’s room. Vacation-club, residences, partner and other brand exclusions apply. Nightly Upgrade Awards are separate from status.',
            sources: ['https://www.marriott.com/loyalty/member-benefits.mi', 'https://www.marriott.com/loyalty/terms/default.mi', 'https://www.marriott.com/loyalty/member-benefits/guarantee.mi'],
            tiers: [tier('member', 'Member'), tier('silver', 'Silver Elite', { checkout: available('Priority late checkout; no fixed time.') }), tier('gold', 'Gold Elite', marriottGold), tier('platinum', 'Platinum Elite', marriottPlatinum), tier('titanium', 'Titanium Elite', marriottPlatinum), tier('ambassador', 'Ambassador Elite', { ...marriottPlatinum, arrival: available('Your24 through Ambassador Service, requested by 3 pm two days before arrival. Approval determines arrival/departure times.') }), tier('lifetime_silver', 'Lifetime Silver Elite', { checkout: available('Priority late checkout; no fixed time.') }), tier('lifetime_gold', 'Lifetime Gold Elite', marriottGold), tier('lifetime_platinum', 'Lifetime Platinum Elite', marriottPlatinum), tier('lifetime_titanium', 'Lifetime Titanium Elite (retained)', marriottPlatinum)]
        },
        {
            id: 'radisson', name: 'Radisson Rewards', ota: 'allowed',
            note: 'For participating hotels in Europe, the Middle East, Africa and Asia Pacific. Radisson hotels in the Americas need a Choice Privileges check. Property, guest and rate restrictions still apply; some residences and long stays are excluded.',
            sources: ['https://www.radissonhotels.com/en-us/rewards/benefits', 'https://www.radissonhotels.com/en-us/terms-and-conditions'],
            tiers: [tier('club', 'Club'), tier('premium', 'Premium', radissonPremium), tier('vip', 'VIP', { ...radissonPremium, upgrade: available('Best available category, including selected suites; property exclusions apply.'), breakfast: conditional('Member plus one registered companion on eligible stays; Asia-Pacific benefit is buffet breakfast.'), lounge: conditional('Selected VIP areas only, not a universal executive-lounge entitlement.') })]
        },
        {
            id: 'hyatt', name: 'World of Hyatt', ota: 'excluded',
            note: 'Eligible paid rates or award nights only. Upgrade exclusions include Hyatt Place, Hyatt House, Destination Residences and Hyatt Vacation Club. Full partner exclusions are not verified; confirm with the hotel. Suite and Club awards are separate.',
            sources: ['https://world.hyatt.com/content/gp/en/tiers-and-benefits.html', 'https://world.hyatt.com/content/gp/en/my-account/badges/late-checkout.html', 'https://world.hyatt.com/content/gp/en/my-account/badges/room-upgrade.html'],
            tiers: [tier('member', 'Member'), tier('discoverist', 'Discoverist', hyattDiscoverist), tier('explorist', 'Explorist', { ...hyattDiscoverist, upgrade: available('Improved room, excluding suites and Club-access rooms.') }), tier('globalist', 'Globalist', { upgrade: available('Improved room, including standard suites.'), arrival: available('Priority room access; no fixed early-arrival time verified.'), checkout: conditional('4 pm on request. Resorts, casinos and Destination Residences depend on availability; exclusions apply.'), breakfast: conditional('Club breakfast, or full breakfast where no Club lounge exists at participating hotels. Registered-guest limits apply.'), lounge: conditional('Club access at participating properties; exclusions apply.') })]
        },
        {
            id: 'wyndham', name: 'Wyndham Rewards', ota: 'excluded',
            note: 'Qualified paid stays, Free Nights or Points + Cash at participating hotels. Benefits concern the member’s room. No general tier breakfast or lounge entitlement was established. Titanium requires invitation/designation.',
            sources: ['https://www.wyndhamhotels.com/wyndham-rewards/terms/member-levels', 'https://www.wyndhamhotels.com/wyndham-rewards/terms/titanium'],
            tiers: [tier('blue', 'Blue'), tier('gold', 'Gold', wyndhamGold), tier('platinum', 'Platinum', wyndhamPlatinum), tier('diamond', 'Diamond', wyndhamDiamond), tier('titanium', 'Titanium (invitation only)', wyndhamDiamond)]
        }
    ];
    const hyatt = programmes.find(programme => programme.id === 'hyatt');
    hyatt.tiers.push(tier('lifetime_globalist', 'Lifetime Globalist', hyatt.tiers.find(value => value.id === 'globalist').benefits));
    const getProgramme = id => programmes.find(programme => programme.id === id);
    const getTier = (programme, id) => programme?.tiers.find(value => value.id === id);

    function selectionErrors(context) {
        const programme = getProgramme(context.loyaltyProgramme);
        const id = context.loyaltyProgramme;
        const errors = [];
        if (id !== undefined && !['', 'none', 'other', 'unknown'].includes(id) && !programme) errors.push('Unsupported loyalty programme');
        if (programme ? !getTier(programme, context.loyaltyTier) && context.loyaltyTier !== 'unknown' : context.loyaltyTier !== undefined && context.loyaltyTier !== '') errors.push('Select a membership tier for this loyalty programme');
        if (context.loyaltyHotelConfirmed !== undefined && typeof context.loyaltyHotelConfirmed !== 'boolean') errors.push('Hotel participation confirmation must be true or false');
        if (!programme && context.loyaltyHotelConfirmed === true) errors.push('Select a programme before confirming hotel participation');
        return errors;
    }

    function describe(context, booking = {}) {
        const programme = getProgramme(context.loyaltyProgramme);
        if (!programme) return null;
        const selectedTier = getTier(programme, context.loyaltyTier);
        const label = programme.name + (selectedTier ? ` ${selectedTier.name.replace(/\s*\([^)]*\)$/, '')}` : ' (tier not known)');
        let eligibility = 'A guide to your selected tier. Benefits depend on the hotel, rate and guest conditions; your booking has not been verified.';
        const excluded = booking.channel === 'ota' && programme.ota === 'excluded';
        if (excluded) eligibility = 'Your booking is through an online travel agency. Standard programme benefits generally do not apply; ask the hotel to confirm any exception. You can still make a discretionary request.';
        else if (booking.channel === 'ota') eligibility = programme.ota === 'allowed'
            ? 'Radisson permits benefits on online-travel-company rates even when they do not earn points. Property, rate and guest conditions still apply.'
            : 'Online travel agency booking: eligibility differs by benefit. Do not assume all perks apply; confirm with the hotel.';
        return {
            label, programme: programme.name, tier: selectedTier?.name || 'Unknown', version,
            includeStatus: !!selectedTier && context.loyaltyHotelConfirmed === true,
            eligibility, note: programme.note, sources: programme.sources,
            benefits: selectedTier ? Object.entries(selectedTier.benefits).map(([key, benefit]) => ({ key, name: categories[key], ...benefit })) : [],
            // Excluded rates never supply tier entitlements to generation.
            requestBenefits: excluded || context.loyaltyHotelConfirmed !== true ? {} : selectedTier?.benefits || {}
        };
    }

    const catalogue = { version, programmes, requestCategories, getProgramme, getTier, selectionErrors, describe };
    if (typeof module === 'object' && module.exports) module.exports = catalogue;
    else window.StayHustlerLoyalty = catalogue;
})();

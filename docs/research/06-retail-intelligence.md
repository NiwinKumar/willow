# Research 06: Willow Proof — what businesses pay for, and what only Willow can give them

Date: 2026-10-16. For `docs/RETAILER_INSIGHTS.md` and the Willow Proof business app (`/retail`).
Method: five research angles; 22 sources fetched, 85 claims extracted, the top 25 checked by three independent
reviewers each (22 confirmed, 3 refuted). Confidence is given per finding. Anything not found in a source is labelled
**design judgment**.

## 1. The gap: incumbents measure buying, not results (high confidence)
- NielsenIQ and Sephora signed a multi-year data-sharing deal (June 2025). It gives NIQ Sephora's omnichannel
  point-of-sale data, which NIQ combines with its Omnishopper panel and Digital Purchases tool to track how people buy
  ([BusinessWire](https://secure.businesswire.com/news/home/20250603365877/en/CORRECTING-and-REPLACING-NielsenIQ-and-Sephora-to-Provide-the-Full-View-of-Beauty-with-Strategic-Multi-Year-Data-Sharing-Agreement)).
- Circana Complete Beauty tracks sales across mass, masstige and prestige. YipitData sells transaction data on
  retailer trends, price tiers and brand rank ([Circana](https://www.circana.com/post/us-beauty-industry-grows-in-the-first-half-of-2025-circana-reports),
  [YipitData](https://www.yipitdata.com/resources/blog/corporate-beauty-industry-report-2025)).
- No source we checked showed an incumbent measuring what a product did to the skin. NIQ's in-home tests capture
  perception and purchase intent, not measured outcomes.
- Demand signal (medium): Circana says US beauty buyers in H1 2025 were "focused on efficacy and elevated value".
- Nearest precedent (low, a 2022 advertorial): Beauty Buddy sells review data tied to exact SKUs by barcode, split by
  skin tone and type, with competitor reports. That is ratings and sentiment; Willow has measured outcomes.

**What this means for Willow:** the one thing nobody sells is measured, baseline-relative skin outcomes tied to the
exact product in each routine. Every screen should lead with it.

## 2. The five highest-value insights (synthesis: design judgment grounded in §1, §3, §4)
1. **Measured efficacy by product × skin type × goal.** The share of people with a real change held to week 8, the
   lift over people with the same goal who don't use the product, and n with a confidence interval.
2. **Time to visible result.** The median week a real change begins, and the curve over weeks against non-users.
3. **Fair category benchmark.** The same method for every product, the rank within the category and goal, and
   confidence intervals shown so small gaps aren't over-read.
4. **Claim-evidence pack.** Statements ready for a claim, each with method, window, n, cohort and caveat (§4).
5. **White space and abandonment.** Goals with high demand and low measured success, by segment and price tier.
   Continuation and switching show where people who drop a product go next.

Activation on top: **proof-gated promotion** with randomised holdout measurement (§3).

## 3. Proof-gated promotion: disclosure and incrementality
- **Paid placements are ads, and the label must be unavoidable** (high). FTC staff guidance says a result included or
  ranked wholly or partly because of payment is advertising and must be distinguishable from organic results,
  including in-app feeds. The EU Omnibus Directive added a UCPD blacklist item requiring disclosure of paid placement
  or ranking ([Search Engine Land](https://searchengineland.com/?p=164722),
  [Addleshaw Goddard](https://www.addleshawgoddard.com/en/insights/insights-briefings/2020/competition/the-eu-omnibus-directive--time-to-prepare-for-strengthened-consumer-laws/)).
  The FTC's 2023 Endorsement Guides say a disclosure behind a "more" link isn't enough, and advertisers must not
  shape which consumer results are shown (medium;
  [Katten](https://katten.com/federal-trade-commission-updates-endorsement-guides-and-proposes-new-rule-on-consumer-reviews)).
  - **How Willow applies this:** measured outcomes decide eligibility; money buys only a separate slot labelled
    "Sponsored" on the card itself; organic recommendations use outcomes only, and their ranking factors are
    disclosed; brands never choose which results are shown.
- **Incrementality is what retail-media buyers lack** (medium; early, 13 buyers). In ARF research reported in 2026,
  9 of 13 buyers called incrementality critical and 5 had cut retail-media spend over measurement gaps
  ([The Drum](https://www.thedrum.com/news/five-things-the-buy-side-is-telling-retail-media-networks-about-measurement)).
  - **How Willow applies this:** each campaign keeps a randomised holdout and reports the lift in adoption against
    it. The lift in skin outcomes follows once adopters reach week 8. No retail media network can report a result on
    skin.

## 4. Claims and substantiation
- Under UK CAP Code rule 3.7, objective claims need documentary evidence before the ad runs. The ASA does not accept
  self-reported or subjective data for objective claims (high;
  [ASA](https://www.asa.org.uk/advice-online/substantiation.html)).
  - Measured outcomes are therefore worth more than perception surveys. They still come from observational,
    real-world phone data, not a controlled trial.
  - **How Willow applies this:** evidence packs say "measured in N Willow users", keep measured and self-reported
    results apart, and never say "clinically proven". Every pack carries the caveat. Synthetic data is never presented
    as substantiation.

## 5. Privacy and statistical guardrails
- **Consent** (high). Under GDPR and UK GDPR, facial biometric data used to identify someone is special-category data
  ([Finnegan](https://www.finnegan.com/en/insights/articles/cosmetics-ai-facial-skin-analysis-and-privacy-tips-for-compliance-in-the-uk-eu-and-us.html)).
  - Illinois BIPA bans profiting from biometric data. *Melzer v. J&J* treated a skin-analysis scan as face geometry.
  - Washington's My Health My Data Act defines health data broadly and requires a separate opt-in before sharing
    ([Kelley Drye](https://www.kelleydrye.com/viewpoints/blogs/ad-law-access/my-health-my-data-washingtons-health-data-privacy-revolution)).
  - **How Willow applies this:** aggregate insights need their own unbundled opt-in
    (`consent.aggregate_insights_opt_in`, already in place); no images or per-person rows ever reach a business; data
    is minimised.
- **Small groups** (medium; preprint, [arXiv 2507.01710](https://arxiv.org/pdf/2507.01710)). Attacks that look weak on
  average can be accurate for a few people.
  - **How Willow applies this:** a minimum group of 10 on every cell, including drill-downs; complementary
    suppression so a hidden cell can't be worked out from totals; confidence intervals on every rate; the Ask assistant
    refuses individual-level questions.
- Which law covers skin metrics ("biometric" or "health") is unsettled, so Willow uses the stricter consent design.

## 6. Not verified (design judgment only)
Nothing survived checking on:
- Bazaarvoice and PowerReviews analytics;
- Ulta UB Media, Sephora SEMS and Boots Media Group specifics or pricing;
- EU Regulation 655/2013 claim criteria;
- specific k or differential-privacy parameters;
- CCPA details;
- dashboard UX best practice.

The UX choices in Willow Proof come from our design system and general UX guidance: insight first, drill-down,
every number with its n, exports, and accessible tables.

Refuted, do not cite:
- Haut.AI's study-size and setup-time figures;
- the claim that a Washington MHMDA sale needs a one-year signed authorisation.

## Open questions for the owner
- Competitors: named for everyone (retailer-grade view, the current choice), or anonymised peers in brand view
  unless the peer brand opts in? Naming them carries comparative-advertising risk if a brand quotes the comparison.
- Eligibility bar: today, Proven = n ≥ 30 and the lift's lower confidence bound above 0. Should some goals have
  stricter bars?

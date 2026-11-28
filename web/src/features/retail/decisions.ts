import type { AutopilotActivity, Campaign, ShelfProduct } from '../../lib/api'
import type { DecisionItem, DecisionStatus } from './proofApi'
import type { Insights, ProductRow, Segments } from './types'
import { article, int, pct, pts } from './ui/format.ts'
import { topUnmet } from './ui/insight.ts'

/*
 * Decisions home (research/finals/06 §6.4-6.5): cards composed in the browser from data Proof already serves
 * (product rows, this viewer's campaigns, the shelf check, segments, goal demand by month, saved claims,
 * AutoCampaign proposals). Pure: every sentence and figure comes from those rows, nothing is projected. Each card
 * has a stable key, so its state (accepted, dismissed, snoozed, done) lives on the organisation
 * (PUT /v1/proof/orgs/{org}/decisions/{key}) and survives reloads and colleagues.
 *
 * Insight types implemented (06 §6.5 numbering): 1 Proven, not promoted · 2 Nearly proven · 3 Claim ready ·
 * 4 Evidence slipped · 5 Expectation gap · 6 Over-shelved, under-delivering · 7 Under-shelved performer ·
 * 8 Unmet group · 9 Demand shift · 10 Losing switchers · 11 Routine clash · 12 Campaign result in ·
 * AutoCampaign proposals (suggest mode) as ordinary cards. A type only appears where its data exists (5 and 11
 * need the brand's product pages, 10 the brand's switching, 6 and 7 the shelf check).
 */

export type CardKind = 'proven_not_promoted' | 'nearly_proven' | 'claim_ready' | 'evidence_slipped' | 'expectation_gap' | 'over_shelved' | 'under_shelved' | 'unmet_group' | 'demand_shift' | 'losing_switchers' | 'routine_clash' | 'campaign_result' | 'auto_proposal'

export type CardAction =
  | { kind: 'link'; label: string; to: string }
  | { kind: 'accept'; label: string }
  | { kind: 'brief'; label: string; file: string; body: string }
  | { kind: 'request'; label: string; productId: string; brand: string; message: string }
  | { kind: 'autopilot'; label: string; activityId: string; act: 'approve' | 'dismiss' }

export type DecisionCard = {
  key: string
  kind: CardKind
  /** Short name of the insight ("Proven, not promoted"). */
  type: string
  title: string
  /** The trigger, in one sentence, with the numbers it rests on. */
  trigger: string
  figure: string
  figureNote: string
  n: number | null
  interval: string | null
  /** For ranking: how many people the decision touches. */
  people: number
  product: { id: string; name: string; brand: string; image_url: string | null; category: string } | null
  primary: CardAction
  secondary: CardAction | null
  /** What an accepted card waits for (the follow-up measurement). */
  waiting: string
  lane: 'decide' | 'result'
}

export const TYPE_LABEL: Record<CardKind, string> = {
  proven_not_promoted: 'Proven, not promoted',
  nearly_proven: 'Nearly proven',
  claim_ready: 'Claim ready',
  evidence_slipped: 'Evidence slipped',
  expectation_gap: 'Expectation gap',
  over_shelved: 'Over-shelved, under-delivering',
  under_shelved: 'Under-shelved performer',
  unmet_group: 'Unmet group',
  demand_shift: 'Demand shift',
  losing_switchers: 'Losing switchers',
  routine_clash: 'Routine clash',
  campaign_result: 'Campaign result in',
  auto_proposal: 'AutoCampaign proposal',
}

/** Without the shelf check's flags: shelf gaps of at least this many points (its own flags use 5). */
export const SHELF_GAP = 0.05
/** "Nearly proven": at most this many more people at week 8 would settle it. */
export const NEARLY = 60
/** Demand shift: a goal's share of people up by at least this many points month on month. */
export const DEMAND_RISE = 0.03
/** Expectation gap: at least this share of people at week 8 changed but didn't say it's working. */
export const EXPECTATION_GAP = 0.25
/** Routine clash: a rule-table conflict in at least this share of the routines (a product's users, or all). */
export const CLASH_SHARE = 0.2

/** What a brand's own product pages add (GET /v1/retailer/products/{id}): felt vs measured and routine conflicts. */
export type ProductSignals = {
  product_id: string
  agree: { n: number; measured_only: number } | null
  conflicts: { kind: string; label: string; fix: string; n: number; share: number }[]
}

export type ComposeInput = {
  /** Whose card mix: the retailer's (range, shelf, sourcing) or a brand's (promotion, evidence, claims). */
  mix: 'retailer' | 'brand'
  /** The brand a brand mix is about (its own products only). */
  brand: string | null
  rows: ProductRow[]
  /** This viewer's campaigns. */
  campaigns: Campaign[]
  /** The shelf check: every measured product's shares, and the flags it raised (the cards follow the flags). */
  shelf: { products: (ShelfProduct & { category_label: string })[]; flags: { product_id: string; kind: string }[] } | null
  segments: Pick<Segments, 'cells' | 'skin_types' | 'goals'> | null
  demand: Insights['needs_by_month'] | null
  /** Products with a saved claim (any status). */
  claimed: Set<string>
  proposals: AutopilotActivity[]
  /** Brands that have an organisation on this instance (who can receive an evidence request). */
  brandOrgs: Set<string>
  weeks: number
  carry: string
  /** The brand's own measured products' pages (5 Expectation gap, 11 Routine clash for a brand); [] when not loaded. */
  signals?: ProductSignals[]
  /** The brand's switching (GET /v1/retailer/brands/{brand}); null when not loaded. */
  switching?: { lost: { brand: string; n: number }[]; net: number | null } | null
  /** Rule-table conflicts across routines (insights), for the retailer's 11 Routine clash. */
  conflicts?: { routines: number | null; rows: { kind?: string; pair: string; n?: number; share: number; fix: string; resolves: string[] }[] }
  /** Another brand's name as this viewer may see it (the retailer's naming policy); identity when names are on. */
  nameOf?: (brand: string) => string
}

/** A count with a true minus sign (−13). */
const signed = (n: number) => (n < 0 ? `−${int(-n)}` : int(n))
const q = (carry: string) => (carry ? '&' : '?')
const productTo = (id: string, carry: string, hash = '') => `/retail/products/${encodeURIComponent(id)}${carry}${hash}`
const promoteTo = (id: string, carry: string) => `/retail/campaigns${carry}${q(carry)}new=${encodeURIComponent(id)}`
const ref = (r: ProductRow) => ({ id: r.product_id, name: r.product, brand: r.brand, image_url: r.image_url, category: r.category })
const liftInterval = (lo: number | null, hi: number | null) => (lo === null || hi === null ? null : `95% interval ${pts(lo)} to ${pts(hi)}`)
/** The shelf cards' figure is results-vs-shelf share; their interval is the lift's, so it says so. */
const shelfLiftInterval = (lo: number | null, hi: number | null) => (lo === null || hi === null ? null : `Gap over people with the same goals not using it, 95% interval ${pts(lo)} to ${pts(hi)}`)

/** The comparison group in words, after a lift figure ("+54 pts more than people not using it"). */
export const GAP_NOTE = 'more than people not using it'

/** A product's record against its comparison group, in one sentence: the gap is the point. */
export const gapSentence = (r: Pick<ProductRow, 'rate' | 'n' | 'base_rate' | 'lift'>, weeks: number) =>
  `${pct(r.rate)} of ${int(r.n)} users saw a visible change by week ${weeks}${r.base_rate !== null ? `; ${pct(r.base_rate)} of people with the same goals who don’t use it changed anyway` : ''}: a ${pts(r.lift)} gap.`

/**
 * Where each product stands on promotion, the same everywhere on Home (cards, brief, counts): `running` (a
 * campaign is live or paused, sample or not), `measured` (none running; an ended one has its lift against the holdout,
 * so its result card offers "Run it again"), `ended` (ended before a lift was measured). Absent: never promoted.
 */
export function promotionOf(campaigns: Pick<Campaign, 'product_id' | 'status' | 'stats'>[]): Map<string, 'running' | 'measured' | 'ended'> {
  const m = new Map<string, 'running' | 'measured' | 'ended'>()
  const rank = { running: 3, measured: 2, ended: 1 } as const
  for (const c of campaigns) {
    const v = c.status !== 'ended' ? 'running' : c.stats.incrementality ? 'measured' : c.status === 'ended' ? 'ended' : null
    if (!v) continue
    const cur = m.get(c.product_id)
    if (!cur || rank[v] > rank[cur]) m.set(c.product_id, v)
  }
  return m
}

/** The cards for one organisation, most people first. Results are a separate lane. */
export function composeCards(x: ComposeInput): DecisionCard[] {
  const cards: DecisionCard[] = []
  const rowById = new Map(x.rows.map((r) => [r.product_id, r]))
  const mine = x.brand ? x.rows.filter((r) => r.brand === x.brand) : x.rows
  // A simulated (sample) campaign never makes evidence slip (4); it does count as a promotion, like any other.
  const live = x.campaigns.filter((c) => !c.sample)
  const promo = promotionOf(x.campaigns)

  if (x.mix === 'brand') {
    // 1 · Proven, not promoted
    for (const r of mine) {
      // Running, or promoted before with a measured result (12 offers "Run it again"): no card here.
      const p = promo.get(r.product_id)
      if (r.tier !== 'proven' || r.n === null || p === 'running' || p === 'measured') continue
      const before = p === 'ended'
      cards.push({
        key: `proven_not_promoted--${r.product_id}`,
        kind: 'proven_not_promoted',
        type: TYPE_LABEL.proven_not_promoted,
        title: before ? `${r.product} is Proven; its campaign has ended` : `${r.product} is Proven and not promoted`,
        trigger: `${gapSentence(r, x.weeks)} ${before ? 'Its last campaign ended before its lift was measured.' : 'It has never had a campaign.'}`,
        figure: pts(r.lift),
        figureNote: GAP_NOTE,
        n: r.n,
        interval: liftInterval(r.lift_lo, r.lift_hi),
        people: r.users ?? r.n,
        product: ref(r),
        primary: { kind: 'link', label: before ? 'Promote again' : 'Promote where it works', to: promoteTo(r.product_id, x.carry) },
        secondary: { kind: 'link', label: 'View proof', to: productTo(r.product_id, x.carry) },
        waiting: 'Adoption against the randomised holdout, once each group has 10 people',
        lane: 'decide',
      })
    }
    // 2 · Nearly proven
    for (const r of mine) {
      if (r.tier !== 'promising' || r.to_proven === null || r.to_proven === undefined || r.to_proven > NEARLY || r.n === null) continue
      cards.push({
        key: `nearly_proven--${r.product_id}`,
        kind: 'nearly_proven',
        type: TYPE_LABEL.nearly_proven,
        title: `${r.product} is close to Proven`,
        trigger: `${pts(r.lift)} more than people with the same goals not using it, in ${int(r.n)} people at week ${x.weeks}; about ${int(r.to_proven)} more people would settle it if the rates hold.`,
        figure: `+${int(r.to_proven)}`,
        figureNote: 'people needed',
        n: r.n,
        interval: liftInterval(r.lift_lo, r.lift_hi),
        people: r.users ?? r.n,
        product: ref(r),
        primary: { kind: 'brief', label: 'Sampling brief', file: `proof-sampling-brief-${r.product_id}.md`, body: samplingBrief(r, x.weeks) },
        secondary: { kind: 'link', label: 'View proof', to: productTo(r.product_id, x.carry) },
        waiting: `People at week ${x.weeks}; the card returns when the tier changes`,
        lane: 'decide',
      })
    }
    // 3 · Claim ready
    for (const r of mine) {
      // claim-ready means Proven (the api gives no statements below it)
      if (r.tier !== 'proven' || x.claimed.has(r.product_id) || r.n === null) continue
      cards.push({
        key: `claim_ready--${r.product_id}`,
        kind: 'claim_ready',
        type: TYPE_LABEL.claim_ready,
        title: `${r.product} has claim-ready evidence and no saved claim`,
        trigger: `Proven in ${int(r.n)} people over ${x.weeks} weeks${r.base_rate !== null ? `: ${pct(r.rate)} against ${pct(r.base_rate)} of people with the same goals who do not use it` : ''}. A listing claim can quote only its measured statements.`,
        figure: pct(r.rate),
        figureNote: 'saw a visible change',
        n: r.n,
        interval: r.rate_lo !== null && r.rate_hi !== null ? `95% interval ${pct(r.rate_lo)} to ${pct(r.rate_hi)}` : null,
        people: Math.round((r.users ?? r.n) * 0.5),
        product: ref(r),
        primary: { kind: 'link', label: 'Draft a listing claim', to: `${productTo(r.product_id, x.carry).replace(x.carry, `${x.carry}${q(x.carry)}claim=listing`)}#claims-h` },
        secondary: { kind: 'link', label: 'See the statements', to: productTo(r.product_id, x.carry, '#ev-h') },
        waiting: 'A saved claim; re-checked if the tier slips',
        lane: 'decide',
      })
    }
  }

  if (x.mix === 'retailer') {
    const flagged = new Map((x.shelf?.flags ?? []).map((f) => [f.product_id, f.kind]))
    const useFlags = flagged.size > 0
    for (const s of x.shelf?.products ?? []) {
      const r = rowById.get(s.product_id)
      if (x.brand && s.brand !== x.brand) continue
      const where = s.basis === 'stock' ? 'stock' : 'use'
      // 6 · Over-shelved, under-delivering
      if ((useFlags ? flagged.get(s.product_id) === 'taking_space' : s.gap <= -SHELF_GAP) && s.n >= 30 && (s.lift_lo === null || s.lift_lo <= 0)) {
        const canAsk = x.brandOrgs.has(s.brand)
        cards.push({
          key: `over_shelved--${s.product_id}`,
          kind: 'over_shelved',
          type: TYPE_LABEL.over_shelved,
          title: `${s.product} takes more shelf than its results`,
          trigger: `${pct(s.shelf_share)} of ${s.category_label.toLowerCase()} ${where}, ${pct(s.results_share)} of the visible changes; ${int(s.n)} people at week ${x.weeks}, ${pts(s.lift)} against people with the same goals not using it.`,
          figure: pts(s.gap),
          figureNote: 'results vs shelf',
          n: s.n,
          interval: r ? shelfLiftInterval(r.lift_lo, r.lift_hi) : null,
          people: s.users,
          product: { id: s.product_id, name: s.product, brand: s.brand, image_url: s.image_url, category: '' },
          primary: { kind: 'accept', label: 'Add to range review' },
          secondary: canAsk
            ? { kind: 'request', label: `Ask ${s.brand} for evidence`, productId: s.product_id, brand: s.brand, message: `${s.product} takes ${pct(s.shelf_share)} of our ${s.category_label.toLowerCase()} ${where} and ${pct(s.results_share)} of the visible changes (${int(s.n)} people at week ${x.weeks}). Before the next range review, can you share evidence for it?` }
            : { kind: 'link', label: 'View proof', to: productTo(s.product_id, x.carry) },
          waiting: 'The brand’s answer, and the gap after the next stock upload',
          lane: 'decide',
        })
      }
      // 7 · Under-shelved performer
      if ((useFlags ? flagged.get(s.product_id) === 'under_shelved' : s.gap >= SHELF_GAP) && r?.tier === 'proven') {
        cards.push({
          key: `under_shelved--${s.product_id}`,
          kind: 'under_shelved',
          type: TYPE_LABEL.under_shelved,
          title: `${s.product} delivers more than its shelf`,
          trigger: `${pct(s.results_share)} of the visible changes in ${s.category_label.toLowerCase()} from ${pct(s.shelf_share)} of ${where}; Proven in ${int(s.n)} people, ${pts(s.lift)} more than people with the same goals not using it.`,
          figure: `+${Math.round(s.gap * 100)} pts`,
          figureNote: 'results vs shelf',
          n: s.n,
          interval: shelfLiftInterval(r.lift_lo, r.lift_hi),
          people: s.users,
          product: { id: s.product_id, name: s.product, brand: s.brand, image_url: s.image_url, category: '' },
          primary: { kind: 'accept', label: 'Give it more space' },
          secondary: { kind: 'link', label: 'View proof', to: productTo(s.product_id, x.carry) },
          waiting: 'Share of use next month',
          lane: 'decide',
        })
      }
    }
    // 8 · Unmet group
    const unmet = x.segments ? topUnmet(x.segments, 1)[0] : null
    if (unmet && unmet.users >= 10) {
      const best = unmet.best
      cards.push({
        key: `unmet_group--${unmet.skin}--${unmet.goal}`,
        kind: 'unmet_group',
        type: TYPE_LABEL.unmet_group,
        title: `${unmet.skinLabel} skin with ${article(unmet.goalLabel)} ${unmet.goalLabel.toLowerCase()} goal is the least served`,
        trigger: `${pct(unmet.unmet)} of ${int(unmet.users)} people in this group have no visible change yet${best ? `; the best option, ${best.product}, reaches ${pct(best.rate)} of ${int(best.n)}` : '; no product reaches 10 people in it'}.`,
        figure: pct(unmet.unmet),
        figureNote: 'without a change',
        n: unmet.users,
        interval: null,
        people: unmet.users,
        product: null,
        primary: { kind: 'brief', label: 'Sourcing brief', file: `proof-sourcing-brief-${unmet.skin}-${unmet.goal}.md`, body: sourcingBrief(unmet.skinLabel, unmet.goalLabel, unmet.users, unmet.unmet, best) },
        secondary: { kind: 'link', label: 'Customer map', to: `/retail/customers${x.carry}` },
        waiting: 'The group’s unmet share next month',
        lane: 'decide',
      })
    }
    // 9 · Demand shift
    const shift = demandShift(x.demand)
    if (shift) {
      cards.push({
        key: `demand_shift--${shift.goalId}--${shift.month}`,
        kind: 'demand_shift',
        type: TYPE_LABEL.demand_shift,
        title: `More people chose ${shift.goal.toLowerCase()} in ${shift.monthLabel}`,
        trigger: `${pct(shift.share)} of the ${int(shift.people)} people with a reading in ${shift.monthLabel} chose it, up from ${pct(shift.prev)} the month before.`,
        figure: pts(shift.share - shift.prev),
        figureNote: 'share of people',
        n: shift.count,
        interval: null,
        people: shift.count,
        product: null,
        primary: { kind: 'link', label: 'Set up AutoCampaign', to: `/retail/campaigns${x.carry}${q(x.carry)}tab=auto` },
        secondary: { kind: 'link', label: 'Demand by month', to: `/retail/customers${x.carry}${q(x.carry)}view=demand` },
        waiting: 'Adoption among people with this goal',
        lane: 'decide',
      })
    }
  }

  // 4 · Evidence slipped (both): a live campaign or a saved claim on a product that no longer holds its tier
  for (const c of live) {
    const r = rowById.get(c.product_id)
    if (c.status !== 'active' || !r || r.tier === 'proven' || (x.brand && r.brand !== x.brand)) continue
    cards.push({
      key: `evidence_slipped--campaign-${c.id}`,
      kind: 'evidence_slipped',
      type: TYPE_LABEL.evidence_slipped,
      title: `${r.product} is promoted but no longer Proven`,
      trigger: `A campaign is live while the product reads “${r.tier_label ?? r.tier}”${r.n !== null ? ` in ${int(r.n)} people at week ${x.weeks}` : ''}${r.lift !== null ? `, ${pts(r.lift)} against people with the same goals not using it` : ''}. Campaigns are for Proven products only.`,
      figure: r.lift !== null ? pts(r.lift) : '—',
      figureNote: r.lift !== null ? `${GAP_NOTE} now` : 'no measured lift now',
      n: r.n,
      interval: liftInterval(r.lift_lo, r.lift_hi),
      people: c.stats.reach ?? c.stats.impressions ?? 0,
      product: ref(r),
      primary: { kind: 'link', label: 'Pause the campaign', to: `/retail/campaigns/${encodeURIComponent(c.id)}${x.carry}` },
      secondary: { kind: 'link', label: 'View proof', to: productTo(r.product_id, x.carry) },
      waiting: 'The tier on the next data version',
      lane: 'decide',
    })
  }
  for (const id of x.claimed) {
    const r = rowById.get(id)
    // a claim stands on Proven only (the api gives no statements below it), so a Promising product's saved claim has slipped too
    if (!r || r.tier === 'proven' || (x.brand && r.brand !== x.brand)) continue
    cards.push({
      key: `evidence_slipped--claim-${id}`,
      kind: 'evidence_slipped',
      type: TYPE_LABEL.evidence_slipped,
      title: `A saved claim on ${r.product} rests on evidence that slipped`,
      trigger: `It now reads “${r.tier_label ?? r.tier}”${r.n !== null ? ` in ${int(r.n)} people at week ${x.weeks}` : ''}. A claim can only quote a Proven product’s statements.`,
      figure: r.rate !== null ? pct(r.rate) : '—',
      figureNote: r.rate !== null ? 'saw a visible change' : 'no measured outcome now',
      n: r.n,
      interval: liftInterval(r.lift_lo, r.lift_hi),
      people: r.users ?? r.n ?? 0,
      product: ref(r),
      primary: { kind: 'link', label: 'Withdraw or reword the claim', to: productTo(r.product_id, x.carry, '#claims-h') },
      secondary: { kind: 'link', label: 'View proof', to: productTo(r.product_id, x.carry) },
      waiting: 'The tier on the next data version',
      lane: 'decide',
    })
  }

  if (x.mix === 'brand') {
    // 11 for a brand: one card, its product with the most common clash (a calm Home over one card per product)
    let clashCard: DecisionCard | null = null
    let clashBest = -1
    for (const sig of x.signals ?? []) {
      const r = rowById.get(sig.product_id)
      if (!r || (x.brand && r.brand !== x.brand)) continue
      // 5 · Expectation gap: changed, but didn't say it's working yet (the people most likely to stop early)
      if (sig.agree && sig.agree.n >= 10 && sig.agree.measured_only >= EXPECTATION_GAP) {
        cards.push({
          key: `expectation_gap--${r.product_id}`,
          kind: 'expectation_gap',
          type: TYPE_LABEL.expectation_gap,
          title: `People see ${r.product} work before they feel it`,
          trigger: `${pct(sig.agree.measured_only)} of ${int(sig.agree.n)} people at week ${x.weeks} had a visible change but hadn’t said it’s working${r.weeks !== null ? `; the first change shows at a median of week ${r.weeks}` : ''}.`,
          figure: pct(sig.agree.measured_only),
          figureNote: 'changed, not felt yet',
          n: sig.agree.n,
          interval: null,
          people: Math.round(sig.agree.n * sig.agree.measured_only),
          product: ref(r),
          primary: { kind: 'brief', label: 'Expectation line', file: `proof-expectation-line-${r.product_id}.md`, body: expectationBrief(r, sig.agree, x.weeks) },
          secondary: { kind: 'link', label: 'How it feels', to: productTo(r.product_id, x.carry, '#feel-h') },
          waiting: `Still using at week ${x.weeks}, and the “working” share four weeks later`,
          lane: 'decide',
        })
      }
      // 11 · Routine clash (a brand's own product)
      const clash = [...sig.conflicts].filter((c) => c.n >= 10 && c.share >= CLASH_SHARE).sort((a, b) => b.share - a.share)[0]
      if (clash && clash.share > clashBest) {
        clashBest = clash.share
        clashCard = {
          key: `routine_clash--${r.product_id}--${clash.kind}`,
          kind: 'routine_clash',
          type: TYPE_LABEL.routine_clash,
          title: `${pct(clash.share)} of routines with ${r.product}: ${clash.label.toLowerCase()}`,
          trigger: `${int(clash.n)} routines that hold it have this rule-table finding. The usual fix: ${clash.fix.toLowerCase()}.`,
          figure: pct(clash.share),
          figureNote: 'of its users’ routines',
          n: clash.n,
          interval: null,
          people: clash.n,
          product: ref(r),
          primary: { kind: 'brief', label: 'Layering note', file: `proof-layering-note-${r.product_id}.md`, body: layeringBrief(r.product, clash.label, clash.fix, clash.n, clash.share, []) },
          secondary: { kind: 'link', label: 'In people’s routines', to: productTo(r.product_id, x.carry, '#ctx-h') },
          waiting: 'The conflict’s share next month',
          lane: 'decide',
        }
      }
    }
    if (clashCard) cards.push(clashCard)
    // 10 · Losing switchers: net switching negative, at least 10 people to one destination
    const sw = x.switching
    const lost = sw?.lost.filter((l) => l.n >= 10).sort((a, b) => b.n - a.n)[0]
    if (sw && sw.net !== null && sw.net < 0 && lost && x.brand) {
      const dest = (x.nameOf ?? ((b: string) => b))(lost.brand)
      cards.push({
        key: `losing_switchers--${x.brand}--${lost.brand}`,
        kind: 'losing_switchers',
        type: TYPE_LABEL.losing_switchers,
        title: `${x.brand} loses more people than it wins`,
        trigger: `Net switching is ${signed(sw.net)} people; the largest flow is ${int(lost.n)} people who moved to ${dest}.`,
        figure: signed(sw.net),
        figureNote: 'net people',
        n: lost.n,
        interval: null,
        people: lost.n,
        product: null,
        primary: { kind: 'brief', label: 'Retention note', file: `proof-retention-note-${x.brand.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`, body: retentionBrief(x.brand, dest, lost.n, sw.net, x.weeks) },
        secondary: { kind: 'link', label: 'See switching', to: `/retail/market${x.carry}#switching` },
        waiting: 'Net switching and continuation next month',
        lane: 'decide',
      })
    }
  }

  if (x.mix === 'retailer' && x.conflicts) {
    // 11 · Routine clash across the range
    const top = [...x.conflicts.rows].filter((c) => (c.n ?? 0) >= 10 && c.share >= CLASH_SHARE).sort((a, b) => b.share - a.share)[0]
    if (top) {
      cards.push({
        key: `routine_clash--all--${top.kind ?? top.pair}`,
        kind: 'routine_clash',
        type: TYPE_LABEL.routine_clash,
        title: `${pct(top.share)} of routines: ${top.pair.toLowerCase()}`,
        trigger: `${int(top.n ?? 0)}${x.conflicts.routines ? ` of ${int(x.conflicts.routines)}` : ''} routines checked have this rule-table finding. The usual fix: ${top.fix.toLowerCase()}${top.resolves.length ? `; ${top.resolves.length} ${top.resolves.length === 1 ? 'product in the catalog resolves it' : 'products in the catalog resolve it'}` : ''}.`,
        figure: pct(top.share),
        figureNote: 'of routines checked',
        n: top.n ?? null,
        interval: null,
        people: top.n ?? 0,
        product: null,
        primary: { kind: 'brief', label: 'Layering note', file: `proof-layering-note-${(top.kind ?? 'routine').replace(/[^a-z0-9_-]+/gi, '-')}.md`, body: layeringBrief(null, top.pair, top.fix, top.n ?? 0, top.share, top.resolves) },
        secondary: { kind: 'link', label: 'Routine conflicts', to: `/retail/customers${x.carry}#conflicts-h` },
        waiting: 'The conflict’s share next month',
        lane: 'decide',
      })
    }
  }

  // 12 · Campaign result in (both)
  for (const c of x.campaigns) {
    const inc = c.stats.incrementality
    if (!inc) continue
    if (x.brand && c.brand && c.brand !== x.brand) continue
    const cleared = inc.lift_lo > 0
    cards.push({
      key: `campaign_result--${c.id}`,
      kind: 'campaign_result',
      type: TYPE_LABEL.campaign_result,
      title: c.status === 'ended' && cleared ? `${c.product ?? c.product_id} was promoted once: ${pts(inc.lift)} adoption. Run it again?` : `${c.product ?? c.product_id}: campaign result ${c.status === 'ended' ? 'in' : 'so far'}`,
      trigger: `${c.sample ? 'Sample campaign, simulated. ' : ''}Adoption ${pts(inc.lift)} against the randomised holdout: ${pct(inc.exposed.rate)} of ${int(inc.exposed.n)} who could see the card, ${pct(inc.holdout.rate)} of ${int(inc.holdout.n)} held out.`,
      figure: pts(inc.lift),
      figureNote: cleared ? 'interval above zero' : 'interval includes zero',
      n: inc.exposed.n + inc.holdout.n,
      interval: `95% interval ${pts(inc.lift_lo)} to ${pts(inc.lift_hi)}`,
      people: inc.exposed.n + inc.holdout.n,
      product: c.product ? { id: c.product_id, name: c.product, brand: c.brand ?? '', image_url: c.image_url, category: c.category ?? '' } : null,
      primary: cleared ? { kind: 'link', label: 'Run it again', to: promoteTo(c.product_id, x.carry) } : { kind: 'accept', label: 'Stop here, note the result' },
      secondary: { kind: 'link', label: 'Open the result', to: `/retail/campaigns/${encodeURIComponent(c.id)}${x.carry}` },
      waiting: 'The next campaign’s lift',
      lane: 'result',
    })
  }

  // AutoCampaign proposals (suggest mode) are ordinary cards
  for (const a of x.proposals) {
    const r = a.product_id ? rowById.get(a.product_id) : undefined
    if (x.brand && r && r.brand !== x.brand) continue
    cards.push({
      key: `auto_proposal--${a.id}`,
      kind: 'auto_proposal',
      type: TYPE_LABEL.auto_proposal,
      title: a.rule_name ? `Rule “${a.rule_name}” proposes a campaign` : 'An AutoCampaign rule proposes a campaign',
      trigger: a.text.replace(/^Proposed: /, ''),
      figure: r?.lift !== undefined && r?.lift !== null ? pts(r.lift) : '—',
      figureNote: r ? GAP_NOTE : '',
      n: r?.n ?? null,
      interval: r ? liftInterval(r.lift_lo, r.lift_hi) : null,
      people: r?.users ?? r?.n ?? 0,
      product: r ? ref(r) : null,
      primary: { kind: 'autopilot', label: 'Approve and start', activityId: a.id, act: 'approve' },
      secondary: { kind: 'autopilot', label: 'Decline', activityId: a.id, act: 'dismiss' },
      waiting: 'The campaign’s lift against its holdout',
      lane: 'decide',
    })
  }

  return cards.sort((a, b) => b.people - a.people || a.key.localeCompare(b.key))
}

/** The goal whose share of people rose most from the month before (by DEMAND_RISE or more); null otherwise. */
export function demandShift(d: Insights['needs_by_month'] | null | undefined) {
  if (!d || d.months.length < 2) return null
  const i = d.months.length - 1
  const people = d.people[i]
  const before = d.people[i - 1]
  if (!people || !before) return null
  let best: { goal: string; goalId: string; share: number; prev: number; count: number } | null = null
  for (const g of d.goals) {
    const now = g.counts[i]
    const then = g.counts[i - 1]
    if (now === null || then === null || now < 10) continue
    const share = now / people
    const prev = then / before
    if (share - prev >= DEMAND_RISE && (!best || share - prev > best.share - best.prev)) best = { goal: g.goal, goalId: g.goal_id, share, prev, count: now }
  }
  if (!best) return null
  const [y, m] = d.months[i].split('-').map(Number)
  const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })
  return { ...best, people, month: d.months[i], monthLabel }
}

/** Which lane a card's stored state puts it in; null = hidden (dismissed, or snoozed for 7 days). */
export function laneOf(item: DecisionItem | undefined, now = Date.now()): 'decide' | 'progress' | 'done' | null {
  if (!item || item.status === 'open') return 'decide'
  if (item.status === 'accepted') return 'progress'
  if (item.status === 'done') return 'done'
  if (item.status === 'dismissed') return null
  if (item.status === 'snoozed') {
    const at = item.updated_at ? Date.parse(item.updated_at) : now
    return now - at > 7 * 86_400_000 ? 'decide' : null
  }
  return 'decide'
}

export const DISMISS_REASONS = ['Not relevant to us', 'Already handled', 'Don’t agree with the data', 'Not our product'] as const

export const STATUS_WORD: Record<DecisionStatus, string> = { open: 'Reopened', accepted: 'Accepted', dismissed: 'Dismissed', snoozed: 'Snoozed', done: 'Done' }

/** The kind of card a stored key belongs to (keys are `<kind>--<id>`). */
export const kindOfKey = (key: string): CardKind | null => {
  const k = key.split('--')[0] as CardKind
  return k in TYPE_LABEL ? k : null
}

function samplingBrief(r: ProductRow, weeks: number): string {
  return [
    `# Sampling brief: ${r.product} (${r.brand})`,
    '',
    `Status: Promising. ${pts(r.lift)} more than people with the same goals not using it, in ${int(r.n)} people at week ${weeks}${r.lift_lo !== null && r.lift_hi !== null ? ` (95% interval ${pts(r.lift_lo)} to ${pts(r.lift_hi)})` : ''}.`,
    `About ${int(r.to_proven)} more people at week ${weeks} would settle it if the rates hold.`,
    '',
    '## Aim',
    `Grow the number of people who use it for ${weeks} weeks, so the evidence settles either way. Sampling is not a claim; nothing here says the product works.`,
    '',
    '## Who',
    `People whose goals match the product (${r.goal_ids.join(', ') || 'its listed goals'}). Proof never shares who they are: target through your own channels or a Proof campaign once it is Proven.`,
    '',
    '---',
    'Proof by Willow. Observational, aggregate data; groups under 10 people are suppressed. Cosmetic measurements, not a medical assessment.',
    '',
  ].join('\n')
}

function sourcingBrief(skin: string, goal: string, users: number, unmet: number, best: { product: string; brand: string; rate: number; n: number } | null): string {
  return [
    `# Sourcing brief: ${skin} skin, ${goal.toLowerCase()}`,
    '',
    `${int(users)} people in this group; ${pct(unmet)} have no visible change yet.`,
    best ? `Best current option: ${best.product} (${best.brand}), ${pct(best.rate)} of ${int(best.n)} saw a visible change.` : 'No product reaches 10 people in this group yet.',
    '',
    '## Ask of suppliers',
    `Products made for ${goal.toLowerCase()} that suit ${skin.toLowerCase()} skin, with any evidence they hold. Proof will measure them in use once they are in the range.`,
    '',
    '---',
    'Proof by Willow. Observational, aggregate data; groups under 10 people are suppressed. Cosmetic measurements, not a medical assessment.',
    '',
  ].join('\n')
}

const FOOT = ['---', 'Proof by Willow. Observational, aggregate data; groups under 10 people are suppressed. Cosmetic measurements, not a medical assessment.', '']

function expectationBrief(r: ProductRow, agree: { n: number; measured_only: number }, weeks: number): string {
  return [
    `# Expectation line: ${r.product} (${r.brand})`,
    '',
    `${pct(agree.measured_only)} of ${int(agree.n)} people at week ${weeks} had a visible change in what it targets but hadn’t said it’s working yet. People who don’t feel a change are the most likely to stop early.`,
    r.weeks !== null ? `The first visible change shows at a median of week ${r.weeks}.` : '',
    '',
    '## Draft line for the listing and the pack (edit before use)',
    r.weeks !== null ? `“Give it ${r.weeks} weeks: that is when people using it usually first see a change.”` : '“Give it a few weeks before judging it.”',
    '',
    'Quote only the numbers above; say “people using it”, never “clinically proven”.',
    '',
    ...FOOT,
  ].join('\n')
}

function layeringBrief(product: string | null, label: string, fix: string, n: number, share: number, resolves: string[]): string {
  return [
    `# Layering note: ${label}${product ? ` (${product})` : ''}`,
    '',
    `${int(n)} routines${product ? ` that hold ${product}` : ''} have this rule-table finding (${pct(share)}${product ? ' of its users’ routines' : ' of the routines checked'}).`,
    `The usual fix: ${fix}.`,
    resolves.length ? `Products in the catalog that resolve it: ${resolves.join('; ')}.` : '',
    '',
    '## Use',
    'A short line on the listing or the shelf talker, and a bundle suggestion where one product resolves it.',
    '',
    ...FOOT,
  ].join('\n')
}

function retentionBrief(brand: string, dest: string, n: number, net: number, weeks: number): string {
  return [
    `# Retention note: ${brand}`,
    '',
    `Net switching is ${signed(net)} people; ${int(n)} people moved to ${dest}.`,
    '',
    '## Ask of the team',
    `Compare what those people were looking for with what ${brand}’s products deliver by week ${weeks} (Market → switching, and each product’s “Where it works”), then decide on a retention message or a sampling of the product that fits them.`,
    '',
    ...FOOT,
  ].join('\n')
}

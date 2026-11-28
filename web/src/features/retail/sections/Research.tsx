import { ChevronDown, Download, FileText } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { useRetailData } from '../context'
import { useDataTo, useResearch } from '../freshness'
import { useOrg } from '../org'
import { useOrgSettings } from '../orgData'
import { useProducts } from '../productData'
import { rangeIds, useRange } from '../rangeStore'
import { appendixHtml, appendixMarkdown, CLAIM_LINE, CLAIMS_CAN, CLAIMS_CANNOT, researchBlocks } from '../research'
import { purposeOf, sectionPath, useRetailState } from '../state'
import { Badge, Bone, downloadText, EmptyState, GLOSSARY, int, Menu, MenuItem, PageHeader, Panel, ProofTierChip, Tabs } from '../ui'

/*
 * Research (/retail/research): for a brand's R&D, regulatory and marketing teams and for analysts, the facts a
 * shopper never needs. Methodology (own baseline, noise band, window, tiers, randomised holdout), cohort facts
 * (real vs simulated, date range, consent, suppression), the metric dictionary, claim rules, data-sharing terms
 * and the glossary, all read from GET /v1/proof/research (the api reads them from its own code); a downloadable
 * methods appendix; and links to each product's evidence pack. ?tab= keeps the view in the URL.
 */

const TABS = [
  { id: 'method', label: 'Methodology' },
  { id: 'cohort', label: 'Cohort facts' },
  { id: 'metrics', label: 'Metric dictionary' },
  { id: 'claims', label: 'Claim rules' },
  { id: 'sharing', label: 'Data sharing' },
  { id: 'glossary', label: 'Glossary' },
  { id: 'packs', label: 'Evidence packs' },
] as const
type TabId = (typeof TABS)[number]['id']

export default function Research() {
  const r = useResearch()
  const { param, setParam } = useRetailState()
  const { insights } = useRetailData()
  const { org } = useOrg()
  const settings = useOrgSettings()
  const d = insights.status === 'ready' || insights.status === 'empty' ? insights.d : null
  const to = useDataTo(d)
  const tab: TabId = TABS.find((t) => t.id === param('tab'))?.id ?? 'method'
  const competitor = settings.data ? settings.data.policy.competitor_names : null
  const blocks = useMemo(() => researchBlocks(r.d, { competitorNames: competitor }), [r.d, competitor])
  const head = () => ({ org: org?.name ?? 'Proof by Willow', date: new Date().toISOString().slice(0, 10), dataTo: to?.label ?? null })
  const rr = r.d

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Research"
        description={
          rr?.cohort ? (
            <>
              Every number in Proof, explained: <strong>{int(rr.cohort.real)} real</strong> and <strong>{int(rr.cohort.simulated)} simulated</strong> people{to ? `, readings to ${to.short}` : ''}.
            </>
          ) : (
            'Every number in Proof, explained: the method, the cohort, what each metric means and what may be claimed from it.'
          )
        }
        purpose={purposeOf('research')}
        actions={
          <Menu
            label="Download the methods appendix"
            align="right"
            width={260}
            trigger={
              <>
                <Download size={15} strokeWidth={1.6} aria-hidden /> Methods appendix <ChevronDown size={14} strokeWidth={1.6} aria-hidden className="text-ink-2" />
              </>
            }
          >
            {(close) => (
              <>
                <MenuItem
                  sub="Print-ready page for a study file"
                  onClick={() => {
                    close()
                    downloadText('proof-methods-appendix.html', appendixHtml(blocks, head()), 'text/html')
                  }}
                >
                  HTML
                </MenuItem>
                <MenuItem
                  sub="For briefs, wikis and regulatory notes"
                  onClick={() => {
                    close()
                    downloadText('proof-methods-appendix.md', appendixMarkdown(blocks, head()), 'text/markdown')
                  }}
                >
                  Markdown
                </MenuItem>
              </>
            )}
          </Menu>
        }
      />

      <Tabs label="Research" panelId="research-panel" value={tab} onChange={(t) => setParam({ tab: t === 'method' ? null : t })} tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} />

      <div id="research-panel" role="tabpanel" key={tab} className="flex flex-col gap-4 animate-[proofPage_.2s_var(--ease-standard)_both]">
        {r.status === 'loading' && tab !== 'glossary' && tab !== 'claims' && tab !== 'packs' ? (
          <div className="flex flex-col gap-3">
            <Bone className="h-5 w-2/3" />
            <Bone className="h-24 w-full" />
          </div>
        ) : tab === 'method' ? (
          <Method />
        ) : tab === 'cohort' ? (
          <Cohort />
        ) : tab === 'metrics' ? (
          <Metrics />
        ) : tab === 'claims' ? (
          <Claims />
        ) : tab === 'sharing' ? (
          <Sharing competitor={competitor} />
        ) : tab === 'glossary' ? (
          <Glossary />
        ) : (
          <Packs />
        )}
      </div>
    </div>
  )
}

function Missing() {
  return <EmptyState compact title="This Proof build doesn’t publish its method facts yet" body="The method is unchanged; this page reads its numbers from the api rather than retyping them, so it waits for /v1/proof/research." />
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-proof-small font-medium text-ink">{k}</dt>
      <dd className="m-0 text-proof-small text-ink-2 [text-wrap:pretty]">{v}</dd>
    </div>
  )
}

function Method() {
  const { d: r } = useResearch()
  if (!r) return <Missing />
  return (
    <>
      <Panel title="How a change is measured" id="m-change-h" description="Each person against their own baseline, never against other people.">
        <dl className="m-0 grid gap-5 md:grid-cols-2">
          <Fact k="Own baseline" v={r.method ?? '—'} />
          <Fact k="Noise band (MDC95)" v={<>{r.noise?.rule}{r.noise?.band_photos ? ` The band comes from the spread of five baseline photos (at least ${r.noise.band_photos} usable), at ${Math.round((r.noise.confidence ?? 0.95) * 100)}% confidence.` : ''}</>} />
          <Fact k="Minimum window" v={r.window ?? `${r.weeks ?? 8} weeks`} />
          <Fact k="Comparison" v="People with the same goals who did not use the product, measured the same way. Lift = the difference in the share with a visible change, in points, with a 95% Wilson interval." />
        </dl>
      </Panel>
      {r.tiers?.length ? (
        <Panel title="Proof tiers" id="m-tiers-h" description="One rule for every product, computed in code. Payment never changes a tier or eligibility." flush>
          <ul className="m-0 flex list-none flex-col p-0">
            {r.tiers.map((t) => (
              <li key={t.id} className="grid grid-cols-1 gap-2 border-t border-line px-5 py-3.5 sm:grid-cols-[200px_minmax(0,1fr)_120px] sm:items-center">
                <span>{['proven', 'promising', 'unclear', 'too_few'].includes(t.id) ? <ProofTierChip tier={t.id as 'proven'} size="sm" /> : <Badge>{t.label}</Badge>}</span>
                <span className="text-proof-small text-ink-2">{t.rule}</span>
                {/* "Not enough data" is the tier under the threshold: n < 10, not n ≥ 10 (the api sends the threshold). */}
                <span className="text-proof-small text-ink-2 tnum sm:text-right">{t.id === 'too_few' ? `under ${t.min_n} people` : `${t.min_n}+ people`}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {r.holdout ? (
          <Panel title="Randomised holdout" id="m-hold-h" description={`${Math.round(r.holdout.share * 100)}% held out by default; reported once both groups have ${r.holdout.min_group} people.`}>
            <p className="m-0 text-proof-small text-ink-2">{r.holdout.rule} It measures what a campaign caused (adoption), not what a product does to skin.</p>
          </Panel>
        ) : null}
        {r.caveat ? (
          <Panel title="What Proof is, and isn’t" id="m-what-h">
            <p className="m-0 text-proof-small text-ink-2">{r.caveat} A pre-clinical screen and a post-launch monitor: it tells a brand which product is worth a controlled study, and never replaces one.</p>
          </Panel>
        ) : null}
      </div>
    </>
  )
}

function Cohort() {
  const { d: r } = useResearch()
  if (!r) return <Missing />
  return (
    <Panel title="Cohort facts" id="c-h" description={r.cohort?.label ?? 'Who the numbers are about.'}>
      <dl className="m-0 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Fact k="Real people (consented)" v={r.cohort ? int(r.cohort.real) : 'Unavailable right now'} />
        <Fact k="Simulated people" v={r.cohort ? int(r.cohort.simulated) : 'Unavailable right now'} />
        <Fact k="Readings" v={r.data_from && r.data_to ? `${r.data_from} to ${r.data_to}` : 'Unavailable right now'} />
        <Fact k="Consent basis" v={r.consent ?? '—'} />
        <Fact k="Suppression" v={r.suppression ? <>{r.suppression.rule} Threshold: {r.suppression.min_group} people.</> : '—'} />
        <Fact k="Simulated cohort" v={r.simulated ? `${r.simulated.note} ${int(r.simulated.people)} people over ${r.simulated.weeks} weeks, fixed seed ${r.simulated.seed}, so every number is reproducible.` : '—'} />
      </dl>
    </Panel>
  )
}

function Metrics() {
  const { d: r } = useResearch()
  if (!r?.metrics?.length) return <Missing />
  return (
    <Panel title="Metric dictionary" id="md-h" description="What each measure is, which way is wanted, and what a change does and doesn’t mean. Classical computer vision makes every number." flush>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-proof-small">
          <thead>
            <tr className="border-y border-line bg-pf-bg2 text-left text-ink-2">
              <th className="px-5 py-2.5 font-medium">Metric</th>
              <th className="px-3 py-2.5 font-medium">Unit</th>
              <th className="px-3 py-2.5 font-medium">Wanted</th>
              <th className="px-3 py-2.5 font-medium">What lower means</th>
              <th className="px-3 py-2.5 font-medium">What higher means</th>
              <th className="px-5 py-2.5 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {r.metrics.map((m) => (
              <tr key={m.id} className="border-b border-line align-top last:border-b-0">
                <th scope="row" className="px-5 py-3 text-left font-medium text-ink">
                  {m.name}
                  <span className="block font-mono text-[11px] font-normal text-ink-2">{m.id}</span>
                </th>
                <td className="px-3 py-3 text-ink-2">{m.unit_display ?? m.unit ?? '—'}</td>
                <td className="px-3 py-3 text-ink-2">{m.better ? (m.better === 'higher' ? 'Higher' : 'Lower') : 'None'}</td>
                <td className="px-3 py-3 text-ink-2">{m.lower_means ?? '—'}</td>
                <td className="px-3 py-3 text-ink-2">{m.higher_means ?? '—'}</td>
                <td className="px-5 py-3 text-ink-2">{m.outcome ? 'Yes' : m.better === null ? 'No, descriptive only' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 border-t border-line bg-pf-bg2 px-5 py-3 text-proof-small text-ink-2">A metric never means a diagnosis, a skin-health score or an age. Skin tone is descriptive only: never an outcome, never ranked.</p>
    </Panel>
  )
}

function Claims() {
  const { d: r } = useResearch()
  return (
    <>
      <Panel title="The claim line" id="cl-line-h" description="Every claim carries its basis, in these words.">
        <p className="m-0 rounded-ctl bg-pf-bg2 px-4 py-3 text-proof-body text-ink">{CLAIM_LINE('N', String(r?.weeks ?? 8))}</p>
        <p className="m-0 pt-3 text-proof-small text-ink-2">Claim drafts on a product page are written by Gemini only from that product’s measured statements and checked in code: no new numbers, no overclaims, self-reported never written as measured.</p>
      </Panel>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="What you can say" id="cl-can-h">
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {CLAIMS_CAN.map((c) => (
              <li key={c} className="flex gap-2 text-proof-small text-ink-2">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-proof-leaf" />
                {c}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="What you can’t say" id="cl-cant-h">
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {CLAIMS_CANNOT.map((c) => (
              <li key={c} className="flex gap-2 text-proof-small text-ink-2">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-pf-red" />
                {c}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title="Exports" id="cl-exp-h">
        <p className="m-0 text-proof-small text-ink-2">Claims and evidence packs built on the simulated cohort, with or without the few real people, can’t be exported for external use: the export is refused on the server and disabled here, with the reason. Only claims saved under the real cohort, citing statements that exist there, can be approved for export.</p>
      </Panel>
    </>
  )
}

function Sharing({ competitor }: { competitor: boolean | null }) {
  const { d: r } = useResearch()
  const { org } = useOrg()
  const { carry } = useRetailState()
  const v = r?.visibility
  const col = (title: string, items: string[] | undefined, tone: 'leaf' | 'red') => (
    <Panel title={title} id={`sh-${title}`}>
      {items?.length ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {items.map((c) => (
            <li key={c} className="flex gap-2 text-proof-small text-ink-2">
              <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${tone === 'leaf' ? 'bg-proof-leaf' : 'bg-pf-red'}`} />
              {c}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-proof-small text-ink-2">—</p>
      )}
    </Panel>
  )
  return (
    <>
      <Panel title="Competitor names" id="sh-comp-h">
        <p className="m-0 text-proof-small text-ink-2">
          {competitor === null ? 'A retailer policy: off by default, so brands see other brands as “Brand A”, “Brand B”.' : competitor ? 'On: brands in this instance see other brands by name (the retailer’s policy).' : 'Off: brands in this instance see other brands as “Brand A”, “Brand B” (the retailer’s policy).'}{' '}
          {org?.kind === 'retailer' ? (
            <Link to={`${sectionPath('settings')}${carry}${carry ? '&' : '?'}tab=sharing`} className="font-medium text-ink no-underline hover:underline">
              Change it in Settings →
            </Link>
          ) : null}
        </p>
      </Panel>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {col('Brands see', v?.brands_see, 'leaf')}
        {col('Brands never see', v?.brands_never_see, 'red')}
        {col('The retailer sees', v?.retailer_sees, 'leaf')}
        {col('The retailer never sees', v?.retailer_never_sees, 'red')}
      </div>
    </>
  )
}

function Glossary() {
  return (
    <Panel title="Glossary" id="gl-h" description="One plain definition per term, the same everywhere in Proof." flush>
      <dl className="m-0 flex flex-col">
        {Object.entries(GLOSSARY).map(([id, g]) => (
          <div key={id} className="grid grid-cols-1 gap-1 border-t border-line px-5 py-3 sm:grid-cols-[200px_minmax(0,1fr)]">
            <dt className="text-proof-small font-medium text-ink">{g.term}</dt>
            <dd className="m-0 text-proof-small text-ink-2">{g.text}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

/** Each product's evidence pack (the product page builds it): your range's measured products first. */
function Packs() {
  const { filters, workspace } = useRetailData()
  const { carry } = useRetailState()
  const { state } = useProducts(filters)
  const { range } = useRange()
  const ids = rangeIds(range)
  const brand = workspace.kind === 'brand' ? workspace.brand : null
  if (state.status !== 'ready') return <Bone className="h-40 w-full" />
  // statements exist only for Proven products (the api gives none below it)
  const rows = state.d.products.filter((r) => r.tier === 'proven' && (brand ? r.brand === brand : ids ? ids.has(r.product_id) : true)).sort((a, b) => (b.n ?? 0) - (a.n ?? 0))
  return (
    <Panel title="Evidence packs" id="packs-h" description="Each Proven product’s claim-ready statements, every rate with its comparison group and both group sizes, with window, method and cohort, as a print-ready page, Markdown or CSV." flush>
      {rows.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((r) => (
            <li key={r.product_id}>
              <Link to={`${sectionPath('products', r.product_id)}${carry}#ev-h`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-5 py-3 no-underline transition-colors hover:bg-pf-hover">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText size={15} strokeWidth={1.6} aria-hidden className="shrink-0 text-ink-2" />
                  <span className="truncate text-proof-body text-ink">{r.product}</span>
                  <span className="hidden truncate text-proof-small text-ink-2 sm:inline">{r.brand}</span>
                </span>
                <span className="flex items-center gap-3">
                  <ProofTierChip tier={r.tier} size="sm" />
                  <span className="text-proof-small text-ink-2 tnum">n={int(r.n)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact title="No Proven product yet" body="A product gets an evidence pack once it is Proven: a visible change above people with the same goals who do not use it, clear of chance." />
      )}
    </Panel>
  )
}

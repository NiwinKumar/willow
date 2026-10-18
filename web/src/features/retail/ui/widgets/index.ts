/**
 * Willow Proof widgets: the data-viz cards (glow stat, lime tile, rank list, pill stack, line, scrub bars,
 * pill columns, tick gauge, rings, dot matrix, radial tile). Each takes the numbers it draws as props and owns
 * its hover, keyboard and screen-reader behaviour; the sections work the numbers out from the real aggregates.
 * docs/RETAIL_BRAND.md "Widgets" has the inventory.
 */
export { Widget, type WidgetMenu } from './Widget'
export { GlowStat, type GlowChip, type GlowPoint } from './GlowStat'
export { ProgressTile } from './ProgressTile'
export { RankList, type RankRow } from './RankList'
export { BrandBars, type BrandBar } from './BrandBars'
export { PillStack, type StackSegment, type StackTone } from './PillStack'
export { LineWidget, type LineSeries } from './LineWidget'
export { ScrubBars, type ScrubBar } from './ScrubBars'
export { PillColumns, type PillColumn } from './PillColumns'
export { TickGauge } from './TickGauge'
export { RingStack, type Ring } from './RingStack'
export { RING_COLOURS } from './colours'
export { DotMatrix } from './DotMatrix'
export { RadialTile } from './RadialTile'
export { FlowChart, type FlowLink, type FlowNode, type FlowTone } from './FlowChart'
export { StreamChart, type StreamBand, type StreamDay } from './StreamChart'
export { BlobRadial, type BlobLayer } from './BlobRadial'

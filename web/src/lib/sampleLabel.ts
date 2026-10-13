/**
 * A made-up ingredient label drawn on a canvas, so anyone without a product to hand can watch
 * Gemini read one (judge tour). It is a real photo-like image to the api; nothing is pre-parsed.
 */
const LINES = [
  'NIGHT RECOVERY SERUM  30 ml / 1.0 fl oz',
  'INGREDIENTS: Aqua, Glycerin, Niacinamide, Azelaic Acid,',
  'Propanediol, Panthenol, Sodium Hyaluronate, Allantoin,',
  'Centella Asiatica Extract, Madecassoside, Ceramide NP,',
  'Cholesterol, Xanthan Gum, Carbomer, Sodium Hydroxide,',
  'Ethylhexylglycerin, Phenoxyethanol, Disodium EDTA.',
  'Niacinamide 5%  ·  Azelaic acid 10%',
  'Apply 2-3 drops to clean skin in the evening.',
  'Patch test before first use. For external use only.',
]

export async function sampleLabelFile(): Promise<File> {
  const c = document.createElement('canvas')
  c.width = 1400
  c.height = 900
  const g = c.getContext('2d')!
  g.fillStyle = '#d9d4cb'
  g.fillRect(0, 0, c.width, c.height)
  g.save()
  g.translate(700, 450)
  g.rotate(-0.025)
  g.fillStyle = '#fbfaf6'
  g.fillRect(-620, -360, 1240, 720)
  g.fillStyle = '#1d1d1b'
  g.font = '600 34px Helvetica, Arial, sans-serif'
  g.fillText('LUMEN LAB', -570, -285)
  g.font = '26px Helvetica, Arial, sans-serif'
  LINES.forEach((line, i) => g.fillText(line, -570, -215 + i * 58))
  g.restore()
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9))
  return new File([blob], 'sample-label.jpg', { type: 'image/jpeg' })
}

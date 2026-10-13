import type { Product } from '../data/types'

/**
 * Sample catalog for the UI (facts only, no reviews). Twelve well-known SKUs with representative
 * actives; prices are approximate and marked unverified until the real seed (api/seed/products.json)
 * replaces this file. Store links are search URLs until product pages are verified (docs/CATALOG_SPEC.md).
 */
const search = (store: string, q: string, region: string) => {
  const urls: Record<string, string> = {
    Nykaa: `https://www.nykaa.com/search/result/?q=${encodeURIComponent(q)}`,
    Amazon: `https://www.amazon.in/s?k=${encodeURIComponent(q)}`,
    Sephora: `https://www.sephora.com/search?keyword=${encodeURIComponent(q)}`,
    'Brand site': `https://www.google.com/search?q=${encodeURIComponent(q + ' official')}`,
  }
  return { store, url: urls[store] ?? urls['Brand site'], region }
}
const p = (id: string, brand: string, name: string, category: string, concerns: string[], actives: [string, number | null][], inci: string[], amount: number, currency: string, size: string): Product => ({
  product_id: id,
  brand,
  name,
  category,
  concerns,
  key_actives: actives.map(([n, pct]) => ({ name: n, pct })),
  inci,
  price: { amount, currency },
  size,
  region: ['IN', 'GLOBAL'],
  stores: [search('Nykaa', `${brand} ${name}`, 'IN'), search('Amazon', `${brand} ${name}`, 'IN'), search('Sephora', `${brand} ${name}`, 'US'), search('Brand site', `${brand} ${name}`, 'GLOBAL')],
  source_url: '',
  last_verified: 'sample, unverified',
})

export const CATALOG: Product[] = [
  p('the-ordinary-niacinamide-10-zinc-1', 'The Ordinary', 'Niacinamide 10% + Zinc 1%', 'serum', ['acne_blemishes', 'oiliness_shine', 'texture_pores'], [['niacinamide', 10], ['zinc pca', 1]], ['Aqua (Water)', 'Niacinamide', 'Pentylene Glycol', 'Zinc PCA', 'Dimethyl Isosorbide', 'Tamarindus Indica Seed Gum', 'Xanthan Gum', 'Isoceteth-20', 'Ethoxydiglycol', 'Phenoxyethanol', 'Chlorphenesin'], 590, 'INR', '30 ml'),
  p('minimalist-2-salicylic-acid', 'Minimalist', '2% Salicylic Acid Serum', 'serum', ['acne_blemishes', 'oiliness_shine'], [['salicylic acid', 2]], ['Aqua', 'Propanediol', 'Salicylic Acid', 'Glycerin', 'Polysorbate 20', 'Sodium Hydroxide', 'Zinc PCA', 'Phenoxyethanol'], 549, 'INR', '30 ml'),
  p('cerave-moisturising-cream', 'CeraVe', 'Moisturising Cream', 'moisturizer', ['dryness_barrier', 'redness_sensitivity'], [['ceramides', null], ['hyaluronic acid', null]], ['Aqua', 'Glycerin', 'Cetearyl Alcohol', 'Caprylic/Capric Triglyceride', 'Cetyl Alcohol', 'Ceramide NP', 'Ceramide AP', 'Ceramide EOP', 'Hyaluronic Acid', 'Cholesterol', 'Phenoxyethanol'], 1299, 'INR', '340 g'),
  p('la-roche-posay-anthelios-uvmune-400', 'La Roche-Posay', 'Anthelios UVMune 400 Invisible Fluid SPF50+', 'sunscreen', ['dark_spots_pigmentation', 'uneven_tone', 'redness_sensitivity'], [['mexoryl 400', null]], ['Aqua', 'Alcohol Denat.', 'Diisopropyl Sebacate', 'Methoxypropylamino Cyclohexenylidene Ethoxyethylcyanoacetate', 'Bis-Ethylhexyloxyphenol Methoxyphenyl Triazine', 'Ethylhexyl Salicylate', 'Glycerin'], 2150, 'INR', '50 ml'),
  p('paulas-choice-2-bha-liquid', "Paula's Choice", 'Skin Perfecting 2% BHA Liquid Exfoliant', 'exfoliant', ['acne_blemishes', 'texture_pores'], [['salicylic acid', 2]], ['Aqua', 'Methylpropanediol', 'Butylene Glycol', 'Salicylic Acid', 'Polysorbate 20', 'Camellia Oleifera Leaf Extract', 'Sodium Hydroxide', 'Tetrasodium EDTA'], 2650, 'INR', '118 ml'),
  p('cosrx-snail-96', 'COSRX', 'Advanced Snail 96 Mucin Power Essence', 'serum', ['dryness_barrier', 'dullness'], [['snail secretion filtrate', 96]], ['Snail Secretion Filtrate', 'Betaine', 'Butylene Glycol', '1,2-Hexanediol', 'Sodium Polyacrylate', 'Phenoxyethanol', 'Sodium Hyaluronate', 'Allantoin', 'Ethyl Hexanediol', 'Carbomer', 'Panthenol', 'Arginine'], 1550, 'INR', '100 ml'),
  p('beauty-of-joseon-relief-sun', 'Beauty of Joseon', 'Relief Sun: Rice + Probiotics SPF50+', 'sunscreen', ['dark_spots_pigmentation', 'uneven_tone'], [['rice extract', 30]], ['Water', 'Dibutyl Adipate', 'Propanediol', 'Diethylamino Hydroxybenzoyl Hexyl Benzoate', 'Polymethylsilsesquioxane', 'Ethylhexyl Triazone', 'Oryza Sativa (Rice) Extract', 'Niacinamide'], 1190, 'INR', '50 ml'),
  p('the-ordinary-azelaic-acid-10', 'The Ordinary', 'Azelaic Acid Suspension 10%', 'treatment', ['dark_spots_pigmentation', 'uneven_tone', 'redness_sensitivity', 'acne_blemishes'], [['azelaic acid', 10]], ['Aqua (Water)', 'Isodecyl Neopentanoate', 'Dimethicone', 'Azelaic Acid', 'Dimethicone/Bis-Isobutyl PPG-20 Crosspolymer', 'Dimethyl Isosorbide', 'Hydroxyethyl Acrylate/Sodium Acryloyldimethyl Taurate Copolymer'], 790, 'INR', '30 ml'),
  p('the-derma-co-2-kojic-acid', 'The Derma Co', '2% Kojic Acid Face Serum', 'serum', ['dark_spots_pigmentation', 'uneven_tone'], [['kojic acid', 2], ['alpha arbutin', 1]], ['Aqua', 'Propanediol', 'Kojic Acid', 'Alpha-Arbutin', 'Niacinamide', 'Glycerin', 'Sodium Hyaluronate', 'Phenoxyethanol'], 599, 'INR', '30 ml'),
  p('dot-key-retinol-serum', 'Dot & Key', 'Retinol + Ceramide Serum', 'treatment', ['fine_lines', 'texture_pores'], [['retinol', 0.3]], ['Aqua', 'Glycerin', 'Retinol', 'Ceramide NP', 'Squalane', 'Tocopherol', 'Phenoxyethanol'], 695, 'INR', '30 ml'),
  p('minimalist-10-vitamin-c', 'Minimalist', '10% Vitamin C Face Serum', 'serum', ['dullness', 'dark_spots_pigmentation'], [['ethyl ascorbic acid', 10]], ['Aqua', 'Propanediol', '3-O-Ethyl Ascorbic Acid', 'Acetyl Glucosamine', 'Glycerin', 'Phenoxyethanol'], 699, 'INR', '30 ml'),
  p('bioderma-sensibio-h2o', 'Bioderma', 'Sensibio H2O Micellar Water', 'cleanser', ['redness_sensitivity', 'dryness_barrier'], [], ['Aqua', 'PEG-6 Caprylic/Capric Glycerides', 'Fructooligosaccharides', 'Mannitol', 'Xylitol', 'Rhamnose', 'Cucumis Sativus Fruit Extract', 'Propylene Glycol', 'Cetrimonium Bromide', 'Disodium EDTA'], 1150, 'INR', '250 ml'),
]

export const CONCERN_LABEL: Record<string, string> = {
  acne_blemishes: 'blemishes',
  dark_spots_pigmentation: 'dark spots',
  uneven_tone: 'uneven tone',
  redness_sensitivity: 'redness',
  texture_pores: 'texture & pores',
  oiliness_shine: 'oiliness',
  fine_lines: 'fine lines',
  dark_circles: 'under-eye',
  dryness_barrier: 'dryness',
  dullness: 'dullness',
}

/** docs/CATALOG_SPEC.md concern -> metric map. */
export const CONCERN_METRICS: Record<string, string[]> = {
  acne_blemishes: ['blemishes', 'redness'],
  dark_spots_pigmentation: ['pigment_spots'],
  uneven_tone: ['tone_evenness'],
  redness_sensitivity: ['redness'],
  texture_pores: ['pores', 'texture'],
  oiliness_shine: ['shine'],
  fine_lines: ['lines'],
  dark_circles: ['dark_circles'],
  dryness_barrier: [],
  dullness: ['glow'],
}

/** Countries for the last survey question: where the link travels most first, then every ISO 3166 code by name. */
const TOP = ['IN', 'US', 'GB', 'CA', 'AU', 'AE', 'SG']
const ALL =
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ')

export type Country = { code: string; name: string }

export function countries(locale = 'en'): { top: Country[]; rest: Country[] } {
  let names: Intl.DisplayNames | null = null
  try {
    names = new Intl.DisplayNames([locale, 'en'], { type: 'region' })
  } catch {
    names = null
  }
  const named = (code: string): Country => ({ code, name: names?.of(code) ?? code })
  const top = TOP.map(named)
  const rest = ALL.filter((c) => !TOP.includes(c))
    .map(named)
    .sort((a, b) => a.name.localeCompare(b.name, locale))
  return { top, rest }
}

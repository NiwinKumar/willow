/** `npm test`: the app follows the language Wisp last answered in (lib/language.ts `adoptLanguage`). */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { adoptLanguage, langHeader, language } from '../src/lib/language.ts'

test("an answer's language becomes the app's; one Willow doesn't answer in is ignored", () => {
  adoptLanguage('zh-CN')
  assert.equal(language(), 'zh')
  assert.deepEqual(langHeader(), { 'X-Willow-Lang': 'zh' })
  adoptLanguage('fr')
  assert.equal(language(), 'zh')
  adoptLanguage('en')
  assert.deepEqual(langHeader(), {})
})

"""Willow's words in the person's own language (finals B3, Nov 28).

Gemini writes every explanation, story and Wisp answer in English first, where the cosmetic-language
and number validators can read it. Only an answer that passed them is translated, by a second
Gemini call told to translate faithfully, and code accepts the translation only if it quotes
exactly the same numbers as the English (any digits, Arabic or the script's own). Anything else,
a failed call, a timeout, or an unsupported language, keeps the English. Nothing a model writes
reaches a person unchecked in either language.

The UI around the words stays English; the language travels with each request as the
`X-Willow-Lang` header (web/src/lib/language.ts).
"""

import hashlib
import logging
import re
from collections import OrderedDict
from threading import Lock

from fastapi import Header
from pydantic import BaseModel, Field

from app import gemini, numbers

log = logging.getLogger("willow.translate")

# code -> the language's own name (shown in the app) and its English name (told to Gemini)
LANGUAGES: dict[str, tuple[str, str]] = {
    "en": ("English", "English"),
    "hi": ("हिन्दी", "Hindi"),
    "ta": ("தமிழ்", "Tamil"),
    "id": ("Bahasa Indonesia", "Indonesian"),
    "ms": ("Bahasa Melayu", "Malay"),
    "zh": ("中文", "Simplified Chinese"),
    "ja": ("日本語", "Japanese"),
    "ko": ("한국어", "Korean"),
    "th": ("ไทย", "Thai"),
    "vi": ("Tiếng Việt", "Vietnamese"),
    "tl": ("Filipino", "Filipino"),
}
TIMEOUT_MS = 12_000
_CACHE_MAX = 2_000  # translated texts kept per instance (a person's own words: never in kept.py)
_cache: OrderedDict[str, str] = OrderedDict()
_lock = Lock()

INSTRUCTIONS = """Translate each item of `texts` into {lang}, faithfully.
- Same meaning, same order, one translation per item. Add nothing, drop nothing, no notes.
- Keep every number exactly as written, in Arabic digits, with its symbol unit (%, a*, pts, ±).
  Translate words such as weeks, days and nights.
- Keep product names, brand names and ingredient (INCI) names as written in the source.
- Keep every [product:...] and [metric:...] reference and every ** or == mark exactly as written.
- Keep the calm, plain, cosmetic tone. Use everyday words a person would use with a friend.
- Cosmetic words only: never the words for acne, pimples, eczema, rosacea, psoriasis, melasma, any
  disease, diagnosis, cure, medical treatment, medicine, infection, whitening or fair skin. Say
  "blemishes" as spots or marks on the skin, "dark spots" as dark marks, "redness" as redness."""

# Words a translation may not bring in (the English check, explain.BANNED, cannot read other
# scripts): disease names, diagnosis, cure and treatment, medicine, infection, whitening. Matched as
# substrings (Thai, Chinese and Japanese have no spaces); words that are everyday skincare
# vocabulary in the language (Malay "rawatan", Thai "รักษา" alone) are left out to avoid false
# rejections. A hit keeps the English. Reviewed by hand; extend with native speakers.
BANNED_BY_LANG: dict[str, tuple[str, ...]] = {
    "hi": (
        "मुंहासे",
        "मुँहासे",
        "एक्ने",
        "एक्जिमा",
        "रोसैसिया",
        "सोरायसिस",
        "मेलास्मा",
        "डर्मेटाइटिस",
        "मेलेनोमा",
        "कैंसर",
        "रोग",
        "बीमारी",
        "निदान",
        "इलाज",
        "दवा",
        "संक्रमण",
        "गोरापन",
        "गोरी त्वचा",
        "क्लिनिकल",
    ),
    "ta": (
        "முகப்பரு",
        "எக்ஸிமா",
        "சொரியாசிஸ்",
        "மெலஸ்மா",
        "புற்றுநோய்",
        "நோய்",
        "சிகிச்சை",
        "மருந்து",
        "தொற்று",
    ),
    "id": (
        "jerawat",
        "eksim",
        "rosacea",
        "psoriasis",
        "melasma",
        "dermatitis",
        "melanoma",
        "kanker",
        "penyakit",
        "diagnosis",
        "menyembuhkan",
        "pengobatan",
        "obat",
        "infeksi",
        "memutihkan",
        "pemutih",
        "klinis",
        "terapi",
    ),
    "ms": (
        "jerawat",
        "ekzema",
        "rosacea",
        "psoriasis",
        "melasma",
        "dermatitis",
        "melanoma",
        "kanser",
        "penyakit",
        "diagnosis",
        "menyembuhkan",
        "perubatan",
        "ubat",
        "jangkitan",
        "memutihkan",
        "pemutih",
        "klinikal",
        "terapi",
    ),
    "zh": (
        "痤疮",
        "粉刺",
        "青春痘",
        "湿疹",
        "酒渣",
        "银屑病",
        "牛皮癣",
        "黄褐斑",
        "皮炎",
        "黑色素瘤",
        "癌",
        "疾病",
        "诊断",
        "治愈",
        "治疗",
        "药物",
        "处方",
        "感染",
        "美白",
        "临床",
    ),
    "ja": (
        "ニキビ",
        "にきび",
        "痤瘡",
        "湿疹",
        "酒さ",
        "乾癬",
        "肝斑",
        "皮膚炎",
        "黒色腫",
        "メラノーマ",
        "癌",
        "皮膚がん",
        "病気",
        "疾患",
        "診断",
        "治療",
        "治す",
        "治る",
        "処方",
        "感染",
        "美白",
        "臨床",
    ),
    "ko": (
        "여드름",
        "습진",
        "주사비",
        "건선",
        "피부염",
        "흑색종",
        "피부암",
        "질병",
        "질환",
        "진단",
        "치료",
        "완치",
        "약물",
        "처방",
        "감염",
        "미백",
        "임상",
    ),
    "th": (
        "สิว",
        "กลาก",
        "สะเก็ดเงิน",
        "ฝ้า",
        "ผิวหนังอักเสบ",
        "มะเร็ง",
        "โรค",
        "วินิจฉัย",
        "รักษาโรค",
        "รักษาสิว",
        "ติดเชื้อ",
        "ไวท์เทนนิ่ง",
        "ผิวขาว",
        "คลินิก",
    ),
    "vi": (
        "mụn",
        "chàm",
        "viêm da",
        "vảy nến",
        "nám",
        "ung thư",
        "bệnh",
        "chẩn đoán",
        "chữa",
        "điều trị",
        "thuốc",
        "nhiễm trùng",
        "làm trắng",
        "lâm sàng",
    ),
    "tl": (
        "tagihawat",
        "eksema",
        "psoriasis",
        "melasma",
        "kanser",
        "sakit sa balat",
        "diagnosis",
        "gamot",
        "lunas",
        "impeksyon",
        "pampaputi",
        "klinikal",
    ),
}


def clean_words(translated: str, lang: str) -> bool:
    """No banned word in the translation: the language's own list, and the English list for any
    English word left in it."""
    from app import explain

    low = translated.lower()
    if any(w.lower() in low for w in BANNED_BY_LANG.get(lang, ())):
        return False
    return not explain.BANNED.search(translated)


class _Out(BaseModel):
    texts: list[str] = Field(description="the translations, one per input item, same order")


def lang_header(x_willow_lang: str | None = Header(default=None)) -> str:
    """The person's language from the request (FastAPI dependency); English when absent or
    unsupported."""
    return normalise(x_willow_lang)


def normalise(lang: str | None) -> str:
    code = (lang or "en").strip().lower().split("-")[0]
    return code if code in LANGUAGES else "en"


def _values(text: str) -> set[float]:
    """The numbers in a text as values (so 8, 8.0 and ८ are the same number)."""
    out: set[float] = set()
    for m in numbers.NUMBER.findall(text):
        try:
            out.add(round(float(m.replace("−", "-").replace(",", ".").lstrip("+")), 4))
        except ValueError:
            continue
    return out


# Wisp's inline references ([product:id], [metric:id]) must come through untouched
_TOKEN = re.compile(r"\[(?:product|metric):[^\]]+\]")


def same_numbers(source: str, translated: str) -> bool:
    """The translation quotes exactly the numbers of the source, no more and no fewer, and keeps
    every inline product or metric reference as it was."""
    return _values(source) == _values(translated) and sorted(_TOKEN.findall(source)) == sorted(
        _TOKEN.findall(translated)
    )


def _key(lang: str, text: str) -> str:
    return hashlib.sha256(f"{lang}\n{text}".encode()).hexdigest()


def texts(items: list[str], lang: str) -> list[str]:
    """`items` in `lang`, each kept in English where its translation failed the number check.
    One Gemini call for everything not translated before; English in, English out."""
    lang = normalise(lang)
    if lang == "en" or not items:
        return list(items)
    out: list[str | None] = []
    todo: list[int] = []
    with _lock:
        for i, t in enumerate(items):
            hit = _cache.get(_key(lang, t)) if t.strip() else t
            out.append(hit)
            if hit is None:
                todo.append(i)
    if todo:
        try:
            res = gemini.generate_json(
                "translate",
                [str({"texts": [items[i] for i in todo]})],
                _Out,
                instructions=INSTRUCTIONS.format(lang=LANGUAGES[lang][1]),
                timeout_ms=TIMEOUT_MS,
            )
            got = res.texts if len(res.texts) == len(todo) else []
        except Exception as exc:  # Gemini down or slow, a schema failure: English stays
            log.warning("translate to %s failed: %s", lang, type(exc).__name__)
            got = []
        for j, i in enumerate(todo):
            t = got[j] if j < len(got) else None
            if t and same_numbers(items[i], t) and clean_words(t, lang):
                out[i] = t
                with _lock:
                    _cache[_key(lang, items[i])] = t
                    while len(_cache) > _CACHE_MAX:
                        _cache.popitem(last=False)
            else:
                if t:
                    log.info(
                        "translate to %s: numbers or words failed the check, kept English", lang
                    )
                out[i] = items[i]
    return [o if o is not None else items[i] for i, o in enumerate(out)]


def one(text: str | None, lang: str) -> str | None:
    if not text:
        return text
    return texts([text], lang)[0]


def explanation(expl: dict | None, lang: str) -> dict | None:
    """A stored explanation (explain.py) with its words in `lang`: headline, each metric's
    summary, next steps and the disclaimer, in one call."""
    if not expl or normalise(lang) == "en":
        return expl
    items = expl.get("items") or []
    words = [
        expl.get("headline") or "",
        *[i.get("summary") or "" for i in items],
        *(expl.get("next_steps") or []),
        expl.get("disclaimer") or "",
    ]
    got = texts(words, lang)
    n = len(items)
    steps = expl.get("next_steps") or []
    return {
        **expl,
        "headline": got[0],
        "items": [{**it, "summary": got[1 + k]} for k, it in enumerate(items)],
        "next_steps": got[1 + n : 1 + n + len(steps)],
        "disclaimer": got[-1],
        "lang": normalise(lang),
    }


def wisp_reply(reply: dict, lang: str) -> dict:
    """Wisp's validated answer with its words in `lang`: text blocks, bullets and the follow-up
    questions (one call); `message`, the plain form, is rebuilt from the translated blocks."""
    if normalise(lang) == "en":
        return reply
    from app import advisor_blocks

    blocks = reply.get("blocks") or []
    words: list[str] = []
    for b in blocks:
        if b.get("type") in ("answer", "note"):
            words.append(b["text"])
        elif b.get("type") == "bullets":
            words.extend(b["items"])
    follow = reply.get("follow_up_suggestions") or []
    got = iter(texts([*words, *follow], lang))
    out_blocks = []
    for b in blocks:
        if b.get("type") in ("answer", "note"):
            out_blocks.append({**b, "text": next(got)})
        elif b.get("type") == "bullets":
            out_blocks.append({**b, "items": [next(got) for _ in b["items"]]})
        else:
            out_blocks.append(b)
    follow_t = [next(got) for _ in follow]
    names = {p["product_id"]: f"{p['brand']} {p['name']}" for p in reply.get("products") or []}
    return {
        **reply,
        "blocks": out_blocks,
        "follow_up_suggestions": follow_t,
        "message": advisor_blocks.message_of(out_blocks, names, advisor_blocks.METRIC_LABELS),
        "lang": normalise(lang),
    }

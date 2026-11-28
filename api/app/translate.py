"""Willow's words in the person's own language (finals B3, Nov 28).

Gemini writes every explanation, story and Wisp answer in English first, where the cosmetic-language
and number validators can read it. Only an answer that passed them is translated, by a second
Gemini call told to translate faithfully, and code accepts the translation only if it quotes
exactly the same numbers as the English (any digits, Arabic or the script's own). Anything else,
a failed call, a timeout, or an unsupported language, keeps the English. Nothing a model writes
reaches a person unchecked in either language.

The UI around the words stays English, except the fixed words an answer leans on (measurement
names, verdict and card labels: the glossary below). The language travels with each request as
the `X-Willow-Lang` header (web/src/lib/language.ts).
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


# Wisp's inline references ([product:id], [metric:id]) must come through untouched
_TOKEN = re.compile(r"\[(?:product|metric):[^\]]+\]")


# The fixed words of the app that an answer leans on: the measurement names and the verdict
# and card labels drawn around Wisp's words. One translation each, used three ways: told to
# Gemini as a glossary (so "redness" is the same word in every sentence), put in place of any
# English measurement name a translation left behind ("你的redness读数", Nov 28), and sent with
# the answer (`labels`) so the app draws its [metric:...] names, verdict chips and card links in
# the same language. Checked against BANNED_BY_LANG by a test; extend with native speakers.
METRIC_ORDER = (
    "tone_ita", "pigment_spots", "tone_evenness", "redness", "blemishes", "pores", "texture",
    "lines", "dark_circles", "shine", "glow",
)  # fmt: skip
UI_ORDER = (
    "within_range", "beyond_range", "not_compared", "baseline", "not_enough", "improved",
    "other_way", "shifted", "progress", "open", "routine", "details", "no_flags", "check_this",
)  # fmt: skip
# English, as the app writes them (web lib/verdict.ts, lib/checkWords.ts, advisor widgets).
UI_ENGLISH = (
    "Within your normal range", "Changed beyond your normal range", "Could not compare",
    "Baseline", "Not enough data yet", "Improved", "Moved the other way", "Shifted", "Progress",
    "Open", "Routine", "Details", "No flags for you", "Check this",
)  # fmt: skip
# The measurement names as English sentences use them (lower case), longest first.
METRIC_ENGLISH = {
    "tone_ita": ("skin tone",),
    "pigment_spots": ("dark spots",),
    "tone_evenness": ("tone evenness",),
    "redness": ("redness",),
    "blemishes": ("blemishes",),
    "pores": ("pores",),
    "texture": ("skin texture", "texture"),
    "lines": ("fine lines",),
    "dark_circles": ("under-eye",),
    "shine": ("shine",),
    "glow": ("glow",),
}
_METRICS: dict[str, tuple[str, ...]] = {
    "hi": ("त्वचा की रंगत", "गहरे धब्बे", "रंगत की एकरूपता", "लालिमा", "दाग-धब्बे", "रोमछिद्र",
           "त्वचा की बनावट", "महीन रेखाएँ", "आँखों के नीचे", "तैलीय चमक", "निखार"),
    "ta": ("தோல் நிறம்", "கரும்புள்ளிகள்", "நிறச் சீர்மை", "சிவத்தல்", "சிறு புள்ளிகள்", "துளைகள்",
           "தோல் அமைப்பு", "மெல்லிய கோடுகள்", "கண்களுக்குக் கீழ்", "எண்ணெய்ப் பளபளப்பு", "பொலிவு"),
    "id": ("warna kulit", "bintik gelap", "kerataan warna kulit", "kemerahan", "noda kulit",
           "pori-pori", "tekstur kulit", "garis halus", "area bawah mata", "kilap", "kilau"),
    "ms": ("ton kulit", "tompok gelap", "kesekataan ton kulit", "kemerahan", "cela kulit",
           "liang pori", "tekstur kulit", "garis halus", "bawah mata", "kilat", "seri"),
    "zh": ("肤色", "暗斑", "肤色均匀度", "泛红", "瑕疵", "毛孔", "纹理", "细纹", "眼下", "油光",
           "光泽"),
    "ja": ("肌の色", "シミ", "肌色の均一さ", "赤み", "肌のポツポツ", "毛穴", "キメ", "小じわ",
           "目の下", "テカリ", "ツヤ"),
    "ko": ("피부 톤", "어두운 반점", "피부 톤 균일도", "붉은기", "잡티", "모공", "피부결", "잔주름",
           "눈 밑", "번들거림", "윤기"),
    "th": ("สีผิว", "จุดด่างดำ", "ความสม่ำเสมอของสีผิว", "รอยแดง", "จุดบนผิว", "รูขุมขน", "เนื้อผิว",
           "ริ้วรอย", "ใต้ตา", "ความมัน", "ความเปล่งปลั่ง"),
    "vi": ("tông da", "đốm sẫm màu", "độ đều màu da", "độ đỏ", "khuyết điểm trên da",
           "lỗ chân lông", "kết cấu da", "nếp nhăn nhỏ", "vùng dưới mắt", "độ bóng dầu",
           "độ rạng rỡ"),
    "tl": ("kulay ng balat", "maiitim na marka", "pagkakapantay ng kulay", "pamumula",
           "mga marka sa balat", "mga butas ng balat", "tekstura ng balat", "mga pinong linya",
           "ilalim ng mata", "kintab", "kinang"),
}  # fmt: skip
_UI: dict[str, tuple[str, ...]] = {
    "hi": ("आपकी सामान्य सीमा के भीतर", "आपकी सामान्य सीमा से आगे बदला", "तुलना नहीं हो सकी",
           "शुरुआती बिंदु", "अभी पर्याप्त डेटा नहीं", "बेहतर हुआ", "दूसरी दिशा में गया", "बदला",
           "प्रगति", "खोलें", "रूटीन", "विवरण", "आपके लिए कोई चेतावनी नहीं", "इसे जाँचें"),
    "ta": ("உங்கள் வழக்கமான வரம்புக்குள்", "உங்கள் வழக்கமான வரம்பைத் தாண்டி மாறியது",
           "ஒப்பிட முடியவில்லை", "தொடக்க அளவு", "இன்னும் போதிய தரவு இல்லை", "மேம்பட்டது",
           "எதிர்த் திசையில் நகர்ந்தது", "மாறியது", "முன்னேற்றம்", "திற", "வழக்கம்", "விவரங்கள்",
           "உங்களுக்கு எச்சரிக்கை இல்லை", "இதைச் சரிபார்க்கவும்"),
    "id": ("Dalam rentang normal Anda", "Berubah melampaui rentang normal Anda",
           "Tidak dapat dibandingkan", "Titik awal", "Data belum cukup", "Membaik",
           "Bergerak ke arah sebaliknya", "Bergeser", "Progres", "Buka", "Rutinitas", "Detail",
           "Tidak ada tanda untuk Anda", "Periksa ini"),
    "ms": ("Dalam julat biasa anda", "Berubah melebihi julat biasa anda",
           "Tidak dapat dibandingkan", "Titik permulaan", "Data belum mencukupi",
           "Bertambah baik", "Bergerak ke arah sebaliknya", "Beralih", "Kemajuan", "Buka",
           "Rutin", "Butiran", "Tiada tanda untuk anda", "Semak ini"),
    "zh": ("在你的正常范围内", "变化超出你的正常范围", "无法比较", "基线", "数据还不够", "有改善",
           "朝另一方向变化", "有变化", "进展", "打开", "护肤步骤", "详情", "没有针对你的提示",
           "请留意"),
    "ja": ("いつもの範囲内", "いつもの範囲を超えて変化", "比較できませんでした", "基準",
           "データがまだ足りません", "改善", "逆の方向に変化", "変化", "経過", "開く",
           "ルーティン", "詳細", "あなたへの注意点なし", "要確認"),
    "ko": ("평소 범위 안", "평소 범위를 넘어 변화", "비교할 수 없음", "기준점", "아직 데이터 부족",
           "개선됨", "반대 방향으로 변화", "변화", "진행 상황", "열기", "루틴", "자세히",
           "해당 주의 사항 없음", "확인 필요"),
    "th": ("อยู่ในช่วงปกติของคุณ", "เปลี่ยนเกินช่วงปกติของคุณ", "เปรียบเทียบไม่ได้", "จุดเริ่มต้น",
           "ข้อมูลยังไม่พอ", "ดีขึ้น", "เปลี่ยนไปอีกทาง", "เปลี่ยน", "ความคืบหน้า", "เปิด", "รูทีน",
           "รายละเอียด", "ไม่มีข้อควรระวังสำหรับคุณ", "ตรวจสอบสิ่งนี้"),
    "vi": ("Trong khoảng bình thường của bạn", "Thay đổi vượt khoảng bình thường của bạn",
           "Không thể so sánh", "Mốc ban đầu", "Chưa đủ dữ liệu", "Cải thiện",
           "Thay đổi theo hướng ngược lại", "Thay đổi", "Tiến trình", "Mở", "Quy trình",
           "Chi tiết", "Không có lưu ý nào cho bạn", "Cần kiểm tra"),
    "tl": ("Nasa loob ng karaniwan mong saklaw", "Nagbago nang lampas sa karaniwan mong saklaw",
           "Hindi maikumpara", "Panimulang batayan", "Kulang pa ang datos", "Bumuti",
           "Gumalaw sa kabilang direksyon", "Nagbago", "Progreso", "Buksan", "Routine",
           "Detalye", "Walang babala para sa iyo", "Suriin ito"),
}  # fmt: skip


def labels(lang: str | None) -> dict[str, dict[str, str]] | None:
    """{"metrics": {metric_id: name}, "ui": {key: label}} in `lang`; None for English (the app's
    own words) or a language without a glossary."""
    code = normalise(lang)
    if code not in _METRICS:
        return None
    return {
        "metrics": dict(zip(METRIC_ORDER, _METRICS[code], strict=True)),
        "ui": dict(zip(UI_ORDER, _UI[code], strict=True)),
    }


def _glossary_lines(lang: str) -> str:
    got = labels(lang)
    if not got:
        return ""
    pairs = [(METRIC_ENGLISH[m][-1], got["metrics"][m]) for m in METRIC_ORDER]
    pairs += list(zip(UI_ENGLISH[:8], _UI[lang][:8], strict=True))
    listed = "; ".join(f"{en} = {own}" for en, own in pairs)
    return (
        "\n- Use exactly these words for the app's fixed terms, every time: "
        f"{listed}.\n- Leave no English word for a measurement in the translation."
    )


# An English measurement name still standing in a translation, in lower case and outside
# [metric:...] references (a capitalised word may be part of a product's own name: left alone).
_STRAY = re.compile(
    r"(?<![A-Za-z\[:_-])("
    + "|".join(
        re.escape(w)
        for w in sorted({w for ws in METRIC_ENGLISH.values() for w in ws}, key=len, reverse=True)
    )
    + r")(?![A-Za-z\]_-])"
)
_STRAY_TO_ID = {w: m for m, ws in METRIC_ENGLISH.items() for w in ws}


def stray_english(text: str) -> list[str]:
    """English measurement names left in a translated text (outside its references)."""
    return _STRAY.findall(_TOKEN.sub(" ", text))


def localise(text: str, lang: str) -> str:
    """A translation with any English measurement name it left behind put into the language's
    own word (the glossary's), references untouched."""
    got = labels(lang)
    if not got or not _STRAY.search(text):
        return text
    parts = re.split(f"({_TOKEN.pattern})", text)
    return "".join(
        part
        if _TOKEN.fullmatch(part)
        else _STRAY.sub(lambda m: got["metrics"][_STRAY_TO_ID[m.group(1)]], part)
        for part in parts
    )


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


# --- The language a question was written in (Nov 28: no picker, Wisp answers in kind) --------
#
# Decided in code, per question, before any Gemini call: no extra model round trip, the same
# answer every time, and it also covers replies that never reach Gemini (a Model Armor refusal).
# Non-Latin scripts are told apart by their Unicode blocks. Latin-script languages use
# Vietnamese's own letters (ơ ư đ ă and the stacked tone marks), then a count of everyday
# function words for English, Indonesian or Malay, Filipino and Vietnamese (Indonesian against
# Malay by the words only one of them uses). Chosen over a `question_language`
# field on the advisor's Gemini reply because that would change the advisor's schema, trust a
# model with a label code can read, and be unknown on the refusal path. Its limits: Hindi or
# Tamil typed in Latin letters, and Vietnamese without its marks, read as English.

# (language, weight, ranges). The weight puts scripts on one scale against Latin letters: one
# Chinese or Japanese character, or one Hangul syllable, carries about a short English word.
_SCRIPTS: tuple[tuple[str, int, tuple[tuple[int, int], ...]], ...] = (
    ("hi", 1, ((0x0900, 0x097F),)),
    ("ta", 1, ((0x0B80, 0x0BFF),)),
    ("th", 1, ((0x0E00, 0x0E7F),)),
    ("ko", 3, ((0xAC00, 0xD7AF), (0x1100, 0x11FF), (0x3130, 0x318F))),
    ("ja", 3, ((0x3040, 0x30FF),)),  # kana: only Japanese writes it
    ("zh", 3, ((0x4E00, 0x9FFF), (0x3400, 0x4DBF))),  # Han: Chinese, or Japanese with kana
)
_WEIGHT = {code: weight for code, weight, _ in _SCRIPTS}


def _script(c: str) -> str | None:
    o = ord(c)
    return next(
        (code for code, _, ranges in _SCRIPTS if any(lo <= o <= hi for lo, hi in ranges)), None
    )


def _is_latin(c: str) -> bool:
    o = ord(c)
    return o < 0x250 or 0x1E00 <= o <= 0x1EFF


_VI_LETTERS = re.compile("[ơƠưƯđĐăĂẠ-ỹ]")
_WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)?")
_LATIN_WORD = re.compile(r"[A-Za-zÀ-ɏḀ-ỿ]+")

# Everyday function words, lower case. A word two languages share is left out of both (English
# "at" and "may" are also Filipino; "dapat" is Malay and Filipino). "ok", "yes", "thanks" and
# the like are in none: alone they say nothing about the language.
_EN = frozenset((
    "the", "a", "an", "is", "are", "am", "was", "were", "be", "been", "i", "i'm", "my", "me",
    "you", "your", "it", "it's", "its", "this", "that", "these", "those", "what", "how", "why",
    "when", "which", "who", "can", "should", "could", "would", "will", "do", "does", "did",
    "don't", "use", "using", "with", "for", "of", "to", "in", "on", "and", "or", "but", "not",
    "have", "has", "any", "some", "much", "many", "more", "too", "after", "before", "than", "if",
    "there", "their", "they", "we", "our", "so", "also", "just", "still", "really", "very",
    "about", "into", "from"
))  # fmt: skip
# shared by Indonesian and Malay
_ID_MS = frozenset((
    "saya", "aku", "ini", "itu", "dan", "yang", "untuk", "apa", "ada", "dengan", "di", "ke",
    "dari", "pada", "tidak", "sudah", "belum", "lagi", "juga", "atau", "jika", "kalau", "perlu",
    "sangat", "lebih", "kulit", "muka", "pakai", "malam", "pagi", "sebelum", "berapa", "lama",
    "mengapa", "bagaimana", "boleh", "produk", "minggu", "hari", "semua", "sekarang", "anda",
    "baik", "mana", "sebab", "tak", "kenapa", "terima", "kasih"
))  # fmt: skip
_ID = frozenset((
    "bisa", "wajah", "gimana", "kapan", "karena", "saja", "mau", "kamu", "nggak", "gak", "enggak",
    "banget", "sih", "dong", "aja", "apakah", "harus", "setelah", "sesudah", "pakainya", "cocok"
))  # fmt: skip
_MS = frozenset((
    "guna", "gunakan", "selepas", "macam", "bila", "kerana", "sahaja", "mahu", "nak", "awak",
    "adakah", "mesti", "ialah"
))  # fmt: skip
_TL = frozenset((
    "ang", "ng", "mga", "sa", "na", "ko", "ako", "ba", "po", "ano", "paano", "bakit", "kailan",
    "gamitin", "gabi", "umaga", "balat", "mukha", "pwede", "puwede", "lang", "naman", "kasi",
    "yung", "ito", "iyan", "nito", "ka", "mo", "siya", "hindi", "akin", "ay", "rin", "din",
    "ninyo", "natin", "kong", "kung"
))  # fmt: skip
# Vietnamese words with their marks (a mark-light question: "Mình nên dùng gì?")
_VI = frozenset((
    "tôi", "có", "không", "này", "gì", "nên", "dùng", "của", "và", "là", "được", "với", "mình",
    "bạn", "thế", "nào", "khi", "buổi", "tối", "sáng", "làm", "bị", "mặt", "kem"
))  # fmt: skip


def detect(text: str | None, fallback: str = "en") -> str:
    """The language `text` is written in, from Willow's list. `fallback` (the language the app is
    in) answers what the text can't tell: no words ("ok", a product name, a photo alone) or a tie.
    A language Willow doesn't answer in reads as English."""
    fallback = normalise(fallback)
    if not text or not text.strip():
        return fallback
    scores = dict.fromkeys([code for code, _, _ in _SCRIPTS], 0)
    other = 0  # letters of a script Willow doesn't answer in (Arabic, Cyrillic, Bengali...)
    for c in text:
        code = _script(c)
        if code:
            scores[code] += _WEIGHT[code]
        elif c.isalpha() and not _is_latin(c):
            other += 1
    if scores["ja"]:  # kana with Han: Japanese
        scores["ja"] += scores.pop("zh")
    # Latin words that look like names (CeraVe, PM, SPF50) are left out of the weighing, so an
    # English product name inside a Hindi or Chinese question doesn't outweigh the question.
    latin = sum(len(w) for w in _LATIN_WORD.findall(text) if w.islower())
    code, best = max(scores.items(), key=lambda kv: kv[1])
    if best and best >= latin:
        return code
    if other > latin:
        return "en"
    if len(_VI_LETTERS.findall(text)) >= 2:
        return "vi"
    words = [w.lower().replace("’", "'") for w in _WORD.findall(text)]
    votes = {
        "en": sum(w in _EN for w in words),
        "idms": sum(w in _ID_MS or w in _ID or w in _MS for w in words),
        "tl": sum(w in _TL for w in words),
        "vi": sum(w in _VI for w in words),
    }
    top = max(votes.values())
    if not top or list(votes.values()).count(top) > 1:
        return fallback
    code = next(c for c, n in votes.items() if n == top)
    if code != "idms":
        return code
    id_, ms = sum(w in _ID for w in words), sum(w in _MS for w in words)
    if id_ != ms:
        return "id" if id_ > ms else "ms"
    return fallback if fallback in ("id", "ms") else "id"


def _values(text: str) -> set[float]:
    """The numbers in a text as values (so 8, 8.0 and ८ are the same number)."""
    out: set[float] = set()
    for m in numbers.NUMBER.findall(text):
        try:
            out.add(round(float(m.replace("−", "-").replace(",", ".").lstrip("+")), 4))
        except ValueError:
            continue
    return out


def same_numbers(source: str, translated: str) -> bool:
    """The translation quotes exactly the numbers of the source, no more and no fewer, and keeps
    every inline product or metric reference as it was."""
    return _values(source) == _values(translated) and sorted(_TOKEN.findall(source)) == sorted(
        _TOKEN.findall(translated)
    )


def _key(lang: str, text: str) -> str:
    return hashlib.sha256(f"{lang}\n{text}".encode()).hexdigest()


# Languages not written in Latin letters: an English phrase left in a translation stands out,
# and can be told from the names that rightly stay as written (products, brands, ingredients).
NON_LATIN = ("hi", "ta", "zh", "ja", "ko", "th")
# A run of two or more English words with an everyday word in it ("Overlap to check") is a
# phrase left untranslated; product and ingredient names ("Low pH Good Morning Gel Cleanser",
# "betaine salicylate") almost never carry one.
_ENGLISH_RUN = re.compile(r"[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*)+")
_EVERYDAY = frozenset(
    [
        "a",
        "an",
        "the",
        "to",
        "of",
        "for",
        "with",
        "your",
        "you",
        "is",
        "are",
        "was",
        "in",
        "on",
        "at",
        "by",
        "from",
        "not",
        "no",
        "or",
        "and",
        "this",
        "that",
        "it",
        "check",
        "use",
        "than",
        "as",
        "be",
        "can",
        "may",
        "more",
        "less",
        "about",
        "same",
        "each",
        "every",
        "when",
        "if",
        "but",
        "so",
    ]
)
RETRY_NOTE = (
    "\n- An earlier translation left English phrases in. Translate every English phrase; only "
    "product names, brand names and ingredient (INCI) names stay as written."
)


def left_in_english(text: str, lang: str) -> list[str]:
    """English phrases a translation into a non-Latin-script language left standing (outside
    its [product:...] and [metric:...] references)."""
    if lang not in NON_LATIN:
        return []
    return [
        run
        for run in _ENGLISH_RUN.findall(_TOKEN.sub(" ", text))
        if any(w in _EVERYDAY for w in run.split())
    ]


def _ask(sources: list[str], lang: str, note: str = "") -> list[str]:
    """One translation call; [] when it fails or answers with the wrong count."""
    try:
        res = gemini.generate_json(
            "translate",
            [str({"texts": sources})],
            _Out,
            instructions=INSTRUCTIONS.format(lang=LANGUAGES[lang][1])
            + _glossary_lines(lang)
            + note,
            timeout_ms=TIMEOUT_MS,
        )
    except Exception as exc:  # Gemini down or slow, a schema failure: English stays
        log.warning("translate to %s failed: %s", lang, type(exc).__name__)
        return []
    return res.texts if len(res.texts) == len(sources) else []


def _accepted(source: str, translated: str | None, lang: str) -> str | None:
    """The translation as Willow shows it (measurement names in the language's own words), or
    None when it changed a number, lost a reference or brought in a banned word."""
    t = localise(translated, lang) if translated else None
    return t if t and same_numbers(source, t) and clean_words(t, lang) else None


def texts(items: list[str], lang: str) -> list[str]:
    """`items` in `lang`, each kept in English where its translation failed the number check.
    One Gemini call for everything not translated before (and one more for any item that came
    back with an English phrase left in it); English in, English out."""
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
        got = _ask([items[i] for i in todo], lang)
        kept = {
            i: _accepted(items[i], got[j] if j < len(got) else None, lang)
            for j, i in enumerate(todo)
        }
        # an English phrase left standing: asked once more, used only if it comes back clean
        again = [i for i in todo if kept[i] and left_in_english(kept[i], lang)]
        if again:
            second = _ask([items[i] for i in again], lang, RETRY_NOTE)
            for j, i in enumerate(again):
                better = _accepted(items[i], second[j] if j < len(second) else None, lang)
                if better and not left_in_english(better, lang):
                    kept[i] = better
        for i in todo:
            if kept[i]:
                out[i] = kept[i]
                with _lock:
                    _cache[_key(lang, items[i])] = kept[i]
                    while len(_cache) > _CACHE_MAX:
                        _cache.popitem(last=False)
            else:
                log.info("translate to %s: no translation passed the checks, kept English", lang)
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
    """Wisp's validated answer with its words in `lang`: text blocks, bullets, the follow-up
    questions and any pairing reason on its product cards (one call); `message`, the plain form,
    is rebuilt from the translated blocks with the language's own measurement names, and
    `labels` carries those names and the fixed card words for the app to draw. An answer whose
    translation failed stays English throughout (no `lang`, no `labels`)."""
    code = normalise(lang)
    if code == "en":
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
    pairings = reply.get("pairings") or {}
    reasons = [x for p in pairings.values() for x in (p["issue"], p["suggestion"])]
    source = [*words, *follow, *reasons]
    translated = texts(source, code)
    if words and translated[: len(words)] == words:
        return reply  # nothing came back translated: one language, not two
    got = iter(translated)
    out_blocks = []
    for b in blocks:
        if b.get("type") in ("answer", "note"):
            out_blocks.append({**b, "text": next(got)})
        elif b.get("type") == "bullets":
            out_blocks.append({**b, "items": [next(got) for _ in b["items"]]})
        else:
            out_blocks.append(b)
    follow_t = [next(got) for _ in follow]
    pairings_t = {
        pid: {**p, "issue": next(got), "suggestion": next(got)} for pid, p in pairings.items()
    }
    names = {p["product_id"]: f"{p['brand']} {p['name']}" for p in reply.get("products") or []}
    own = labels(code)
    return {
        **reply,
        "blocks": out_blocks,
        "follow_up_suggestions": follow_t,
        **({"pairings": pairings_t} if pairings else {}),
        "message": advisor_blocks.message_of(
            out_blocks, names, own["metrics"] if own else advisor_blocks.METRIC_LABELS
        ),
        "lang": code,
        **({"labels": own} if own else {}),
    }

# Word timestamps (faster-whisper) for each take -> <take>_<k>.words.json; reports script coverage per line.
import json, re, sys, difflib
from faster_whisper import WhisperModel
from pathlib import Path
WEB = Path(__file__).resolve().parents[2]  # web/
V = json.load(open(str(WEB / 'src/features/journey/voice.json')))['lines']
NUM = {'90': ['ninety'], '15': ['fifteen'], '26': ['twenty', 'six'], '8': ['eight'], '3': ['three'], '1': ['one'], '2': ['two'], '5': ['five'], '7': ['seven'], '4': ['four'], '6': ['six']}
def toks(s):
    out = []
    for w in re.findall(r"[a-z0-9']+", s.lower().replace('’', "'")):
        w = w.replace("'", '')
        if w in ('mae', 'may'): w = 'mei'
        out += NUM.get(w, [w]) if w.isdigit() else [w]
    return out
m = WhisperModel('small.en', device='cpu', compute_type='int8')
k = sys.argv[2]
for take in sys.argv[1].split(','):
    import subprocess, numpy as np
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', f'{take}_{k}.wav', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True).stdout
    segs, _ = m.transcribe(np.frombuffer(raw, np.int16).astype(np.float32) / 32768, word_timestamps=True, beam_size=5)
    W = []
    for s in segs:
        for w in s.words:
            for t in toks(w.word):
                W.append((t, w.start, w.end))
    lines = [l for l in V if l['take'] == take]
    S = []
    for li, l in enumerate(lines):
        S += [(t, li) for t in toks(l['text'])]
    sm = difflib.SequenceMatcher(None, [t for t, _ in S], [t for t, _, _ in W], autojunk=False)
    match = {}
    for a, b, n in sm.get_matching_blocks():
        for j in range(n): match[a + j] = b + j
    out = []
    for li, l in enumerate(lines):
        idx = [i for i, (_, x) in enumerate(S) if x == li]
        hit = [match[i] for i in idx if i in match]
        cov = len(hit) / len(idx)
        out.append({'id': l['id'], 'start': W[hit[0]][1] if hit else None, 'end': W[hit[-1]][2] if hit else None, 'cov': round(cov, 2),
                    'first': bool(idx[0] in match), 'last': bool(idx[-1] in match)})
        if cov < 0.9 or not out[-1]['first'] or not out[-1]['last']:
            print('  CHECK', take, l['id'], out[-1])
    pre = [t for t, s0, _ in W if out[0]['start'] is not None and s0 < out[0]['start']]
    print(take, 'lines', len(out), 'min cov', min(o['cov'] for o in out), 'words before first line:', ' '.join(pre)[:120])
    json.dump(out, open(f'{take}_{k}.words.json', 'w'), indent=1)

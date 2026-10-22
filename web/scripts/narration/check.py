# Transcribe every clip and compare it with its line: flags clips that lose or gain words at either end.
import json, re, subprocess, numpy as np, difflib
from faster_whisper import WhisperModel
from pathlib import Path
WEB = Path(__file__).resolve().parents[2]  # web/
V = json.load(open(str(WEB / 'src/features/journey/voice.json')))['lines']
m = WhisperModel('small.en', device='cpu', compute_type='int8')
norm = lambda s: re.findall(r"[a-z]+", s.lower().replace('’', "'").replace("'", ''))
bad = 0
for l in V:
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', str(WEB / 'public/voice' / (l['id'] + '.mp3')), '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True).stdout
    segs, _ = m.transcribe(np.frombuffer(raw, np.int16).astype(np.float32) / 32768, beam_size=5)
    got = ' '.join(s.text for s in segs)
    a, b = norm(l['text']), norm(got)
    r = difflib.SequenceMatcher(None, a, b).ratio()
    if r < 0.85 or (a and b and (a[0] != b[0] or a[-1] != b[-1])):
        bad += 1; print(f"{l['id']:20} {r:.2f} | {got.strip()[:140]}")
print('checked', len(V), 'flagged', bad)

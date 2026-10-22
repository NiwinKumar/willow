# Cut each take into one clip per line at the quietest moment between lines -> web/public/voice/<id>.mp3,
# and write each clip's length (ms) into voice.json. The take is loudness-normalised once, before cutting.
import json, subprocess, sys, wave, numpy as np
from pathlib import Path
WEB = Path(__file__).resolve().parents[2]  # web/
VJ = str(WEB / 'src/features/journey/voice.json')
OUT = str(WEB / 'public/voice')
V = json.load(open(VJ))
k = sys.argv[2]
subprocess.run(['mkdir', '-p', OUT])
for take in sys.argv[1].split(','):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{take}_{k}.wav', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '24000', '-ac', '1', f'{take}_{k}.norm.wav'], check=True)
    with wave.open(f'{take}_{k}.norm.wav') as w:
        sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32)
    total = len(x) / sr
    fr = int(sr * 0.01); rms = np.sqrt(np.convolve(x ** 2, np.ones(fr) / fr, 'same'))
    lines = json.load(open(f'{take}_{k}.words.json'))
    def quietest(a, b):
        a, b = int(a * sr), int(b * sr)
        if b <= a: return a / sr
        return (a + int(np.argmin(rms[a:b]))) / sr
    bounds = []
    for i in range(len(lines) - 1):
        # a line whose edge word wasn't recognised: look just after the known end, or just before the known start
        if lines[i]['last'] and lines[i + 1]['first']: lo, hi = lines[i]['end'], lines[i + 1]['start']
        elif lines[i]['last']: lo, hi = lines[i]['end'], lines[i]['end'] + 0.6
        else: lo, hi = lines[i + 1]['start'] - 0.6, lines[i + 1]['start']
        if hi < lo: lo, hi = hi - 0.3, hi
        bounds.append(quietest(max(lo, 0), hi))
    starts = [max(0, lines[0]['start'] - 0.12)] + bounds
    ends = bounds + [min(total, lines[-1]['end'] + 0.35)]
    byid = {l['id']: l for l in V['lines']}
    for l, a, b in zip(lines, starts, ends):
        seg = x[int(a * sr):int(b * sr)]
        # trim silence at both ends, keep 80 ms of air
        loud = np.where(np.abs(seg) > 120)[0]
        if len(loud): seg = seg[max(0, loud[0] - int(.08 * sr)):min(len(seg), loud[-1] + int(.2 * sr))]
        pcm = seg.astype(np.int16).tobytes()
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', str(sr), '-ac', '1', '-i', '-', '-codec:a', 'libmp3lame', '-b:a', '48k', f"{OUT}/{l['id']}.mp3"], input=pcm, check=True)
        byid[l['id']]['ms'] = round(len(seg) / sr * 1000)
    print(take, 'cut', len(lines), 'clips')
json.dump(V, open(VJ, 'w'), indent=1, ensure_ascii=False)

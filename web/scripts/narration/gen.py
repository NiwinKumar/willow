# One Gemini TTS take per script part (Achernar, the approved keynote prompt, word for word) -> <take>_<k>.wav
import json, sys, wave, concurrent.futures as cf, time
from google import genai
from google.genai import types
from pathlib import Path
WEB = Path(__file__).resolve().parents[2]  # web/
V = json.load(open(str(WEB / 'src/features/journey/voice.json')))['lines']
STYLE = ("Read this like a polished tech keynote presenter with a soft, warm voice: engaged, articulate and upbeat, "
         "clear emphasis on the key words, confident and lively, never flat or monotone. Brisk pace. Short natural pauses between sentences.")
c = genai.Client(vertexai=True, project='willow-511508', location='global')
takes = sys.argv[1].split(',')
k = sys.argv[2] if len(sys.argv) > 2 else 't1'
def one(take):
    text = '\n\n'.join(l['text'] for l in V if l['take'] == take)
    for i in range(5):
        try:
            r = c.models.generate_content(model='gemini-2.5-pro-tts', contents=STYLE + '\n\n' + text, config=types.GenerateContentConfig(
                response_modalities=['AUDIO'], speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name='Achernar')))))
            pcm = b''.join(p.inline_data.data for p in r.candidates[0].content.parts if p.inline_data)
            with wave.open(f'{take}_{k}.wav', 'wb') as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(pcm)
            return take, len(pcm) / 48000
        except Exception as e:
            print(take, 'retry', i, str(e)[:120], flush=True); time.sleep(20 * (i + 1))
    return take, None
with cf.ThreadPoolExecutor(4) as ex:
    for take, secs in ex.map(one, takes):
        print(take, k, secs)

# Journey narration

The narration of `/journey` and `/journey/brand` (slides and walkthrough steps). The script is
`src/features/journey/voice.json`; the clips are `public/voice/<id>.mp3`.

1. Edit a line in `voice.json` (a walkthrough caption is its line; a chapter's `show` must stay the start of its `text`).
2. `uv run --with google-genai python gen.py mei-slides,mei-steps,brand-slides,brand-steps t1`
   One Gemini TTS call per part (`gemini-2.5-pro-tts`, voice Achernar, the keynote prompt), so each part is one
   continuous performance. Re-record a whole part, never one line.
3. `uv run --with faster-whisper --with numpy python align.py <parts> t1` (word timestamps, coverage per line)
4. `uv run --with numpy python cut.py <parts> t1` (loudness-normalised, cut at the quietest point between lines,
   48 kbps mono mp3, lengths written back into `voice.json`)
5. `uv run --with faster-whisper --with numpy python check.py` (flags clips that lose or gain words)

Run them from a scratch folder: the takes (`*.wav`) are written to the current directory and are not committed.
`npm test` (tests/narration.test.ts) checks every line has its clip and every walkthrough line exists.

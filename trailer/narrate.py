"""Speak each narration line from trailer/timeline.json with the Kokoro neural voice model.

    uv run --python 3.12 --with kokoro --with soundfile --with "misaki[en]" trailer/narrate.py OUT_DIR

Writes n0.wav, n1.wav, ... at 24 kHz. Kokoro (Apache 2.0) runs locally; its weights download from Hugging Face on
first use.
"""
import json
import pathlib
import sys

import numpy as np
import soundfile as sf
from kokoro import KPipeline

ROOT = pathlib.Path(__file__).resolve().parent.parent
timeline = json.loads((ROOT / "trailer" / "timeline.json").read_text())
voice = timeline["voice"]
out = pathlib.Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)

pipe = KPipeline(lang_code=voice["name"][0])
for i, line in enumerate(timeline["narration"]):
    speed = line.get("speed", voice.get("speed", 1.0))
    audio = np.concatenate([a for _, _, a in pipe(line["text"], voice=voice["name"], speed=speed)])
    sf.write(out / f"n{i}.wav", audio, 24000)
    print(f"n{i} {len(audio) / 24000:.2f}s {line['text']}")

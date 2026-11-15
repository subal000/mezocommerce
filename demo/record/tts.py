"""Generate one narration MP3 per scene with edge-tts and save word timings.

Usage: python tts.py <work_dir>
Writes <work_dir>/audio/<scene>.mp3 and <work_dir>/audio/<scene>.json
({"duration": seconds, "words": [{"text", "start", "end"}]}).
"""
import asyncio
import json
import os
import subprocess
import sys

import edge_tts
import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))


def probe_duration(path: str) -> float:
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    out = subprocess.run([ff, "-hide_banner", "-i", path, "-f", "null", "-"], capture_output=True, text=True).stderr
    t = 0.0
    for line in out.splitlines():
        if "time=" in line:
            v = line.split("time=")[-1].split()[0]
            h, m, s = v.split(":")
            t = int(h) * 3600 + int(m) * 60 + float(s)
    return t


async def one(scene: dict, voice: str, rate: str, out_dir: str) -> None:
    mp3 = os.path.join(out_dir, f"{scene['id']}.mp3")
    words = []
    comm = edge_tts.Communicate(scene["text"], voice, rate=rate, boundary="WordBoundary")
    with open(mp3, "wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                s = chunk["offset"] / 1e7
                words.append({"text": chunk["text"], "start": s, "end": s + chunk["duration"] / 1e7})
    dur = probe_duration(mp3)
    with open(os.path.join(out_dir, f"{scene['id']}.json"), "w") as f:
        json.dump({"duration": dur, "words": words}, f, indent=1)
    print(f"{scene['id']:<11} {dur:6.2f}s  {len(words)} words")


async def main() -> None:
    work = sys.argv[1]
    out_dir = os.path.join(work, "audio")
    os.makedirs(out_dir, exist_ok=True)
    cfg = json.load(open(os.path.join(HERE, "narration.json")))
    only = set(sys.argv[2:])
    for s in cfg["scenes"]:
        if only and s["id"] not in only:
            continue
        for attempt in range(4):  # the service drops a request now and then
            try:
                await one(s, cfg["voice"], cfg["rate"], out_dir)
                break
            except edge_tts.exceptions.NoAudioReceived:
                if attempt == 3:
                    raise
                await asyncio.sleep(3)


if __name__ == "__main__":
    asyncio.run(main())

"""Assemble the recorded scenes into the final video.

Usage: python assemble.py <work_dir> <out_dir>

- Video: every scene's screencast frames (timestamped JPEGs) laid end to end on one timeline,
  each frame held until the next one, resampled to 30 fps, scaled to 1920x1080, H.264.
- Audio: each scene's narration clip, cut at sentence boundaries; every piece is placed where the
  recorder scheduled it (sentences are pushed later when a transaction runs long), AAC.
- Subtitles: built from edge-tts word timings mapped through the same placement, so they follow
  the voice. Written as .srt (deliverable) and .ass (burned in with libass).
"""
import json
import os
import re
import subprocess
import sys
import urllib.request
from array import array

import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
FF = imageio_ffmpeg.get_ffmpeg_exe()
SR = 48000
FPS = 30
MAX_LINE = 42
FONT_CSS = "https://fonts.googleapis.com/css2?family=Geist:wght@500"  # the site's font; the CSS links a static TTF

# Scene order in the final cut (role cards are short silent title cards between roles).
ORDER = ["intro", "landing", "onboard", "onboard-b", "onboard-c", "create", "create-b", "pay", "paid", "dashboard", "how", "live", "live-b", "outro"]


def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr[-3000:])
        raise SystemExit(f"ffmpeg failed: {' '.join(args[:6])}")
    return r


def decode_pcm(mp3):
    r = subprocess.run([FF, "-v", "error", "-i", mp3, "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True)
    a = array("h")
    a.frombytes(r.stdout)
    return a


def sentence_data(text, words):
    """Assign each word its character span in the narration text and its sentence index."""
    ends = [m.start() for m in re.finditer(r"[.!?](\s|$)", text)]
    pos = 0
    for w in words:
        i = text.find(w["text"], pos)
        at = i if i >= 0 else pos
        if i >= 0:
            pos = i + len(w["text"])
        w["span"] = (at, at + len(w["text"]) if i >= 0 else at)
        w["sent"] = sum(1 for e in ends if e < at)
    return words


def place(t, pieces):
    """Map a time in the scene's narration clip to a time in the scene."""
    for p in pieces:
        if p["from"] - 1e-6 <= t < p["to"] + 1e-6:
            return p["at"] + (t - p["from"])
    return pieces[-1]["at"] + (t - pieces[-1]["from"])


def wrap(text, width=MAX_LINE):
    if len(text) <= width:
        return [text]
    words = text.split(" ")
    best = None
    for k in range(1, len(words)):
        a, b = " ".join(words[:k]), " ".join(words[k:])
        if len(a) <= width and len(b) <= width:
            score = abs(len(a) - len(b))
            if best is None or score < best[0]:
                best = (score, [a, b])
    return best[1] if best else [text[:width], text[width:]]


def cues_for_scene(text, words, pieces, offset):
    """Group words into cues of at most two 42-character lines, never across a sentence."""
    cues = []
    cur = []

    def flush():
        if not cur:
            return
        s, e = cur[0]["span"][0], cur[-1]["span"][1]
        # carry trailing punctuation
        while e < len(text) and text[e] in ".,:;!?'\"":
            e += 1
        t = text[s:e].strip()
        start = offset + place(cur[0]["start"], pieces)
        end = offset + place(cur[-1]["end"], pieces)
        cues.append({"start": start, "end": end, "text": t, "sent": cur[0]["sent"]})
        cur.clear()

    for i, w in enumerate(words):
        if cur and w["sent"] != cur[0]["sent"]:
            flush()
        if cur:
            s = cur[0]["span"][0]
            candidate = text[s:w["span"][1]]
            if len(candidate) > 2 * MAX_LINE - 4 or len(wrap(candidate)) > 2 or any(len(l) > MAX_LINE for l in wrap(candidate)):
                flush()
        cur.append(w)
        # Prefer breaking after a comma or colon once the cue is reasonably long.
        s = cur[0]["span"][0]
        e = w["span"][1]
        nxt = text[e:e + 1]
        # ...unless only a few words of the sentence would be left for the next cue.
        rest = sum(len(x["text"]) + 1 for x in words[i + 1:] if x["sent"] == w["sent"])
        if nxt in (",", ":") and len(text[s:e]) >= 34 and rest >= 18:
            flush()
    flush()
    return cues


def fmt_srt(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def fmt_ass(t):
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02}:{s:02}.{cs:02}"


def write_script(path, narr, timeline, total):
    cfg = json.load(open(os.path.join(HERE, "narration.json")))
    """demo/script.md: the final narration by scene, with where each scene sits in the video."""
    ts = lambda t: f"{int(t // 60)}:{t % 60:04.1f}"
    spans = {}
    for sid, a, b in timeline:
        key = sid.split("-")[0]
        if key in spans:
            spans[key] = (spans[key][0], b)
        else:
            spans[key] = (a, b)
    lines = [
        "# MezoCommerce demo: narration script",
        "",
        f"Final cut: `demo/out/mezocommerce-demo.mp4`, {ts(total)} ({total:.1f} s), 1920x1080, 30 fps, H.264 + AAC.",
        f"Voice: Microsoft Andrew neural voice (`{cfg['voice']}`, edge-tts), rate {cfg['rate']}. Subtitles: `demo/out/mezocommerce-demo.srt` (also burned in).",
        "Timings are generated by `demo/record/assemble.py` from the recording, so they match the video.",
        "",
        "| Time | Scene | Narration |",
        "|---|---|---|",
    ]
    for sid, (a, b) in spans.items():
        if sid.startswith("card-"):
            lines.append(f"| {ts(a)}–{ts(b)} | Caption card: {sid[5:].rstrip('23')} wallet | (no narration) |")
            continue
        n = narr[sid]
        lines.append(f"| {ts(a)}–{ts(b)} | {n['title']} | {n['text']} |")
    lines.append("")
    with open(path, "w") as fh:
        fh.write("\n".join(lines))


def main():
    work, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    os.makedirs(out, exist_ok=True)
    narr = {s["id"]: s for s in json.load(open(os.path.join(HERE, "narration.json")))["scenes"]}
    scenes = []
    for sid in ORDER:
        f = os.path.join(work, "scenes", sid, "frames.json")
        if not os.path.exists(f):
            print(f"skip {sid} (not recorded)")
            continue
        scenes.append(json.load(open(f)))

    # ---- video: one concat list over all scenes -------------------------------------------
    lst = os.path.join(work, "frames.txt")
    timeline = []
    t = 0.0
    with open(lst, "w") as fh:
        for sc in scenes:
            sc["offset"] = t
            fr = sc["frames"]
            d = sc["duration"]
            for i, f in enumerate(fr):
                start = 0.0 if i == 0 else f["t"]
                end = fr[i + 1]["t"] if i + 1 < len(fr) else d
                dur = max(0.0, end - start)
                if dur <= 0:
                    continue
                fh.write(f"file '{os.path.join(work, 'scenes', sc['id'], f['file'])}'\nduration {dur:.4f}\n")
                last = os.path.join(work, "scenes", sc["id"], f["file"])
            timeline.append((sc["id"], t, t + d))
            t += d
        fh.write(f"file '{last}'\n")
    total = t

    # ---- audio --------------------------------------------------------------------------
    buf = array("h", bytes(2 * int((total + 1) * SR)))
    all_cues = []
    for sc in scenes:
        if not sc.get("pieces"):
            continue
        sid = sc["id"]
        pcm = decode_pcm(os.path.join(work, "audio", f"{sid}.mp3"))
        for p in sc["pieces"]:
            a, b = int(p["from"] * SR), min(len(pcm), int(p["to"] * SR))
            dst = int((sc["offset"] + p["at"]) * SR)
            seg = pcm[a:b]
            end = min(len(buf), dst + len(seg))
            buf[dst:end] = seg[: end - dst]
        words = json.load(open(os.path.join(work, "audio", f"{sid}.json")))["words"]
        sentence_data(narr[sid]["text"], words)
        all_cues += cues_for_scene(narr[sid]["text"], words, sc["pieces"], sc["offset"])
    wav = os.path.join(work, "narration.wav")
    with open(wav + ".raw", "wb") as fh:
        fh.write(buf.tobytes())
    run([FF, "-y", "-v", "error", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", wav + ".raw", wav])
    os.remove(wav + ".raw")

    # ---- subtitles ----------------------------------------------------------------------
    # Hold each cue a little after the last word, but never into the next cue.
    for i, c in enumerate(all_cues):
        nxt = all_cues[i + 1]["start"] if i + 1 < len(all_cues) else total
        c["end"] = min(max(c["end"] + 0.35, c["start"] + 1.0), nxt - 0.04)
    srt = os.path.join(out, "mezocommerce-demo.srt")
    with open(srt, "w") as fh:
        for i, c in enumerate(all_cues, 1):
            fh.write(f"{i}\n{fmt_srt(c['start'])} --> {fmt_srt(c['end'])}\n" + "\n".join(wrap(c["text"])) + "\n\n")
    ass = os.path.join(work, "subs.ass")
    with open(ass, "w") as fh:
        fh.write(
            "[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n"
            "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
            "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
            # BorderStyle 3 = box drawn in OutlineColour (AABBGGRR); opaque so two-line boxes don't show a seam.
            "Style: Default,Geist,40,&H00FFFFFF,&H00FFFFFF,&H00221C21,&H00221C21,0,0,0,0,100,100,0,0,3,12,0,2,80,80,46,1\n\n"
            "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        )
        for c in all_cues:
            body = "\\N".join(wrap(c["text"]))
            fh.write(f"Dialogue: 0,{fmt_ass(c['start'])},{fmt_ass(c['end'])},Default,,0,0,0,,{body}\n")

    fonts = os.path.join(work, "fonts")
    os.makedirs(fonts, exist_ok=True)
    font = os.path.join(fonts, "Geist-Medium.ttf")
    if not os.path.exists(font):
        css = urllib.request.urlopen(FONT_CSS).read().decode()
        url = re.search(r"url\((https://[^)]+\.ttf)\)", css).group(1)
        urllib.request.urlretrieve(url, font)

    # ---- encode ---------------------------------------------------------------------------
    mp4 = os.path.join(out, "mezocommerce-demo.mp4")
    vf = (
        f"fps={FPS},scale=1920:1080:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p,"
        f"subtitles={ass}:fontsdir={fonts}"
    )
    run([
        FF, "-y", "-v", "error",
        "-f", "concat", "-safe", "0", "-i", lst,
        "-i", wav,
        "-vf", vf, "-r", str(FPS),
        "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-profile:v", "high", "-pix_fmt", "yuv420p", "-color_range", "tv",
        "-c:a", "aac", "-b:a", "192k", "-ar", str(SR),
        "-t", f"{total:.3f}", "-movflags", "+faststart", mp4,
    ])
    with open(os.path.join(work, "timeline.json"), "w") as fh:
        json.dump({"total": total, "scenes": timeline, "cues": all_cues}, fh, indent=1)
    write_script(os.path.join(HERE, "..", "script.md"), narr, timeline, total)
    print(f"wrote {mp4} ({total:.1f}s), {srt} ({len(all_cues)} cues)")
    for sid, a, b in timeline:
        print(f"  {sid:<15} {a:7.2f} -> {b:7.2f}")


if __name__ == "__main__":
    main()

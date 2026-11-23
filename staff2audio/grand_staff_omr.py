"""Editable grand-staff recognition for printed music and colored pen strokes."""
from __future__ import annotations

from bisect import bisect_right
from collections import Counter
from itertools import pairwise
import math

import cv2
import numpy as np

from .music import KEY_NAMES, key_accidentals, midi_pitch, pitch_name, staff_pitch
from .omr import (
    SPACE, _bars, _clef, _dot, _explicit_accidental, _groups, _match, _noteheads, _prefix,
    _remove_staff, _rests, _staffs, _stem_and_duration, glyph_bitmap,
)


def _ink_layers(image):
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    saturation, value = cv2.cvtColor(image, cv2.COLOR_RGB2HSV)[:, :, 1:].transpose(2, 0, 1)
    chroma = value - image.min(axis=2)
    # Only edge-connected dark runs are borders. A long black staff line
    # itself can have an almost equally dark mean on a tightly cropped page.
    valid = []
    for axis in (1, 0):
        means = gray.mean(axis=axis)
        lit = np.flatnonzero(means >= 40)
        bounds = np.zeros(len(means), dtype=bool)
        if len(lit):
            bounds[lit[0]:lit[-1] + 1] = True
        valid.append(bounds)
    page = valid[0][:, None] & valid[1][None, :]
    # Bright digital pen colors can be clipped to V=255 while retaining strong chroma.
    pen = page & (saturation > 38) & (chroma >= 13) & ((value < 245) | (chroma >= 55))
    neutral = page & ~pen
    samples = gray[neutral]
    cutoff = cv2.threshold(samples, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[0] if samples.size else 0
    # A white page with no neutral foreground has no useful Otsu split.
    printed = neutral & (gray <= min(235, cutoff))
    return tuple(mask.astype(np.uint8) * 255 for mask in (printed | pen, printed, pen))


def _box(left, top, right, bottom):
    return [left, top, right - left, bottom - top]


def _staff_geometry(staff, printed, top, bottom):
    left, right = staff["left"], staff["right"]
    scale = SPACE / staff["space"]
    raw = cv2.resize(printed[top:bottom, left:right + 1], None, fx=scale, fy=scale,
                     interpolation=cv2.INTER_NEAREST)
    lines = (staff["lines"] - top) * scale
    clean = _remove_staff(raw, lines, staff["thickness"] * scale)
    clef, clef_confidence, clef_end = _clef(clean, lines)
    key, meter, start, meter_confidence = _prefix(clean, lines, clef_end)
    info = {"lines": staff["lines"].tolist(), "box": _box(left, top, right + 1, bottom),
            "space": staff["space"], "left": left, "right": right, "clef": clef,
            "key_signature": key, "time_signature": meter,
            "prefix_end": round(left + start / scale, 2), "barlines": []}
    return info, raw, clean, lines, scale, clef_confidence, meter_confidence


def _staff_candidates(staff_mask, printed):
    staffs = _staffs(staff_mask)
    prepared = []
    for index, staff in enumerate(staffs):
        lines, d = staff["lines"], staff["space"]
        top = max(0, math.floor(lines[0] - 5 * d))
        bottom = min(len(printed), math.ceil(lines[-1] + 5.5 * d))
        if index:
            top = max(top, math.floor(staffs[index - 1]["lines"][-1] + d * .8))
        if index + 1 < len(staffs):
            bottom = min(bottom, math.ceil(staffs[index + 1]["lines"][0] - d * .8))
        # Keep neighboring staves from contributing lines while retaining stem tips in the gap.
        if top >= lines[0] or bottom <= lines[-1]:
            continue
        prepared.append(_staff_geometry(staff, printed, top, bottom))
    return prepared


def _paired_staffs(prepared):
    paired = []
    index = 0
    while index + 1 < len(prepared):
        treble, bass = prepared[index:index + 2]
        a, b = treble[0], bass[0]
        overlap = min(a["right"], b["right"]) - max(a["left"], b["left"])
        width = min(a["box"][2], b["box"][2])
        gap = b["lines"][0] - a["lines"][-1]
        if (a["clef"], b["clef"]) == ("treble", "bass") and overlap > .55 * width and 0 < gap < 18 * a["space"]:
            paired.append((treble, bass))
            index += 2
        else:
            index += 1
    return paired


def _template_heads(raw, clean, lines):
    # The monophonic detector suppresses adjacent pitches. Recover local maxima
    # with a smaller vertical window so notes a second apart can both survive.
    yield from _noteheads(raw, clean, lines)
    neighborhood = np.ones((7, 9), np.uint8)
    for kind, threshold in (("filled", .61), ("half", .53), ("whole", .61)):
        template, _ = glyph_bitmap(kind)
        for scale in (.85, .95, 1., 1.05, 1.15):
            glyph = cv2.resize(template, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
            height, width = glyph.shape
            if height > clean.shape[0] or width > clean.shape[1]:
                continue
            scores = cv2.matchTemplate(clean, glyph, cv2.TM_CCOEFF_NORMED)
            rows, cols = np.where((scores >= threshold) & (scores == cv2.dilate(scores, neighborhood)))
            for y, x in zip(rows, cols):
                yield {"x": x + width / 2, "y": y + height / 2, "kind": kind, "score": float(scores[y, x])}


def _holes(mask):
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is not None:
        for contour, relation in zip(contours, hierarchy[0]):
            if relation[3] >= 0 and .017 * SPACE ** 2 <= cv2.contourArea(contour) <= .8 * SPACE ** 2:
                x, y, width, height = cv2.boundingRect(contour)
                if width >= .17 * SPACE and height >= .17 * SPACE:
                    yield x + width / 2, y + height / 2


def _hollow(clean, x, y):
    h, w = clean.shape
    region = clean[max(0, round(y - .65 * SPACE)):min(h, round(y + .65 * SPACE) + 1),
                   max(0, round(x - .9 * SPACE)):min(w, round(x + .9 * SPACE) + 1)]
    if not region.size:
        return False
    closed = cv2.morphologyEx(region, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    return any(abs(cx - region.shape[1] / 2) < .45 * SPACE and abs(cy - region.shape[0] / 2) < .35 * SPACE
               for mask in (region, closed) for cx, cy in _holes(mask))


def _printed_accidental(clean, head, bars):
    alteration, score = _explicit_accidental(clean, head)
    if alteration is None:
        return None, 0.
    x, y = head["x"], head["y"]
    left, right = max(0, round(x - 2.8 * SPACE)), max(0, round(x - .55 * SPACE))
    name = {-1: "flat", 1: "sharp", 0: "natural", 2: "double_sharp"}[alteration]
    matches = [p for p in _match(clean[:, left:right], name, score - .001, (.85, 1., 1.15))
               if abs(p["y"] - y) < .48 * SPACE]
    if not matches:
        return None, 0.
    match = max(matches, key=lambda p: p["score"])
    a, b = left + match["left"], left + match["left"] + match["w"]
    if any(a - .15 * SPACE <= bar <= b + .15 * SPACE for bar in bars):
        return None, 0.
    top, bottom = match["top"], match["top"] + match["h"]
    for start, end in ((max(0, top - round(.7 * SPACE)), top + 1),
                       (bottom - 1, min(len(clean), bottom + round(.7 * SPACE)))):
        if end - start > .5 * SPACE and np.any(np.mean(clean[start:end, a:b] > 0, axis=0) > .85):
            return None, 0.
    return alteration, score


def _printed_notes(raw, clean, lines, start, head_top, head_bottom):
    def in_music(head):
        return (head["x"] > start + .32 * SPACE and head_top <= head["y"] <= head_bottom
                and abs((lines[-1] - head["y"]) / (SPACE / 2)
                        - round((lines[-1] - head["y"]) / (SPACE / 2))) < .43)

    rests = _rests(clean, lines, start, [])
    bars = _bars(raw, lines, [])
    hollow_candidates = [{"x": x, "y": y, "kind": "half", "score": .57, "contour": True}
                         for mask in (clean, raw) for x, y in _holes(mask)
                         if not any(abs(x - bar) < .75 * SPACE for bar in bars)]
    heads = []
    for head in sorted([*_template_heads(raw, clean, lines), *hollow_candidates], key=lambda h: -h["score"]):
        if not in_music(head) or any(abs(head["x"] - p["x"]) < .78 * SPACE
                                    and abs(head["y"] - p["y"]) < .45 * SPACE for p in heads):
            continue
        if any(abs(head["x"] - r["x"]) < .7 * SPACE and abs(head["y"] - r["y"]) < .55 * SPACE
               and r["score"] > head["score"] for r in rests):
            continue
        duration, stem = _stem_and_duration(raw, head, clean)
        kind, x, y = head["kind"], head["x"], head["y"]
        if stem is not None:
            edge = stem["bottom"] if stem["direction"] < 0 else stem["top"]
            if abs(edge - y) > .6 * SPACE and head["score"] < .74:
                stem = None
        if kind == "filled" and stem is None:
            continue
        if kind != "filled":
            hollow = _hollow(clean, x, y) or _hollow(raw, x, y)
            if head.get("contour") and stem is None:
                continue
            if not hollow and (kind == "whole" or stem is None or head["score"] < .60):
                continue
            # A filled head bisected by a removed line can resemble a hollow head.
            if kind == "half" and not hollow and head["score"] < .67:
                continue
        if stem is not None and any(p["stem"] is not None
                                    and abs(stem["x"] - p["stem"]["x"]) < .35 * SPACE
                                    and stem["direction"] == p["stem"]["direction"]
                                    and abs(y - p["y"]) > .55 * SPACE
                                    and abs((stem["top"] if stem["direction"] < 0 else stem["bottom"])
                                            - (p["stem"]["top"] if stem["direction"] < 0 else p["stem"]["bottom"]))
                                    < .45 * SPACE for p in heads):
            # A single stem can legitimately carry multiple close heads. Weak
            # alternatives farther from the accepted head often trace the stem tip.
            if head["score"] < .7:
                continue
        alteration, accidental_confidence = _printed_accidental(clean, head, bars)
        score = min(head["score"], accidental_confidence) if alteration is not None else head["score"]
        heads.append({**head, "duration": duration, "stem": stem, "explicit": alteration,
                      "stem_dir": None if stem is None else "up" if stem["direction"] < 0 else "down",
                      "source": "printed", "confidence": min(.99, score + .08)})

    components = cv2.connectedComponentsWithStats(clean)
    for head in heads:
        next_x = min((p["x"] for p in heads if p["x"] > head["x"] + .8 * SPACE), default=clean.shape[1])
        if _dot(clean, head, next_x, components):
            head["duration"] *= 1.5
    return heads, rests


def _stem_runs(pen):
    """Recover slightly slanted pen stems by running a vertical filter on sheared masks."""
    height, width = pen.shape
    candidates = []
    close = np.ones((max(2, round(.18 * SPACE)), 1), np.uint8)
    for slope in (-.25, -.1875, -.125, -.0625, 0., .0625, .125, .1875, .25):
        matrix = np.array([[1., -slope, max(0., slope * height)], [0., 1., 0.]])
        straight = cv2.warpAffine(pen, matrix, (width + math.ceil(abs(slope) * height), height),
                                  flags=cv2.INTER_NEAREST)
        straight = cv2.morphologyEx(straight, cv2.MORPH_CLOSE, close)
        vertical = cv2.morphologyEx(straight, cv2.MORPH_OPEN, np.ones((round(1.6 * SPACE), 1), np.uint8))
        count, labels, stats, _ = cv2.connectedComponentsWithStats(vertical)
        for index in range(1, count):
            x, y, w, h, _ = stats[index]
            region = labels[y:y + h, x:x + w] == index
            lengths = region.sum(axis=0)
            peak = int(lengths.max())
            if not 1.6 * SPACE <= peak <= 7.5 * SPACE:
                continue
            cols = np.flatnonzero(lengths >= .85 * peak)
            if len(cols) > .65 * SPACE:
                continue
            col = int(cols[len(cols) // 2])
            ys = np.flatnonzero(region[:, col]) + y
            top, bottom = float(ys[0]), float(ys[-1] - (close.shape[0] % 2 == 0))
            xs = x + col - matrix[0, 2]
            stem = {"top": top, "bottom": bottom, "slope": slope, "intercept": xs, "length": bottom - top}
            rows = np.arange(round(top + .4 * SPACE), round(bottom - .4 * SPACE) + 1)
            centers = np.rint(_stem_x(stem, rows)).astype(int)
            offsets = np.arange(-round(.38 * SPACE), round(.38 * SPACE) + 1)[:, None]
            widths = np.count_nonzero(pen[rows, np.clip(centers + offsets, 0, width - 1)], axis=0)
            if np.median(widths) <= .69 * SPACE:
                candidates.append(stem)
    stems = []
    for stem in sorted(candidates, key=lambda row: -row["length"]):
        duplicate = False
        for other in stems:
            top, bottom = max(stem["top"], other["top"]), min(stem["bottom"], other["bottom"])
            middle = (top + bottom) / 2
            if bottom - top > .55 * min(stem["length"], other["length"]) and abs(
                    _stem_x(stem, middle) - _stem_x(other, middle)) < SPACE * .38:
                duplicate = True
                break
        if not duplicate:
            stems.append(stem)
    return sorted(stems, key=lambda row: _stem_x(row, (row["top"] + row["bottom"]) / 2))


def _stem_x(stem, y):
    return stem["intercept"] + stem["slope"] * y


def _beam_between(pen, first, second, end):
    y1, y2 = first[end], second[end]
    x1, x2 = _stem_x(first, y1), _stem_x(second, y2)
    if not 1.65 * SPACE < x2 - x1 < 9 * SPACE or abs(y2 - y1) > min(2.7 * SPACE, (x2 - x1) * .55):
        return 0.
    xs = np.arange(max(0, round(x1 + .23 * SPACE)), min(pen.shape[1], round(x2 - .23 * SPACE)))
    if not len(xs):
        return 0.
    ys = np.rint(y1 + (xs - x1) * (y2 - y1) / (x2 - x1)).astype(int)
    offsets = np.arange(-round(.67 * SPACE), round(.67 * SPACE) + 1)[:, None]
    return float(np.mean(np.any(pen[np.clip(ys + offsets, 0, len(pen) - 1), xs], axis=0)))


def _pen_head(pen, stem, end, lines, head_top, head_bottom):
    y_tip = stem[end]
    stem_x = _stem_x(stem, y_tip)
    up = end == "bottom"
    side = -1 if up else 1
    x0, x1 = sorted((round(stem_x - side * SPACE * .3), round(stem_x + side * SPACE * 1.55)))
    x0, x1 = max(0, x0), min(pen.shape[1], x1 + 1)
    y0, y1 = max(0, round(y_tip - SPACE * .63)), min(len(pen), round(y_tip + SPACE * .63) + 1)
    ys, xs = np.nonzero(pen[y0:y1, x0:x1])
    ys, xs = ys + y0, xs + x0
    off_stem = (xs - _stem_x(stem, ys)) * side
    keep = off_stem >= SPACE * .22
    if np.count_nonzero(keep) < .035 * SPACE ** 2:
        return None
    y = float(np.median(ys[keep]))
    # The off-stem pixels describe one side of the mark, so blend their center
    # with the expected head offset from the shaft.
    x = (float(np.median(xs[keep])) + _stem_x(stem, y) + side * .48 * SPACE) / 2
    if not head_top <= y <= head_bottom:
        return None
    hollow = _hollow(pen, (x + stem_x - side * SPACE * .23) / 2, y)
    # The longer side stroke defines the head; a pitch/voice prior only breaks close ties.
    mass = np.count_nonzero(keep) + np.percentile(off_stem[keep], 85) * 3 + 16 * hollow
    on_upper_half = y <= lines[2]
    return {"x": x, "y": y, "kind": "half" if hollow else "filled",
            "duration": 2. if hollow else 1., "stem_dir": "up" if up else "down",
            "mass": mass + (5 if on_upper_half == up else 0)}


def _pen_sharp(pen, x, y):
    left, right = max(0, round(x - 2.8 * SPACE)), max(0, round(x - .6 * SPACE))
    top, bottom = max(0, round(y - 1.05 * SPACE)), min(len(pen), round(y + 1.05 * SPACE))
    region = pen[top:bottom, left:right]
    if not region.size:
        return False
    # Two near-vertical strokes crossed by two broad strokes distinguish a sharp
    # from a neighboring stem or a single ledger-like pen mark.
    for slope in (-.2, 0., .2):
        matrix = np.float32([[1, -slope, max(0, slope * len(region))], [0, 1, 0]])
        straight = cv2.warpAffine(region, matrix, (region.shape[1] + round(abs(slope) * len(region)), len(region)),
                                  flags=cv2.INTER_NEAREST)
        vertical = cv2.morphologyEx(straight, cv2.MORPH_OPEN, np.ones((round(.64 * SPACE), 1), np.uint8))
        columns = _groups(np.flatnonzero(np.any(vertical, axis=0)))
        for a, b in pairwise(columns):
            if not .16 * SPACE <= np.mean(b) - np.mean(a) <= .85 * SPACE:
                continue
            strip = straight[:, a[0]:b[-1] + 1]
            crossings = _groups(np.flatnonzero(np.mean(strip > 0, axis=1) >= .68))
            if any(.16 * SPACE <= np.mean(v) - np.mean(u) <= .83 * SPACE
                   for u, v in pairwise(crossings)):
                return True
    return False


def _handwritten_notes(pen, lines, start, head_top, head_bottom):
    pen[:, :max(0, round(start))] = 0
    if cv2.countNonZero(pen) < .12 * SPACE ** 2:
        return []
    stems = _stem_runs(pen)
    beams = {}
    for index, first in enumerate(stems):
        for other_index in range(index + 1, len(stems)):
            second = stems[other_index]
            if second["intercept"] - first["intercept"] > 14 * SPACE:
                break
            score, endpoint = max((_beam_between(pen, first, second, end), end) for end in ("top", "bottom"))
            if score >= .76:
                for k in (index, other_index):
                    beams[k] = max(beams.get(k, (0., "")), (score, endpoint))
    notes = []
    for index, stem in enumerate(stems):
        ends = ("top", "bottom")
        beam = beams.get(index)
        if beam:
            ends = ("bottom",) if beam[1] == "top" else ("top",)
        options = [head for end in ends if (head := _pen_head(pen, stem, end, lines, head_top, head_bottom))]
        if not options:
            continue
        head = max(options, key=lambda row: row["mass"])
        if not beam and stem["length"] < 1.95 * SPACE and head["mass"] < 2.5 * SPACE:
            continue
        sharp = _pen_sharp(pen, head["x"], head["y"])
        confidence = .72 if beam or head["kind"] == "half" else .65 if head["mass"] >= 1.5 * SPACE else .58
        if beam:
            head["duration"], head["kind"] = .5, "filled"
        if not any(abs(head["x"] - old["x"]) < .72 * SPACE and abs(head["y"] - old["y"]) < .45 * SPACE
                   for old in notes):
            notes.append({**head, "source": "handwritten", "confidence": confidence,
                          "explicit": 1 if sharp else None})
    return notes


def _read_staff(prepared, handwritten, high, low):
    staff, raw, clean, lines, scale, _, _ = prepared
    left, top, width, height = staff["box"]
    start = (staff["prefix_end"] - left) * scale
    high, low = (high - top) * scale, (low - top) * scale
    printed, rests = _printed_notes(raw, clean, lines, start, high, low)
    bars = [x for x in _bars(raw, lines, printed) if x > start + .5 * SPACE]
    staff["barlines"] = [round(left + x / scale, 2) for x in bars]
    pen = cv2.resize(handwritten[top:top + height, left:left + width], raw.shape[::-1],
                     interpolation=cv2.INTER_NEAREST)
    notes = printed.copy()
    for head in _handwritten_notes(pen, lines, start, high, low):
        # Keep overlaid pen marks that add a pitch, while preventing cursor or
        # tracing marks over an existing head from duplicating that same note.
        if not any(abs(head["x"] - p["x"]) < .65 * SPACE and abs(head["y"] - p["y"]) < .38 * SPACE for p in printed):
            notes.append(head)
    key = key_accidentals(staff["key_signature"])
    events = []
    scope = {}
    for head in sorted(notes, key=lambda p: (p["x"], p["y"])):
        step = round((lines[-1] - head["y"]) / (SPACE / 2))
        letter, octave = staff_pitch(step, staff["clef"])
        position = bisect_right(bars, head["x"]), letter, octave
        if head["explicit"] is not None:
            scope[position] = head["explicit"]
        alteration = scope.get(position, key.get(letter, 0))
        events.append({"x": round(left + head["x"] / scale, 2), "y": round(top + head["y"] / scale, 2),
                       "staff_step": step, "letter": letter, "octave": octave, "alteration": alteration,
                       "spell": letter + {-2: "bb", -1: "b", 0: "", 1: "#", 2: "##"}[alteration] + str(octave),
                       "display": pitch_name(letter, octave, alteration), "midi": midi_pitch(letter, octave, alteration),
                       "duration": head["duration"], "kind": head["kind"], "stem_dir": head["stem_dir"],
                       "source": head["source"], "confidence": round(head["confidence"], 2)})
    staff["notes"] = events
    return [{"x": round(left + rest["x"] / scale, 2), "duration": rest["duration"]} for rest in rests
            if rest["x"] > start and not any(abs(rest["x"] - p["x"]) < SPACE for p in printed)]


def _merge_barlines(treble, bass):
    d = min(treble["space"], bass["space"])
    positions = sorted(treble["barlines"] + bass["barlines"])
    merged = []
    for x in positions:
        if merged and x - merged[-1] < .95 * d:
            merged[-1] = round((x + merged[-1]) / 2, 2)
        else:
            merged.append(x)
    return merged


def _measure_bars(system):
    right = max(system[clef]["right"] for clef in ("treble", "bass"))
    d = system["treble"]["space"]
    # The closing barline terminates the final measure of this system.
    return [x for x in system["barlines"] if x < right - 1.15 * d]


def _tonal_key(signature, systems):
    major, minor = (name.split()[0].replace("♭", "b").replace("♯", "#")
                    for name in KEY_NAMES[signature].split(" / "))
    bass = []
    for system in systems:
        d = system["bass"]["space"]
        notes = system["bass"]["notes"]
        for group in _columns(notes, d * 1.35):
            bass.append(min(group, key=lambda note: note["midi"]))
    if bass:
        relative = midi_pitch(minor[0], 3, minor.count("#") - minor.count("b")) % 12
        if any(note["midi"] % 12 == relative for note in (bass[0], bass[-1])):
            return minor, "minor"
    return major, "major"


def _columns(notes, tolerance):
    columns = []
    for note in sorted(notes, key=lambda row: row["x"]):
        if columns and note["x"] - columns[-1][0]["x"] <= tolerance:
            columns[-1].append(note)
        else:
            columns.append([note])
    return columns


def _voice_pair(notes, staff, given_bass=False):
    first, second = ("S", "A") if staff == "treble" else ("T", "B")
    if not notes:
        return {}
    if len(notes) > 1:
        ordered = sorted(notes, key=lambda row: (row["midi"], row["stem_dir"] == "up"))
        low = next((note for note in ordered if given_bass and note["source"] == "printed"), None) or ordered[0]
        high = next(note for note in reversed(ordered) if note is not low)
        return {first: high, second: low}
    note = notes[0]
    low = note["stem_dir"] == "down" or (note["stem_dir"] is None and note["staff_step"] < 4)
    if given_bass:
        low = note["source"] == "printed"
    return {second if low else first: note}


def _four_part(systems, key_tonic, height):
    printed_bass = handwriting = bass_columns = 0
    for system in systems:
        d = system["bass"]["space"]
        for group in _columns(system["bass"]["notes"], 1.35 * d):
            voices = _voice_pair(group, "bass", given_bass=True)
            printed_bass += voices.get("B", {}).get("source") == "printed"
            handwriting += voices.get("T", {}).get("source") == "handwritten"
            bass_columns += 1
        handwriting += sum(note["source"] == "handwritten" for note in system["treble"]["notes"])
    figured = bool(bass_columns and printed_bass > bass_columns / 2 and handwriting)
    fallback = dict(zip("SATB", (f"{key_tonic}5", "E4", "G3", f"{key_tonic}3")))
    chords = []
    measure_offset = 0
    onset = 0.
    for system in systems:
        treble, bass = system["treble"], system["bass"]
        d = (treble["space"] + bass["space"]) / 2
        bars = _measure_bars(system)
        # Start with bass attacks and preserve upper-voice attacks between them.
        columns = []
        lower_notes = bass["notes"]
        if figured:
            printed = [note for note in lower_notes if note["source"] == "printed"]
            columns = [(float(np.median([p["x"] for p in group])), [], group)
                       for group in _columns(printed, 1.35 * d)]
            unmatched_bass = []
            for note in lower_notes:
                if note["source"] == "printed":
                    continue
                nearest = _nearest_column(columns, note, bars, 1.35 * d)
                if nearest:
                    nearest[2].append(note)
                else:
                    unmatched_bass.append(note)
            lower_notes = unmatched_bass
        columns.extend((float(np.median([p["x"] for p in group])), [], group)
                       for group in _columns(lower_notes, 1.35 * d))
        unmatched = []
        for note in treble["notes"]:
            nearest = _nearest_column(columns, note, bars, 1.35 * d)
            if nearest:
                nearest[1].append(note)
            else:
                unmatched.append(note)
        columns.extend((float(np.median([p["x"] for p in group])), group, [])
                       for group in _columns(unmatched, 1.35 * d))
        for x, upper, lower in sorted(columns, key=lambda column: column[0]):
            notes = {**_voice_pair(upper, "treble"), **_voice_pair(lower, "bass", given_bass=figured)}
            coords = {}
            for voice in "SATB":
                staff = "treble" if voice in "SA" else "bass"
                if voice in notes:
                    note = notes[voice]
                    fallback[voice] = note["spell"]
                    coords[voice] = {field: note[field] for field in ("x", "y", "source", "confidence")}
                else:
                    coords[voice] = {"x": x, "y": system[staff]["lines"][1 if voice in "ST" else 3],
                                     "source": "fallback", "confidence": .2}
                coords[voice].update(staff=staff, missing=voice not in notes)
            duration = min(note["duration"] for note in notes.values())
            bottom = bass["lines"][-1]
            chord = {"index": len(chords), "system_index": system["index"], "onset": onset, "duration": duration,
                     "x": round(x, 2), "measure": measure_offset + bisect_right(bars, x) + 1,
                     "voices": fallback.copy(), "voice_coords": coords, "figure": "", "roman": "",
                     "figure_y": round(min(height - 1, bottom + 4.4 * d), 2),
                     "roman_y": round(min(height - 1, bottom + 7.4 * d), 2)}
            if coords["B"]["source"] == "printed":
                chord["given_bass"] = fallback["B"]
            chords.append(chord)
            onset += duration
        measure_offset += len(bars) + 1
    return {"chords": chords, "exercise_type": "figured_bass" if figured else "free",
            "locked_voices": ["B"] if figured else []}


def _nearest_column(columns, note, bars, tolerance):
    x = note["x"]
    measure = bisect_right(bars, x)
    nearby = [column for column in columns if abs(column[0] - x) <= tolerance
              and bisect_right(bars, column[0]) == measure]
    return min(nearby, key=lambda column: abs(column[0] - x), default=None)


def _melody_bass(systems, rests_by_system, time_signature):
    top, bottom = map(int, time_signature.split("/"))
    bar_beats = top * 4 / bottom
    melody, harmonization = [], []
    onset = 0.
    measure = 0
    for system, rests in zip(systems, rests_by_system):
        treble, bass = system["treble"], system["bass"]
        d = treble["space"]
        bars = _measure_bars(system)
        for local_measure in range(len(bars) + 1):
            measure += 1
            def in_measure(note):
                return bisect_right(bars, note["x"]) == local_measure

            soprano = [max(group, key=lambda note: (note["source"] == "printed", note["midi"], note["confidence"]))
                       for group in _columns(filter(in_measure, treble["notes"]), .8 * d)]
            bass_notes = [min(group, key=lambda note: (note["midi"], -note["confidence"]))
                          for group in _columns(filter(in_measure, bass["notes"]), .8 * d)]
            timing = sorted(soprano + list(filter(in_measure, rests)), key=lambda note: note["x"])
            attacks = []
            beat = onset
            for note in timing:
                attacks.append((note["x"], beat))
                if "spell" in note:
                    melody.append({"index": len(melody), "system_index": system["index"], "onset": beat,
                                   "duration": note["duration"], "pitch": note["spell"], "x": note["x"],
                                   "y": note["y"], "staff": "treble", "source": note["source"],
                                   "confidence": note["confidence"], "measure": measure})
                beat += note["duration"]
            for note in bass_notes:
                x = note["x"]
                if attacks:
                    nearest_x, slot = min(attacks, key=lambda pair: abs(pair[0] - x))
                    if abs(nearest_x - x) > 1.1 * d:
                        # Bass can change during a held melody note. Use the
                        # local engraving spacing when there is no shared attack.
                        before = next((entry for entry in reversed(attacks) if entry[0] < x), None)
                        after = next((entry for entry in attacks if entry[0] > x), None)
                        if before and after and after[1] - before[1] >= 1:
                            progress = (x - before[0]) / (after[0] - before[0])
                            slot = before[1] + max(.5, round(progress * (after[1] - before[1]) * 2) / 2)
                    if harmonization and harmonization[-1]["measure"] == measure:
                        prior = harmonization[-1]
                        if slot <= prior["onset"]:
                            slot = prior["onset"] + min(prior["duration"], .5)
                elif harmonization and harmonization[-1]["measure"] == measure:
                    slot = harmonization[-1]["onset"] + harmonization[-1]["duration"]
                else:
                    slot = onset
                harmonization.append({"index": len(harmonization), "system_index": system["index"],
                                      "onset": slot, "duration": note["duration"], "bass": note["spell"],
                                      "roman": "", "x": x, "y": note["y"], "staff": "bass",
                                      "source": note["source"], "confidence": note["confidence"], "measure": measure})
            first_pickup = measure == 1 and local_measure < len(bars) and onset < beat < onset + bar_beats
            performed = beat if first_pickup else max(beat, onset + bar_beats)
            if bass_notes:
                performed = max(performed, harmonization[-1]["onset"] + min(.5, harmonization[-1]["duration"]))
            onset = performed
    for first, second in pairwise(harmonization):
        first["duration"] = min(first["duration"], second["onset"] - first["onset"])
    grade_from = 0.
    if harmonization and harmonization[0]["source"] == "printed":
        grade_from = next((row["onset"] for row in harmonization if row["source"] == "handwritten"), 0.)
    phrases = [{"name": "Final phrase", "start_onset": 0., "end_onset": melody[-1]["onset"],
                "expected_cadence": "PAC"}] if melody else []
    return {"melody": melody, "harmonization": harmonization, "phrases": phrases, "grade_from_onset": grade_from}


def recognize_worksheet(image: np.ndarray, *, mode: str = "four_part") -> dict:
    """Recognize an RGB worksheet and report editable coordinates in the input image."""
    if mode not in ("four_part", "melody"):
        raise ValueError("Choose a worksheet mode: four_part or melody.")
    if not isinstance(image, np.ndarray) or image.ndim != 3 or image.shape[2] < 3 or min(image.shape[:2]) < 60:
        raise ValueError("Provide a clear color image containing both staves of the worksheet.")
    height, width = image.shape[:2]
    staff_mask, printed, handwritten = _ink_layers(image[:, :, :3].astype(np.uint8, copy=False))
    prepared = _staff_candidates(staff_mask, printed)
    pairs = _paired_staffs(prepared)
    if not pairs:
        raise ValueError("No grand-staff system was found. Include a treble staff above a bass staff in a level crop.")

    systems, rests_by_system = [], []
    warnings = []
    for index, (upper, lower) in enumerate(pairs):
        treble, bass = upper[0], lower[0]
        middle = (treble["lines"][-1] + bass["lines"][0]) / 2
        rests_by_system.append(_read_staff(upper, handwritten, treble["lines"][0] - 4.5 * treble["space"], middle))
        _read_staff(lower, handwritten, middle, bass["lines"][-1] + 3.2 * bass["space"])
        left = min(treble["left"], bass["left"])
        right = max(treble["right"], bass["right"]) + 1
        box = _box(left, treble["box"][1], right, bass["box"][1] + bass["box"][3])
        systems.append({"index": index, "treble": treble, "bass": bass,
                        "system_box": box, "barlines": _merge_barlines(treble, bass)})
        for staff in (treble, bass):
            if not staff["notes"]:
                warnings.append(f"System {index + 1} has no reliable {staff['clef']} notes.")

    signature = Counter(staff[0]["key_signature"] for pair in pairs for staff in pair).most_common(1)[0][0]
    meter_staff = max(pairs[0], key=lambda staff: staff[-1])
    time_signature = meter_staff[0]["time_signature"]
    if meter_staff[-1] < .6:
        warnings.append(f"Time signature is uncertain. Check the assumed {time_signature} meter.")
    if any(staff[0]["key_signature"] != signature for pair in pairs for staff in pair):
        warnings.append("The detected key signatures differ between staves. Check the proposed key.")
    if len(prepared) != len(systems) * 2:
        warnings.append("Some staves could not be paired into grand-staff systems.")
    if any(staff[-2] < .7 for pair in pairs for staff in pair):
        warnings.append("Some clef matches are uncertain. Check the proposed pitches.")

    key_tonic, key_mode = _tonal_key(signature, systems)
    result = (_four_part(systems, key_tonic, height) if mode == "four_part"
              else _melody_bass(systems, rests_by_system, time_signature))
    if any(coord["missing"] for chord in result.get("chords", ()) for coord in chord["voice_coords"].values()):
        warnings.append("Some voices were not detected. Review the highlighted placeholder pitches.")
    if cv2.countNonZero(handwritten):
        warnings.append("Colored pen notes use stroke geometry. Review their pitches, accidentals, and rhythms on the image.")
    if any(note["source"] == "printed" and note["confidence"] < .72
           for system in systems for clef in ("treble", "bass") for note in system[clef]["notes"]):
        warnings.append("Some printed noteheads or accidentals matched weakly. Review their pitches and durations.")
    warnings.append("Review the recognition draft before grading. Enter Roman numerals and figures manually.")
    return {"mode": mode, "width": width, "height": height, "key_tonic": key_tonic, "key_mode": key_mode,
            "key_signature": signature, "time_signature": time_signature, "systems": systems, **result,
            "warnings": warnings, "engine": "Local OpenCV + Bravura grand-staff worksheet OMR"}

"""Local, deterministic OMR for clean, printed, monophonic staff notation.

Geometry is normalized to one staff-space, rather than relying on a particular
page size. The result deliberately exposes confidence and warnings: dense piano
scores, handwriting, and expressive/structural notation need human review.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import math

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .music import KEY_NAMES, key_accidentals, midi_pitch, pitch_name, staff_pitch

FONT_PATH = Path(__file__).with_name("assets") / "Bravura.otf"
SPACE = 20.0
GLYPHS = {"treble": 0xE050, "bass": 0xE062, "flat": 0xE260,
          "natural": 0xE261, "sharp": 0xE262, "double_sharp": 0xE263,
          "whole": 0xE0A2, "half": 0xE0A3, "filled": 0xE0A4,
          "rest_whole": 0xE4E3, "rest_half": 0xE4E4,
          "rest_quarter": 0xE4E5, "rest_eighth": 0xE4E6,
          "rest_sixteenth": 0xE4E7, "common": 0xE08A, "cut": 0xE08B,
          "flag8_up":0xE240,"flag8_down":0xE241,
          "flag16_up":0xE242,"flag16_down":0xE243,
          "flag32_up":0xE244,"flag32_down":0xE245}


@lru_cache(maxsize=128)
def glyph_bitmap(name: str, space: float = SPACE) -> tuple[np.ndarray, tuple[int, int]]:
    """Return a cropped SMuFL glyph and its baseline offset (for fixture drawing)."""
    code = GLYPHS.get(name, 0xE080 + int(name)) if name.isdigit() else GLYPHS[name]
    font = ImageFont.truetype(str(FONT_PATH), round(space * 4))
    bounds = font.getbbox(chr(code), anchor="ls")
    bitmap = Image.new("L", (bounds[2] - bounds[0] + 4, bounds[3] - bounds[1] + 4))
    ImageDraw.Draw(bitmap).text((2 - bounds[0], 2 - bounds[1]), chr(code), font=font, fill=255, anchor="ls")
    return (np.array(bitmap) > 100).astype(np.uint8) * 255, (bounds[0] - 2, bounds[1] - 2)


def _groups(indices: np.ndarray) -> list[np.ndarray]:
    return list(np.split(indices, np.where(np.diff(indices) > 1)[0] + 1)) if len(indices) else []


def _staffs(binary: np.ndarray) -> list[dict]:
    h, w = binary.shape
    horizontal = cv2.morphologyEx(binary, cv2.MORPH_OPEN,
                                 cv2.getStructuringElement(cv2.MORPH_RECT, (max(25, w // 12), 1)))
    counts = np.count_nonzero(horizontal, axis=1)
    candidates = _groups(np.flatnonzero(counts > max(w * .21, counts.max(initial=0) * .32)))
    rows = [float(np.average(g, weights=counts[g])) for g in candidates]
    found = []
    i = 0
    while i + 4 < len(rows):
        lines = np.array(rows[i:i+5])
        gaps = np.diff(lines)
        space = float(np.median(gaps))
        if space >= 4 and np.max(np.abs(gaps - space)) < max(1.8, space * .16):
            positions = np.flatnonzero(np.count_nonzero(horizontal[np.rint(lines).astype(int)], axis=0) >= 3)
            if len(positions):
                found.append({"lines": lines, "space": space, "left": int(positions[0]),
                              "right": int(positions[-1]),
                              "thickness": float(np.median([len(g) for g in candidates[i:i+5]]))})
            i += 5
        else:
            i += 1
    return found


def _remove_staff(binary: np.ndarray, lines: np.ndarray, thickness: float) -> np.ndarray:
    clean = binary.copy()
    # Keep intersections with vertical ink; this preserves heads sitting on lines.
    vertical = cv2.morphologyEx(binary, cv2.MORPH_OPEN,
                              np.ones((max(3, round(thickness) + 3), 1), np.uint8))
    for y in lines:
        lo, hi = max(0, round(y - thickness / 2)), min(len(binary), round(y + thickness / 2) + 1)
        clean[lo:hi] &= vertical[lo:hi]
    return clean


def _match(clean: np.ndarray, name: str, threshold: float = .58,
           scales: tuple[float, ...] = (.9, 1., 1.1)) -> list[dict]:
    template, baseline = glyph_bitmap(name)
    matches = []
    for scale in scales:
        t = cv2.resize(template, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
        th, tw = t.shape
        if th > clean.shape[0] or tw > clean.shape[1]:
            continue
        score = cv2.matchTemplate(clean, t, cv2.TM_CCOEFF_NORMED)
        maxima = (score >= threshold) & (score == cv2.dilate(score, np.ones((9, 9), np.uint8)))
        for y, x in zip(*np.where(maxima)):
            matches.append({"x": x - baseline[0] * scale, "y": y - baseline[1] * scale,
                            "left": x, "top": y, "w": tw, "h": th,
                            "score": float(score[y, x]), "name": name})
    picked = []
    for match in sorted(matches, key=lambda item: -item["score"]):
        if not any(abs(match["x"]-p["x"]) < SPACE*.7 and abs(match["y"]-p["y"]) < SPACE for p in picked):
            picked.append(match)
    return picked


def _noteheads(binary: np.ndarray, clean: np.ndarray, lines: np.ndarray) -> list[dict]:
    """Match head shape, including empty corners, to reject thick beams and slurs."""
    heads = []
    for name,threshold in (("filled",.65),("half",.58),("whole",.66)):
        for match in _match(clean, name, threshold, (.85, .95, 1., 1.05, 1.15)):
            template, offset = glyph_bitmap(name)
            x = match["left"] + match["w"] / 2
            y = match["top"] + match["h"] / 2
            if not lines[-1] - 12 * SPACE / 2 < y < lines[-1] + 7 * SPACE / 2:
                continue
            if any(abs(x - p["x"]) < SPACE*.8 and abs(y - p["y"]) < SPACE*.5 for p in heads):
                continue
            heads.append({"x": float(x), "y": float(y), "kind": name, "score": match["score"]})
    return sorted(heads, key=lambda p: p["x"])


def _clef(clean: np.ndarray, lines: np.ndarray) -> tuple[str, float, float]:
    region = clean[:, :round(5 * SPACE)]
    options = []
    for name in ("treble", "bass"):
        for match in _match(region, name, .45, (.85, .95, 1., 1.05, 1.15)):
            expected_y = lines[3] if name == "treble" else lines[1]
            if abs(match["y"] - expected_y) < SPACE * .7:
                options.append(match)
    if options:
        best = max(options, key=lambda p: p["score"])
        return best["name"], min(.99, best["score"] + .15), best["left"] + best["w"]
    # Engravings vary; the G clef's long lower tail is a useful geometry fallback.
    low = clean[round(lines[-1] + SPACE * .5):round(lines[-1] + SPACE * 2.2), :round(4*SPACE)]
    return ("treble" if np.count_nonzero(low) > SPACE*.5 else "bass"), .65, SPACE*3.4


def _prefix(clean: np.ndarray, lines: np.ndarray, clef_end: float) -> tuple[int, str, float, float]:
    """Read meter first; key accidentals are confined to the prefix before it."""
    height, width = clean.shape
    stop = min(width, round(clef_end + SPACE * 14))
    region = clean[:, max(0, round(clef_end)):stop]
    time_options = []
    for digit in ("2", "3", "4", "6", "8", "9"):
        for m in _match(region, digit, .58, (.85, 1., 1.15)):
            if abs(m["y"] - lines[1]) < SPACE*.55:
                time_options.append((m["left"] + clef_end, digit, "top", m["score"], m))
            elif abs(m["y"] - lines[3]) < SPACE*.55:
                time_options.append((m["left"] + clef_end, digit, "bottom", m["score"], m))
    meter, meter_x, end, confidence = "4/4", None, clef_end, .5
    pairs = [(a, b) for a in time_options for b in time_options
             if a[2] == "top" and b[2] == "bottom" and b[1] in ("2","4","8")
             and abs(a[0]-b[0]) < SPACE*.7]
    if pairs:
        top, bottom = max(pairs, key=lambda p: p[0][3]+p[1][3])
        meter = top[1] + "/" + bottom[1]
        meter_x = min(top[0], bottom[0])
        end = max(top[0]+top[4]["w"], bottom[0]+bottom[4]["w"])
        confidence = (top[3]+bottom[3])/2
    else:
        for name, label in (("common", "4/4"), ("cut", "2/2")):
            matches = [m for m in _match(region, name, .58) if abs(m["y"]-lines[2]) < SPACE*.5]
            if matches:
                best = max(matches, key=lambda m:m["score"])
                if best["score"] > confidence:
                    meter, meter_x, end, confidence = label, best["left"]+clef_end, best["left"]+clef_end+best["w"], best["score"]
    accidentals = []
    prefix_end = round(meter_x if meter_x is not None else clef_end + SPACE*5)
    key_region = clean[:, max(0, round(clef_end)):min(width, prefix_end)]
    for name in ("sharp", "flat"):
        for match in _match(key_region, name, .5 if name=="sharp" else .53, (.85, 1., 1.15)):
            if lines[0]-SPACE*1.5 < match["y"] < lines[-1]+SPACE*.5:
                accidentals.append({**match, "x":match["x"]+clef_end})
    unique = []
    for match in sorted(accidentals, key=lambda m:-m["score"]):
        if not any(abs(match["x"]-p["x"]) < SPACE*.65 for p in unique):
            unique.append(match)
    if unique:
        common = max(("sharp", "flat"), key=lambda name:sum(p["name"]==name for p in unique))
        count = min(7, sum(p["name"]==common for p in unique))
        signature = count if common == "sharp" else -count
        if meter_x is None:
            end = max(end, max(p["left"]+clef_end+p["w"] for p in unique))
    else:
        signature = 0
    return signature, meter, float(end), float(confidence)


def _bars(binary: np.ndarray, lines: np.ndarray, heads: list[dict]) -> list[float]:
    top, bottom = round(lines[0]), round(lines[-1])
    # Rasterized thin barlines can wander by a pixel. Pool adjacent columns
    # before requiring a nearly continuous full-height vertical stroke.
    ink=cv2.morphologyEx(binary,cv2.MORPH_CLOSE,np.ones((5,1),np.uint8))
    ink=cv2.dilate(ink,np.ones((1,3),np.uint8))
    runs = _groups(np.flatnonzero(np.mean(ink[top:bottom+1] > 0, axis=0) > .94))
    bars = []
    for run in runs:
        x = float(np.mean(run))
        if len(run) < SPACE*.8 and not any(abs(x-p["x"]) < SPACE*.85 for p in heads):
            if not bars or x-bars[-1] > SPACE*.8:
                bars.append(x)
    return bars


def _stem_and_duration(binary: np.ndarray, head: dict, clean: np.ndarray | None = None) -> tuple[float, dict | None]:
    x, y = head["x"], head["y"]
    h, w = binary.shape
    stem = None
    for direction in (-1, 1):  # -1 means an upward stem on the right of its head
        desired_x = x - direction*SPACE*.5
        for sx in range(max(0, round(desired_x-SPACE*.25)), min(w, round(desired_x+SPACE*.25)+1)):
            if direction < 0:
                ys = np.arange(max(0,round(y-SPACE*5.5)), min(h,round(y+SPACE*.12)))
            else:
                ys = np.arange(max(0,round(y-SPACE*.12)), min(h,round(y+SPACE*5.5)))
            groups = _groups(ys[binary[ys,sx] > 0])
            for group in groups:
                if len(group) < SPACE*2.1 or np.min(np.abs(group-y)) > SPACE*.6:
                    continue
                candidate = {"x":sx,"top":int(group[0]),"bottom":int(group[-1]),"direction":direction,"length":len(group)}
                if stem is None or candidate["length"] > stem["length"]:
                    stem = candidate
    if head["kind"] == "whole":
        return 4., stem
    if head["kind"] == "half":
        return 2., stem
    if stem is None:
        return 1., None
    tip = stem["top"] if stem["direction"] < 0 else stem["bottom"]
    beam_image=clean if clean is not None else binary
    beam_count = 0
    for side in (-1,1):
        for offset in (.4,.65,.95):
            sx = round(stem["x"]+SPACE*offset*side)
            if not 1 <= sx < w-1:
                continue
            lo,hi = (max(0,tip-round(SPACE*.35)), round(y-SPACE*1.15)) if stem["direction"] < 0 else (round(y+SPACE*1.15),min(h,tip+round(SPACE*.35)))
            if hi <= lo:
                continue
            profile = np.mean(beam_image[lo:hi,sx-1:sx+2] > 0, axis=1) > .45
            runs = [r for r in _groups(np.flatnonzero(profile)) if len(r) >= SPACE*.24]
            # A beam/flag starts at the stem tip. Nearby slurs are thinner and
            # usually intersect a distant column rather than this attachment.
            if offset == .4 and not any(min(abs((r+lo)-tip)) < SPACE*.65 for r in runs):
                break
            near_tip = [r for r in runs if min(abs((r+lo)-tip)) < SPACE*1.8]
            beam_count = max(beam_count, min(3,len(near_tip)))
    # Thin curved flags do not share a beam's thick, nearly horizontal profile.
    # Match the complete flag, anchored at the detected stem tip, separately.
    if beam_count == 0:
        flag_left=max(0,round(stem["x"]-SPACE*.35))
        flag_right=min(w,round(stem["x"]+SPACE*1.8))
        flag_region=beam_image[:,flag_left:flag_right]
        options=[]
        side="up" if stem["direction"]<0 else "down"
        for count,label in ((1,"8"),(2,"16"),(3,"32")):
            for match in _match(flag_region,f"flag{label}_{side}",.46,(.75,.85,1.,1.15)):
                if abs(match["x"]+flag_left-stem["x"]) < SPACE*.45 and abs(match["y"]-tip) < SPACE*.5:
                    options.append((match["score"],count))
        if options:
            beam_count=max(options)[1]
    return 1. / (2 ** beam_count), stem


def _dot(clean: np.ndarray, head: dict, next_x: float, components: tuple | None = None) -> bool:
    x,y = head["x"],head["y"]
    lo, hi = round(x+SPACE*.8), min(round(next_x-SPACE*.5),round(x+SPACE*1.75))
    if hi <= lo:
        return False
    n,_,stats,centers = components if components is not None else cv2.connectedComponentsWithStats(clean)
    return any(SPACE**2*.022 <= stats[i,cv2.CC_STAT_AREA] <= SPACE**2*.22
               and SPACE*.12 <= stats[i,cv2.CC_STAT_WIDTH] <= SPACE*.55
               and SPACE*.12 <= stats[i,cv2.CC_STAT_HEIGHT] <= SPACE*.55
               and .55 <= stats[i,cv2.CC_STAT_WIDTH]/stats[i,cv2.CC_STAT_HEIGHT] <= 1.8
               and lo <= centers[i][0] <= hi
               and abs(centers[i][1]-y) < SPACE*.65 for i in range(1,n))


def _explicit_accidental(clean: np.ndarray, head: dict) -> tuple[int | None, float]:
    x,y = head["x"],head["y"]
    left,right = max(0,round(x-SPACE*2.8)),max(0,round(x-SPACE*.55))
    region = clean[:,left:right]
    found = []
    for name, value in (("flat",-1),("sharp",1),("natural",0),("double_sharp",2)):
        # Thin sharp strokes differ more between engraving fonts than the
        # closed bowls and corners of flats/naturals. Their full-height double
        # vertical/crossbar pattern remains distinctive at a lower correlation.
        threshold=.56 if name=="sharp" else .66
        for match in _match(region,name,threshold,(.85,1.,1.15)):
            if abs(match["y"]-y) < SPACE*.48:
                found.append((match["score"],value))
    if found:
        score,value = max(found)
        return value,score
    return None,0.


def _rests(clean: np.ndarray, lines: np.ndarray, start: float, heads: list[dict]) -> list[dict]:
    found = []
    component_count,component_labels,component_stats,_=cv2.connectedComponentsWithStats(clean)
    for name,duration in (("rest_quarter",1.),("rest_eighth",.5),("rest_sixteenth",.25)):
        for match in _match(clean,name,.68,(.9,1.,1.1)):
            x=match["left"]+match["w"]/2
            if x < start or abs(match["y"]-lines[2]) > SPACE*.7:
                continue
            if any(abs(x-p["x"]) < SPACE*.8 for p in heads+found):
                continue
            found.append({"x":float(x),"y":float(lines[2]),"duration":duration,"score":match["score"],"rest":True})
    # Half/whole rests share a rectangle; the supporting line distinguishes them.
    for name,duration in (("rest_whole",4.),("rest_half",2.)):
        for match in _match(clean,name,.8,(.9,1.,1.1)):
            x=match["left"]+match["w"]/2
            if x < start or abs(match["y"]-lines[2]) > SPACE*.4:
                continue
            if any(abs(x-p["x"]) < SPACE for p in heads+found):
                continue
            cy=round(match["top"]+match["h"]/2)
            cx=round(x)
            component=component_labels[min(len(clean)-1,cy),min(clean.shape[1]-1,cx)]
            if component==0 or component_stats[component,cv2.CC_STAT_WIDTH]>SPACE*2.2 or component_stats[component,cv2.CC_STAT_HEIGHT]>SPACE*1.2:
                continue
            found.append({"x":float(x),"y":float(lines[2]),"duration":duration,"score":match["score"],"rest":True})
    return found


def _unique_stem_heads(binary: np.ndarray,clean: np.ndarray,heads: list[dict]) -> list[dict]:
    """One monophonic note owns each stem; a beam's rounded end can mimic a head."""
    picked=[]
    stems={id(p):_stem_and_duration(binary,p,clean)[1] for p in heads}
    for head in sorted(heads,key=lambda p:-p["score"]):
        stem=stems[id(head)]
        if head["kind"]=="filled" and stem is None:
            continue
        duplicate=False
        if stem:
            for other in picked:
                other_stem=stems[id(other)]
                if other_stem and abs(stem["x"]-other_stem["x"])<SPACE*.4:
                    overlap=min(stem["bottom"],other_stem["bottom"])-max(stem["top"],other_stem["top"])
                    if overlap>SPACE*1.2:
                        duplicate=True
                        break
        if not duplicate:
            picked.append(head)
    return sorted(picked,key=lambda p:p["x"])


def recognize(image: np.ndarray) -> dict:
    """Recognize each staff as an independent melody. Input is an RGB uint8 array."""
    if not isinstance(image,np.ndarray) or image.ndim != 3 or image.shape[2] < 3:
        raise ValueError("Please provide a color image of printed music.")
    h,w = image.shape[:2]
    if min(h,w) < 60:
        raise ValueError("This image is too small. Use a clear, higher-resolution staff image.")
    gray=cv2.cvtColor(image[:,:,:3].astype(np.uint8),cv2.COLOR_RGB2GRAY)
    _,binary=cv2.threshold(gray,0,255,cv2.THRESH_BINARY_INV+cv2.THRESH_OTSU)
    # Fine, gray scan barlines may disappear at the global note-ink threshold.
    # A separate local threshold keeps them available for accidental scope.
    bar_binary=cv2.adaptiveThreshold(gray,255,cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                    cv2.THRESH_BINARY_INV,51,9)
    detected=_staffs(binary)
    if not detected:
        raise ValueError("No five-line musical staff was found. Use a level, well-lit image with complete staff lines.")
    results=[]
    warnings=[]
    for index,staff in enumerate(detected):
        d=staff["space"]
        top=max(0,math.floor(staff["lines"][0]-d*5))
        bottom=min(h,math.ceil(staff["lines"][-1]+d*4.5))
        left,right=staff["left"],staff["right"]+1
        scale=SPACE/d
        crop=cv2.resize(binary[top:bottom,left:right],None,fx=scale,fy=scale,interpolation=cv2.INTER_NEAREST)
        bar_crop=cv2.resize(bar_binary[top:bottom,left:right],crop.shape[::-1],interpolation=cv2.INTER_NEAREST)
        lines=(staff["lines"]-top)*scale
        clean=_remove_staff(crop,lines,staff["thickness"]*scale)
        clef,clef_conf,clef_end=_clef(clean,lines)
        key,meter,start,meter_conf=_prefix(clean,lines,clef_end)
        heads=[p for p in _noteheads(crop,clean,lines) if p["x"] > start+SPACE*.45]
        # Quarter-rest lobes can resemble a solid head; a complete rest glyph
        # has stronger evidence than that small subshape.
        rests=_rests(clean,lines,start,[])
        heads=[p for p in heads if not any(abs(p["x"]-r["x"]) < SPACE*.9 and r["score"]>p["score"] for r in rests)]
        heads=_unique_stem_heads(crop,clean,heads)
        bars=[x for x in _bars(bar_crop,lines,heads) if x > start+SPACE*.5]
        events=[]
        accidental_scope={}
        current_bar=0
        onset=0.
        notes=sorted(heads+rests,key=lambda p:p["x"])
        components=cv2.connectedComponentsWithStats(clean)
        for ni,note in enumerate(notes):
            bar=sum(x < note["x"] for x in bars)
            if bar != current_bar:
                accidental_scope={}
                current_bar=bar
            next_x=notes[ni+1]["x"] if ni+1<len(notes) else crop.shape[1]
            if note.get("rest"):
                duration=note["duration"]
                midi,name=None,"Rest"
                pitch_fields={"staff_step":None,"letter":None,"octave":None,"natural_midi":None,
                              "alteration":0,"explicit_accidental":None,"alteration_source":None}
            else:
                step=round((lines[-1]-note["y"])/(SPACE/2))
                letter,octave=staff_pitch(step,clef)
                explicit,acc_conf=_explicit_accidental(clean,note)
                if explicit is not None:
                    accidental_scope[(letter,octave)]=explicit
                alteration=accidental_scope.get((letter,octave),key_accidentals(key).get(letter,0))
                midi=midi_pitch(letter,octave,alteration)
                name=pitch_name(letter,octave,alteration)
                pitch_fields={"staff_step":step,"letter":letter,"octave":octave,
                              "natural_midi":midi_pitch(letter,octave),"alteration":alteration,
                              "explicit_accidental":explicit,
                              "alteration_source":"explicit" if explicit is not None else
                                  "measure" if (letter,octave) in accidental_scope else "key"}
                duration,stem=_stem_and_duration(crop,note,clean)
            dotted=_dot(clean,note,next_x,components)
            if dotted:
                duration*=1.5
            confidence=min(note["score"],clef_conf)
            if not note.get("rest") and explicit is not None:
                confidence=min(confidence,acc_conf)
            events.append({"id":f"s{index+1}-n{ni+1}","midi":midi,"name":name,
                           "onset":round(onset,4),"duration":duration,
                           "x":round(left+note["x"]/scale,2),"y":round(top+note["y"]/scale,2),
                           "confidence":round(confidence,2),"measure":bar+1,"dotted":dotted})
            events[-1].update(pitch_fields)
            onset+=duration
        label=f"Staff {index+1}"
        if not events:
            warnings.append(f"{label}: no reliable notes were found; try a higher-resolution crop.")
        if meter_conf < .6:
            warnings.append(f"{label}: time signature is uncertain; assumed {meter}. Check before playback.")
        if clef_conf < .7:
            warnings.append(f"{label}: clef is uncertain; interpreted as {clef}.")
        if events and any(e["confidence"] < .7 for e in events):
            warnings.append(f"{label}: some symbols have low confidence; review the note list.")
        numerator,denominator=(int(n) for n in meter.split("/"))
        expected_beats=numerator*4/denominator
        measure_lengths={}
        for event in events:
            measure_lengths[event["measure"]]=measure_lengths.get(event["measure"],0)+event["duration"]
        incorrect=[number for number,length in measure_lengths.items()
                   if length > expected_beats+.05 or
                   (number not in (min(measure_lengths),max(measure_lengths)) and abs(length-expected_beats)>.05)]
        if incorrect:
            warnings.append(f"{label}: rhythm does not fill the detected meter in measure(s) {', '.join(map(str,incorrect))}; check flags, dots, rests and ties.")
        results.append({"id":index+1,"box":[left,max(0,round(staff["lines"][0]-d*2.7)),right-left,round(d*9.4)],
                        "lines":[round(y,2) for y in staff["lines"]],"clef":clef,"key_signature":key,
                        "key_name":KEY_NAMES[key],"time_signature":meter,
                        "confidence":round(float(np.mean([e["confidence"] for e in events])) if events else .2,2),
                        "events":events,"duration":round(onset,4),
                        "barlines":[round(left+x/scale,2) for x in bars]})
    warnings.append("Local printed-music recognition is an editable draft. Review pitches, accidentals and rhythm; chords, ties, tuplets, repeats and handwriting are not interpreted.")
    return {"width":w,"height":h,"staffs":results,"warnings":warnings,"engine":"Local OpenCV + Bravura glyph templates"}

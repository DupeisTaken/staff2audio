"""Grade AP-style melody harmonizations and find SATB realizations."""

from bisect import bisect_right
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass, replace
from functools import lru_cache
from itertools import product
from math import floor
import re
from sys import float_info

from staff2audio.theory.chords import RomanNumeralSpec, parse_roman_numeral, with_cadential_context
from staff2audio.theory.four_part import (
    VOICES, _key_from_payload, _perfect_family, _primary_dominant, _step, _tonic,
    _voice_options, score_transition_voicing,
)
from staff2audio.theory.pitch import Key, SpelledPitch, interval_between, parse_pitch


_SYNTAX = "Harmonic Progression & Syntax"
_BASS = "Bass Line & Counterpoint"
_FIT = "Cadences & Melody Fit"
_RUBRIC = (_SYNTAX, _BASS, _FIT)
_CADENCES = {"PAC", "IAC", "HC", "DC", "PC", "AC", "any"}
_NCT_NAMES = {
    "PT": "Passing tone", "NT": "Neighbor tone", "SUS": "Suspension",
    "APP": "Appoggiatura", "ET": "Escape tone", "ANT": "Anticipation",
    "CLASH": "Unresolved dissonance",
}
_EPSILON = 1e-7


@dataclass(frozen=True)
class _Note:
    onset: float
    duration: float
    pitch: SpelledPitch
    index: int

    @property
    def end(self):
        return self.onset + self.duration


@dataclass(frozen=True)
class _Slot:
    onset: float
    duration: float
    bass: SpelledPitch
    harmony: RomanNumeralSpec

    @property
    def end(self):
        return self.onset + self.duration


@dataclass(frozen=True)
class _Meter:
    bar: float
    pulse: float
    pickup: float

    def measure(self, onset):
        return floor((onset - self.pickup + _EPSILON) / self.bar)

    def strength(self, onset):
        position = onset - self.pickup - self.measure(onset) * self.bar
        if abs(position) < _EPSILON:
            return 3
        if self.bar == 4 * self.pulse and abs(position - self.bar / 2) < _EPSILON:
            return 2
        return int(abs(position / self.pulse - round(position / self.pulse)) < _EPSILON)


@dataclass(frozen=True)
class _Phrase:
    name: str
    start: float
    end: float
    expected: str


@dataclass(frozen=True)
class _Issue:
    code: str
    category: str
    message: str
    suggestion: str
    index: int | None
    previous: int | None = None
    voices: tuple[str, ...] = ("S", "B")
    severity: str = "error"
    note: int | None = None
    onset: float | None = None

    @property
    def identity(self):
        return self.code, self.index, self.previous, self.note


def _number(value, name, *, positive=False):
    if type(value) not in (int, float) or not 0 <= value <= 100_000 or (positive and value <= _EPSILON):
        raise ValueError(f"{name} must be a {'positive' if positive else 'nonnegative'} finite beat value.")
    return float(value)


def _meter(payload):
    signature = payload.get("time_signature", "4/4")
    match = re.fullmatch(r"([1-9][0-9]?)/(1|2|4|8|16|32)", signature) if isinstance(signature, str) else None
    if not match:
        raise ValueError("Use a time signature such as 4/4, 3/4, or 6/8.")
    count, unit = map(int, match.groups())
    beat = 4 / unit
    pickup = _number(payload.get("pickup_duration", 0), "Pickup duration")
    if pickup >= count * beat:
        raise ValueError("Pickup duration must be shorter than a measure.")
    return _Meter(count * beat, beat * (3 if count >= 6 and count % 3 == 0 else 1), pickup)


def _rows(values, name, *, optional=False):
    if optional and values is None:
        return []
    if (not isinstance(values, (list, tuple)) or not (values or optional)
            or not all(isinstance(row, Mapping) for row in values)):
        raise ValueError(f"Provide {name} as a list of objects.")
    return values


def _pitch(value):
    return value if isinstance(value, SpelledPitch) else parse_pitch(value.get("spell") if isinstance(value, Mapping) else value)


def _timeline(values, name, build):
    result = []
    for index, row in enumerate(_rows(values, name)):
        try:
            onset = _number(row.get("onset"), "Onset")
            duration = _number(row.get("duration"), "Duration", positive=True)
            result.append(build(row, index, onset, duration))
        except ValueError as exc:
            raise ValueError(f"{name.capitalize()} row {index + 1}: {exc}") from exc
    result.sort(key=lambda entry: entry.onset)
    if any(first.end > second.onset + _EPSILON for first, second in zip(result, result[1:])):
        raise ValueError(f"{name.capitalize()} must be monophonic and cannot contain overlapping rows.")
    return result


def _read_notes(values):
    return _timeline(values, "melody", lambda row, index, onset, duration:
                     _Note(onset, duration, _pitch(row.get("pitch")), index))


def _contextualize(slots):
    result = [*slots]
    for index in range(len(slots) - 2, -1, -1):
        slot, following = slots[index], result[index + 1]
        spec = with_cadential_context(slot.harmony, following.harmony)
        if following.harmony.is_cadential_64 and spec.symbol == following.harmony.symbol and slot.bass == following.bass:
            spec = following.harmony
        result[index] = replace(slot, harmony=spec)
    return result


def _infer_reference_roman(bass, soprano, key):
    candidates = [spec for spec in _harmonies(key) if not spec.is_cadential_64 and spec.expected_bass == bass.spelling]
    if soprano is not None:
        matched = [spec for spec in candidates if soprano.spelling in spec.chord_members]
        if matched:
            return matched[0]
    if candidates:
        return candidates[0]
    return parse_roman_numeral("I" if key.mode == "major" else "i", key)


def _read_slots(values, key, *, notes=None, grade_from=0.0):
    starts = [note.onset for note in notes] if notes else []

    def build_slot(row, index, onset, duration):
        bass = _pitch(row.get("bass"))
        raw_roman = row.get("roman", row.get("roman_numeral"))
        if (raw_roman is None or (isinstance(raw_roman, str) and not raw_roman.strip())) and onset < grade_from - _EPSILON:
            note_idx = _covering(notes, starts, onset) if notes else None
            soprano = notes[note_idx].pitch if note_idx is not None else None
            harmony = _infer_reference_roman(bass, soprano, key)
        else:
            harmony = parse_roman_numeral(raw_roman, key)
        return _Slot(onset, duration, bass, harmony)

    return _contextualize(_timeline(values, "harmonization", build_slot))


def _read_phrases(values):
    phrases = []
    for index, row in enumerate(_rows(values, "phrases", optional=True)):
        name = row.get("name", f"Phrase {index + 1}")
        expected = row.get("expected_cadence", "any")
        start = _number(row.get("start_onset"), "Phrase start")
        end = _number(row.get("end_onset"), "Phrase end")
        if not isinstance(expected, str) or expected not in _CADENCES:
            raise ValueError("Expected cadence must be PAC, IAC, HC, DC, PC, AC, or any.")
        if not isinstance(name, str) or not name.strip() or end < start:
            raise ValueError("Each phrase needs a name and an ending at or after its start.")
        phrases.append(_Phrase(name, start, end, expected))
    return phrases


def _covering(timeline, onsets, beat):
    index = bisect_right(onsets, beat + _EPSILON) - 1
    return index if index >= 0 and beat < timeline[index].end - _EPSILON else None


def _touches(first, second):
    return abs(first.end - second.onset) < _EPSILON


def _fit(note, harmony, previous, previous_harmony, following, next_harmony, meter, anticipation):
    """Classify by written intervals and by the harmony at each attack."""
    if harmony and note.pitch.spelling in harmony.chord_members:
        return "CT"
    if not harmony or not following or not _touches(note, following) or not next_harmony:
        return "CLASH"
    if following.pitch.spelling not in next_harmony.chord_members:
        return "CLASH"
    strength = meter.strength(note.onset)
    if (anticipation and strength < meter.strength(following.onset) and note.pitch == following.pitch):
        return "ANT"
    if not previous or not _touches(previous, note):
        return "CLASH"
    approach = interval_between(previous.pitch, note.pitch)
    departure = interval_between(note.pitch, following.pitch)
    step_in = _step(previous.pitch, note.pitch, approach.direction) if approach.direction else False
    step_out = _step(note.pitch, following.pitch, departure.direction) if departure.direction else False
    prepared = previous_harmony and previous.pitch.spelling in previous_harmony.chord_members
    if (note.pitch == previous.pitch and prepared and strength > meter.strength(previous.onset)
            and _step(note.pitch, following.pitch, -1)):
        return "SUS"
    if step_in and step_out and prepared:
        if previous.pitch == following.pitch:
            return "NT"
        if approach.direction == departure.direction:
            return "PT"
    if approach.generic_size > 2 and step_out:
        return "APP"
    if step_in and prepared and departure.generic_size > 2 and approach.direction == -departure.direction:
        return "ET"
    return "CLASH"


def _classifications(notes, slots, meter):
    starts = [slot.onset for slot in slots]
    alignment = [_covering(slots, starts, note.onset) for note in notes]
    specs = [slots[index].harmony if index is not None else None for index in alignment]
    result = []
    for index, (note, spec, slot) in enumerate(zip(notes, specs, alignment)):
        previous = notes[index - 1] if index else None
        following = notes[index + 1] if index + 1 < len(notes) else None
        next_slot = alignment[index + 1] if following else None
        kind = _fit(note, spec, previous, specs[index - 1] if previous else None, following,
                    specs[index + 1] if following else None, meter,
                    slot is not None and next_slot == slot + 1)
        label = (f"Chord tone ({('root', '3rd', '5th', '7th')[spec.chord_members.index(note.pitch.spelling)]})"
                 if kind == "CT" else _NCT_NAMES[kind])
        row = {"index": note.index, "onset": note.onset, "pitch": note.pitch.to_dict(),
               "chord_index": slot, "classification": kind, "label": label}
        if kind == "CT" and slot is not None:
            sustained_clashes = []
            for held_index in range(slot + 1, len(slots)):
                held = slots[held_index]
                if held.onset >= note.end - _EPSILON:
                    break
                if note.pitch.spelling in held.harmony.chord_members:
                    continue
                valid_sus = (following is not None and _touches(note, following)
                             and _step(note.pitch, following.pitch, -1)
                             and meter.strength(held.onset) > meter.strength(note.onset)
                             and following.pitch.spelling in held.harmony.chord_members
                             and abs(note.end - following.onset) < _EPSILON
                             and held.end >= note.end - _EPSILON)
                if valid_sus and "sustained_dissonance" not in row:
                    row["sustained_dissonance"] = {"classification": "SUS", "label": _NCT_NAMES["SUS"],
                                                  "onset": held.onset, "chord_index": held_index}
                else:
                    sustained_clashes.append({"onset": held.onset, "chord_index": held_index})
            if sustained_clashes:
                row["sustained_clashes"] = sustained_clashes
        result.append(row)

    # Recognize double passing tones (CT -> PT -> PT -> CT) stepping continuously in one direction.
    for index in range(1, len(notes) - 2):
        if result[index]["classification"] != "CLASH" or result[index + 1]["classification"] != "CLASH":
            continue
        if result[index - 1]["classification"] != "CT" or result[index + 2]["classification"] != "CT":
            continue
        if alignment[index] is None or alignment[index + 1] is None:
            continue
        n0, n1, n2, n3 = notes[index - 1], notes[index], notes[index + 1], notes[index + 2]
        if not (_touches(n0, n1) and _touches(n1, n2) and _touches(n2, n3)):
            continue
        direction = interval_between(n0.pitch, n1.pitch).direction
        if direction and _step(n0.pitch, n1.pitch, direction) and _step(n1.pitch, n2.pitch, direction) and _step(n2.pitch, n3.pitch, direction):
            for pos in (index, index + 1):
                result[pos]["classification"] = "PT"
                result[pos]["label"] = _NCT_NAMES["PT"]
    return result


def _anchors(notes, slots):
    starts = [note.onset for note in notes]
    result = []
    for slot in slots:
        index = _covering(notes, starts, slot.onset)
        if index is None:
            following = bisect_right(starts, slot.onset + _EPSILON)
            if following < len(notes) and starts[following] < slot.end - _EPSILON:
                index = following
        result.append(notes[index].pitch if index is not None else None)
    return result


def _function(spec):
    if spec.secondary_target:
        return "PD" if spec.secondary_target.upper() == "V" else "D"
    return spec.function


def _bass_leap(old, new):
    interval = interval_between(old, new)
    if interval.is_compound or abs(interval.semitones) > 12:
        return "leap_over_octave"
    if interval.generic_size == 7:
        return "seventh_leap"
    if interval.quality.startswith("A") and interval.generic_size in (2, 4, 5):
        return {2: "augmented_second", 4: "augmented_fourth", 5: "augmented_fifth"}[interval.generic_size]
    if abs(interval.semitones) == 6 and interval.name != "d5":
        return "tritone_leap"
    return None


def _tendencies(first, second, key):
    old, new = first.harmony, second.harmony
    prolonged_dom = (old.root == new.root and old.secondary_target == new.secondary_target
                     and old.function == "D" and new.function == "D")
    if (old.chord_members == new.chord_members or prolonged_dom) and first.bass == second.bass:
        return
    for tone in old.tendency_tones:
        if tone.pitch != first.bass.spelling:
            continue
        if (tone.kind == "leading_tone" and old.secondary_target and new.seventh == second.bass.spelling
                and first.bass.letter == second.bass.letter and second.bass.midi == first.bass.midi - 1):
            continue
        target = tone.target
        if tone.kind == "chordal_seventh" and _primary_dominant(old) and old.inversion == 3 and _tonic(new, key):
            target = new.third
        if not _step(first.bass, second.bass, tone.direction) or (target and second.bass.spelling != target):
            yield f"unresolved_{tone.kind}"


def _linear_six_four(first, middle, last):
    if not first or not last or middle.harmony.is_seventh or middle.harmony.inversion != 2:
        return False
    if first.bass == middle.bass == last.bass:
        return True
    direction = interval_between(first.bass, middle.bass).direction
    return bool(direction and _step(first.bass, middle.bass, direction) and _step(middle.bass, last.bass, direction))


def _syntax(first, second, key, preceding=None, following=None):
    old, new = first.harmony, second.harmony
    if old.is_cadential_64:
        if new.is_cadential_64 and old.chord_members == new.chord_members and first.bass == second.bass:
            return None
        if not (_primary_dominant(new) and new.inversion == 0 and first.bass == second.bass):
            return "cadential_64_resolution"
    elif old.secondary_target:
        target = parse_roman_numeral(old.secondary_target, key).root
        prolonged = old.root == new.root and old.secondary_target == new.secondary_target
        cadential_resolution = old.secondary_target.upper() == "V" and new.is_cadential_64
        if not prolonged and not cadential_resolution and new.root != target:
            return "unresolved_secondary_dominant"
    elif _function(old) == "D" and _function(new) == "PD":
        # A dominant can be prolonged by an applied dominant of V, and minor v/v6 can descend to iv(6) in lament bass.
        minor_v = old.degree == 5 and old.quality == "minor" and not old.secondary_target
        if (not minor_v and new.secondary_target != "V" and not _linear_six_four(preceding, first, second)
                and not _linear_six_four(first, second, following)):
            return "harmonic_retrogression"
    return None


def _motion(first, second, old_s, new_s):
    if old_s is None or new_s is None or first.bass.midi >= old_s.midi or second.bass.midi >= new_s.midi:
        return None, None, None
    s = new_s.midi - old_s.midi
    b = second.bass.midi - first.bass.midi
    old = interval_between(first.bass, old_s)
    new = interval_between(second.bass, new_s)
    family = _perfect_family(new.simple_name)
    parallel = old.simple_size == new.simple_size
    motion = ("static" if not (s or b) else "oblique" if not (s and b) else
              "contrary" if s * b < 0 else "parallel" if parallel else "similar")
    code = None
    if s and b:
        if family and family == _perfect_family(old.simple_name):
            code = f"{'parallel' if s * b > 0 else 'contrary'}_{family}"
        elif old.simple_name == "d5" and new.simple_name == "P5":
            code = "unequal_fifths"
        elif family and s * b > 0 and abs(new_s.diatonic_number - old_s.diatonic_number) > 1:
            code = f"direct_{family}"
    return motion, code, new.simple_size if motion == "parallel" and parallel else None


def _cadence(first, second, soprano, key):
    old, new = first.harmony, second.harmony
    if first.bass.spelling != old.expected_bass or second.bass.spelling != new.expected_bass:
        return None
    if soprano is None or soprano.spelling not in new.chord_members or new.secondary_target:
        return None
    if _tonic(new, key) and not new.is_cadential_64:
        if _primary_dominant(old):
            return "PAC" if old.inversion == new.inversion == 0 and soprano.spelling == new.root else "IAC"
        if old.degree == 7 and old.function == "D" and not old.secondary_target:
            return "IAC"
        if old.degree == 4 and not old.secondary_target:
            return "PC"
    if (_primary_dominant(new) and not new.inversion and not new.is_seventh
            and (_function(old) in ("T", "PD") or old.is_cadential_64)):
        return "HC"
    if (_primary_dominant(old) and new.degree == 6 and not new.inversion
            and new.root == key.scale_pitches[5]):
        return "DC"
    return None


def _cadence_matches(detected, expected):
    return expected == "any" or detected == expected or (expected == "AC" and detected in ("PAC", "IAC"))


def _phrase_end_notes(notes, phrases):
    ordered = sorted(phrases, key=lambda phrase: phrase.start)
    ends = {}
    for index, phrase in enumerate(ordered):
        # Phrase ends accept inclusive note onsets, subdivided final beats before the next phrase, or the last note.
        end = phrase.end + _EPSILON
        if index + 1 < len(ordered) and ordered[index + 1].start > phrase.start:
            next_start = ordered[index + 1].start
            if phrase.end < next_start <= phrase.end + 1.0 + _EPSILON:
                end = next_start - _EPSILON
            else:
                end = min(end, next_start - _EPSILON)
        elif notes and phrase.end < notes[-1].onset < phrase.end + 1.0 - _EPSILON:
            end = notes[-1].onset + _EPSILON
        ends[phrase] = next((note for note in reversed(notes) if note.onset <= end
                             and note.end > phrase.start + _EPSILON), None)
    return ends


def _cadences(notes, slots, phrases, key):
    starts = [slot.onset for slot in slots]
    implicit = not phrases
    if not phrases:
        phrases = [_Phrase("Final cadence", slots[0].onset, max(slots[-1].onset, notes[-1].onset), "any")]
    endings = _phrase_end_notes(notes, phrases)
    result = []
    for phrase in phrases:
        note = endings[phrase]
        arrival = None if note is None else _covering(slots, starts, min(phrase.end, note.end - 2 * _EPSILON))
        if implicit and arrival != len(slots) - 1:
            arrival, note = len(slots) - 1, None
        previous = None
        detected = None
        if arrival is not None:
            for index in range(arrival - 1, -1, -1):
                if slots[index].harmony.symbol != slots[arrival].harmony.symbol or slots[index].bass != slots[arrival].bass:
                    if slots[index].end > phrase.start + _EPSILON:
                        previous = index
                        detected = _cadence(slots[index], slots[arrival], note.pitch if note else None, key)
                    break
        passed = _cadence_matches(detected, phrase.expected)
        message = f"Detected {detected}." if detected else "No cadence detected."
        if not passed:
            message += f" The phrase calls for {phrase.expected}."
        result.append({"phrase": phrase.name, "expected": phrase.expected, "detected": detected,
                       "passed": passed, "message": message, "onset": phrase.end,
                       "chord_indices": [index for index in (previous, arrival) if index is not None]})
    return result


_TIPS = {
    "melody_clash": "Choose a chord that contains this note or supports its stepwise resolution.",
    "unharmonized_melody": "Add a harmony covering this melody note.",
    "wrong_bass_inversion": "Use the chord member required by the Roman numeral and inversion.",
    "bass_out_of_range": "Keep the bass between E2 and C4 where possible.",
    "voice_crossing": "Move the bass below the soprano.",
    "leap_over_octave": "Try a closer octave or a different chord inversion.",
    "seventh_leap": "Use a different inversion to replace the seventh with a smaller interval.",
    "augmented_second": "Choose a bass pitch that avoids the augmented second.",
    "augmented_fourth": "Choose a bass pitch that avoids the augmented fourth.",
    "augmented_fifth": "Choose a bass pitch that avoids the augmented fifth.",
    "tritone_leap": "Choose a bass pitch that avoids the tritone.",
    "unresolved_diminished_leap": "After a diminished leap, take a step in the opposite direction.",
    "consecutive_bass_leaps": "Use a step or change direction between the bass leaps.",
    "static_bass": "Give the bass a different chord member across the barlines.",
    "unresolved_leading_tone": "Resolve the bass leading tone up by step to its tonic.",
    "unresolved_chordal_seventh": "Resolve the bass chordal seventh down by step.",
    "harmonic_retrogression": "Place predominant harmony before the dominant or resolve the dominant to tonic.",
    "unresolved_secondary_dominant": "Follow the applied dominant with its target harmony.",
    "cadential_64_resolution": "Follow the cadential 6/4 with V or V7 over the same bass note.",
    "harmonic_syncopation": "Delay the harmony change to the next downbeat or change harmony at the barline.",
    "unequal_fifths": "Use a different bass note so the diminished fifth does not move to a perfect fifth.",
    "repeated_parallel_motion": "Break up the parallel thirds or sixths with contrary or oblique motion.",
    "limited_motion_variety": "Use contrary or oblique motion at more harmonic changes.",
    "cadence_mismatch": "Adjust the final two harmonies and bass to form the requested cadence.",
}


def _crosses_bar(onset, end, meter):
    return meter.measure(end - 2 * _EPSILON) > meter.measure(onset)


def _progression_issues(slots, anchors, meter, key):
    issues = []
    motions = []
    leap_run = parallel_run = 0
    leap_direction = last_parallel = None
    harmony_start = root_start = 0

    def add(code, category, message, index, previous=None, voices=("S", "B"), severity="error"):
        suggestion = _TIPS.get(code, "Try a different bass pitch or inversion to avoid the marked perfect interval.")
        issues.append(_Issue(code, category, message, suggestion, index, previous, voices, severity))

    for index, (slot, soprano) in enumerate(zip(slots, anchors)):
        spec, bass = slot.harmony, slot.bass
        previous = slots[index - 1] if index else None
        following = slots[index + 1] if index + 1 < len(slots) else None
        if bass.spelling != spec.expected_bass:
            expected = SpelledPitch(*spec.expected_bass, 3).spell[:-1]
            add("wrong_bass_inversion", _BASS, f"{spec.symbol} requires {expected} in the bass.", index, voices=("B",))
        if not 40 <= bass.midi <= 60:
            add("bass_out_of_range", _BASS, f"{bass.spell} is outside the standard bass range.", index,
                voices=("B",), severity="warning" if 60 < bass.midi <= 62 else "error")
        if soprano is not None and bass.midi >= soprano.midi:
            add("voice_crossing", _BASS, "The bass reaches or crosses the soprano.", index)
        root_unchanged = (previous and previous.harmony.root == spec.root == bass.spelling and previous.bass == bass
                          and _touches(previous, slot))
        if not root_unchanged:
            root_start = index
        root_measure = meter.measure(slots[root_start].onset)
        before_end = meter.measure(previous.end - 2 * _EPSILON) if root_unchanged else root_measure
        if (bass.spelling == spec.root and before_end < root_measure + 2
                <= meter.measure(slot.end - 2 * _EPSILON)):
            add("static_bass", _BASS, "The same bass root is held or repeated across two barlines.", index,
                root_start if root_start != index else None, ("B",), "warning")
        if previous is None:
            continue
        old_s = anchors[index - 1]
        if not _touches(previous, slot) or previous.harmony.symbol != spec.symbol:
            harmony_start = index
        interval = interval_between(previous.bass, bass)
        leap = _bass_leap(previous.bass, bass)
        if leap:
            add(leap, _BASS, f"The bass moves by {interval.name}.", index, index - 1, ("B",))
        elif interval.name in ("d4", "d5"):
            if following is None or not _step(bass, following.bass, -interval.direction):
                add("unresolved_diminished_leap", _BASS, f"The bass does not recover after its {interval.name} leap.",
                    index, index - 1, ("B",), "warning")
        if interval.generic_size > 2:
            leap_run = leap_run + 1 if leap_direction == interval.direction else 1
            leap_direction = interval.direction
            if leap_run == 3:
                add("consecutive_bass_leaps", _BASS, "The bass leaps three times in the same direction.", index,
                    index - 1, ("B",), "warning")
        elif interval.direction:
            leap_run = 0
        for tendency in _tendencies(previous, slot, key):
            add(tendency, _BASS, _TIPS[tendency], index, index - 1, ("B",))
        syntax = _syntax(previous, slot, key, slots[index - 2] if index > 1 else None, following)
        if syntax:
            add(syntax, _SYNTAX, f"{previous.harmony.symbol} → {spec.symbol}. {_TIPS[syntax]}",
                index, index - 1, ("B",))
        motion, code, parallel_size = _motion(previous, slot, old_s, soprano)
        if motion and (motion != "static" or previous.harmony.symbol != spec.symbol):
            motions.append({"previous_chord_index": index - 1, "chord_index": index, "motion": motion})
            if code:
                add(code, _BASS, f"The outer voices move in {code.replace('_', ' ')}.", index, index - 1)
            if parallel_size in (3, 6):
                parallel_run = parallel_run + 1 if parallel_size == last_parallel else 1
                if parallel_run == 4:
                    name = "thirds" if parallel_size == 3 else "sixths"
                    add("repeated_parallel_motion", _BASS, f"Four successive transitions use parallel {name}.",
                        index, index - 1, severity="warning")
            else:
                parallel_run = 0
            last_parallel = parallel_size

        # Evaluate each continuous Roman numeral once, including runs split into separate slots.
        if following and _touches(slot, following) and following.harmony.symbol == spec.symbol:
            continue
        start = slots[harmony_start]
        if (harmony_start and start.onset >= meter.pickup and meter.strength(start.onset) < 3
                and _crosses_bar(start.onset, slot.end, meter)):
            boundary = meter.pickup + (meter.measure(start.onset) + 1) * meter.bar
            tonic_measure = _tonic(spec, key) and slot.end >= boundary + meter.bar - _EPSILON
            if not tonic_measure:
                add("harmonic_syncopation", _SYNTAX,
                    f"{spec.symbol} begins on a weak beat and continues across the barline.", harmony_start,
                    harmony_start - 1, ("B",))

    if slots[-1].harmony.is_cadential_64:
        add("cadential_64_resolution", _SYNTAX, "The final cadential 6/4 has no resolution.", len(slots) - 1, voices=("B",))
    if len(motions) >= 5 and sum(row["motion"] in ("contrary", "oblique") for row in motions) * 4 < len(motions):
        add("limited_motion_variety", _BASS, "Fewer than one in four outer-voice transitions use contrary or oblique motion.",
            motions[-1]["chord_index"], motions[-1]["previous_chord_index"], severity="warning")
    return issues, motions


def _evaluate(notes, slots, phrases, meter, key):
    analysis = _classifications(notes, slots, meter)
    cadences = _cadences(notes, slots, phrases, key)
    issues, motions = _progression_issues(slots, _anchors(notes, slots), meter, key)
    for note, row in zip(notes, analysis):
        if row["classification"] == "CLASH":
            index = row["chord_index"]
            code = "unharmonized_melody" if index is None else "melody_clash"
            message = (f"No harmony covers {note.pitch.spell}." if index is None else
                       f"{note.pitch.spell} is an unresolved dissonance over {slots[index].harmony.symbol}.")
            issues.append(_Issue(code, _FIT, message, _TIPS[code], index, voices=("S",), note=note.index,
                                 onset=note.onset))
        for clash in row.get("sustained_clashes", ()):
            clash_index = clash["chord_index"]
            issues.append(_Issue("melody_clash", _FIT,
                                 f"Sustained {note.pitch.spell} becomes an unresolved dissonance over {slots[clash_index].harmony.symbol}.",
                                 _TIPS["melody_clash"], clash_index, voices=("S",), note=note.index,
                                 onset=slots[clash_index].onset))
    for cadence in cadences:
        if not cadence["passed"]:
            indices = cadence["chord_indices"]
            issues.append(_Issue("cadence_mismatch", _FIT, f"{cadence['phrase']}. {cadence['message']}",
                                 _TIPS["cadence_mismatch"], indices[-1] if indices else None,
                                 indices[0] if len(indices) == 2 else None, onset=cadence["onset"]))
    issues.sort(key=lambda issue: issue.index if issue.index is not None else len(slots))
    return issues, analysis, cadences, motions


@lru_cache(maxsize=2048)
def _voicing_candidates(soprano, bass, spec):
    members = spec.chord_members
    if soprano is None:
        # Keep a usable progression even when the melody rests during a slot.
        soprano = min(_voice_options(0, members), key=lambda pitch: abs(pitch.midi - 67))
    required = set(members)
    if spec.inversion == 0 and spec.quality not in ("diminished", "augmented"):
        required.discard(spec.fifth)
    options = []
    for alto, tenor in product(_voice_options(1, members), _voice_options(2, members)):
        voicing = (soprano, alto, tenor, bass)
        gaps = [upper.midi - lower.midi for upper, lower in zip(voicing, voicing[1:])]
        # Invalid student basses and extreme scanned melodies still get an audible preview.
        cost = sum(35 if gap < 0 else max(0, gap - limit) for gap, limit in zip(gaps, (12, 12, 24)))
        spellings = Counter(pitch.spelling for pitch in voicing)
        cost += 6 * len(required - spellings.keys())
        cost += 12 * sum(max(0, spellings[tone.pitch] - 1) for tone in spec.tendency_tones)
        if spec.inversion == 2 and not spec.is_seventh:
            cost += 8 * (spellings[spec.expected_bass] < 2)
        if not spec.inversion and not spec.is_seventh:
            cost += 1.5 * (spellings[spec.root] < 2)
        cost += (abs(alto.midi - 63) + abs(tenor.midi - 56)) / 20
        options.append((cost, voicing))
    return sorted(options, key=lambda option: option[0])[:14]


def _realize(notes, slots, key):
    anchors = _anchors(notes, slots)
    candidates = [_voicing_candidates(soprano, slot.bass, slot.harmony) for slot, soprano in zip(slots, anchors)]
    scores = [cost for cost, _ in candidates[0]]
    history = []
    for index in range(1, len(slots)):
        options = candidates[index]
        parents = []
        next_scores = []
        for local_cost, voicing in options:
            best = (float("inf"), 0)
            for prior, (before_cost, (_, before)) in enumerate(zip(scores, candidates[index - 1])):
                motion_cost = sum(abs(after.midi - old.midi) for after, old in zip(voicing[1:3], before[1:3])) / 5
                rules_cost = 5 * score_transition_voicing(
                    before, voicing, key, previous_harmony=slots[index - 1].harmony, current_harmony=slots[index].harmony,
                )
                best = min(best, (before_cost + motion_cost + rules_cost + local_cost, prior))
            total, prior = best
            next_scores.append(total)
            parents.append(prior)
        scores = next_scores
        history.append(parents)
    choice = min(range(len(scores)), key=scores.__getitem__)
    path = [choice]
    for parents in reversed(history):
        choice = parents[choice]
        path.append(choice)
    return [{"onset": slot.onset, "duration": slot.duration, "roman": slot.harmony.symbol,
             "voices": {voice: pitch.to_dict() for voice, pitch in zip(VOICES, options[choice][1])}}
            for slot, options, choice in zip(slots, candidates, reversed(path))]


def realize_satb(melody, harmonization, key):
    """Realize the inner voices while retaining the given melody and bass."""
    if not isinstance(key, Key):
        key = _key_from_payload({"key": key})
    return _realize(_read_notes(melody), _read_slots(harmonization, key), key)


def _events(notes, slots, preview, start, end, inner):
    def event(pitch, voice, onset, duration, index):
        return {"voice": voice, "spell": pitch["spell"], "display": pitch["display"], "midi": pitch["midi"],
                "onset": onset - start, "duration": duration, "chordIndex": index}

    events = []
    starts = [slot.onset for slot in slots]
    for note in notes:
        onset, stop = max(start, note.onset), min(end, note.end)
        if onset < stop - _EPSILON:
            events.append(event(note.pitch.to_dict(), "S", onset, stop - onset, _covering(slots, starts, onset)))
    for index, slot in enumerate(slots):
        onset, stop = max(start, slot.onset), min(end, slot.end)
        if onset < stop - _EPSILON:
            for voice in ("A", "T", "B") if inner else ("B",):
                events.append(event(preview[index]["voices"][voice], voice, onset, stop - onset, index))
    return sorted(events, key=lambda entry: (entry["onset"], VOICES.index(entry["voice"])))


@lru_cache(maxsize=30)
def _harmonies(key):
    symbols = (("I", "I6", "ii6", "IV", "vi") if key.mode == "major" else
               ("i", "i6", "ii°6", "iv", "VI"))
    return tuple(parse_roman_numeral(symbol, key) for symbol in
                 (*symbols, "V", "V6", "V7", "V6/5", "V4/2", "vii°6", "Cad6/4"))


def _fixed_slots(issue, notes, slots, phrases, meter, key, original, analysis, note_positions):
    if issue.index is None:
        return None
    index = issue.index
    slot = slots[index]
    harmony = slot.harmony
    options = [harmony]
    if issue.code != "wrong_bass_inversion":
        options.extend(spec for spec in _harmonies(key) if spec.symbol != harmony.symbol)
    candidates = [(spec, bass) for spec in options for bass in _voice_options(3, (spec.expected_bass,))
                  if (spec, bass) != (harmony, slot.bass)]
    candidates.sort(key=lambda pair: (pair[0].symbol != harmony.symbol, abs(pair[1].midi - slot.bass.midi)))
    for spec, bass in candidates:
        if issue.code == "melody_clash":
            position = note_positions[issue.note]
            previous = position - 1
            following = position + 1

            def at(note_index):
                if not 0 <= note_index < len(notes):
                    return None, None, None
                chord = analysis[note_index]["chord_index"]
                harmony_at_note = spec if chord == index else slots[chord].harmony if chord is not None else None
                return notes[note_index], harmony_at_note, chord

            before, old, _ = at(previous)
            after, new, next_chord = at(following)
            if _fit(notes[position], spec, before, old, after, new, meter, next_chord == index + 1) == "CLASH":
                continue
        edited = [*slots]
        edited[index] = replace(slot, harmony=spec, bass=bass)
        # Rebuild contextual harmony on both sides of the edit before checking regressions.
        edited = _contextualize([replace(row, harmony=parse_roman_numeral(row.harmony.symbol, key)) for row in edited])
        errors = {item.identity for item in _evaluate(notes, edited, phrases, meter, key)[0] if item.severity == "error"}
        if issue.identity not in errors and not errors - original:
            return edited
    return None


def _serialize_issues(issues, notes, slots, preview, phrases, meter, key, analysis, *, all_issues):
    original = {issue.identity for issue in all_issues if issue.severity == "error"}
    note_positions = {note.index: position for position, note in enumerate(notes)}
    result = []
    for index, issue in enumerate(issues):
        indices = [position for position in (issue.previous, issue.index) if position is not None]
        if indices:
            start, end = slots[indices[0]].onset, slots[indices[-1]].end
        elif issue.note is not None:
            note = notes[note_positions[issue.note]]
            start, end = note.onset, note.end
        else:
            start, end = slots[-1].onset, slots[-1].end
        audio = {"isolated_pair": _events(notes, slots, preview, start, end, False),
                 "in_context": _events(notes, slots, preview, start, end, True)}
        suggestion = issue.suggestion
        if issue.code in {"parallel_fifths", "parallel_octaves", "wrong_bass_inversion", "melody_clash"}:
            fixed = _fixed_slots(issue, notes, slots, phrases, meter, key, original, analysis, note_positions)
            if fixed is not None:
                chosen = fixed[issue.index]
                clip_slots = fixed[indices[0]:indices[-1] + 1]
                revised = [*preview]
                revised[indices[0]:indices[-1] + 1] = _realize(notes, clip_slots, key)
                audio["fixed_comparison"] = {
                    "label": "Compare a corrected harmonization",
                    "before_events": audio["in_context"], "after_events": _events(notes, fixed, revised, start, end, True),
                    "fixed_bass": chosen.bass.spell, "fixed_roman": chosen.harmony.symbol,
                }
                suggestion = f"Try {chosen.harmony.symbol} with {chosen.bass.spell} in the bass."
        result.append({"id": f"issue-{index}", "code": issue.code, "rule_id": issue.code,
                       "title": issue.code.replace("_", " ").capitalize(), "category": issue.category,
                       "message": issue.message, "suggestion": suggestion, "severity": issue.severity,
                       "chord_index": issue.index, "previous_chord_index": issue.previous,
                       "chords": indices, "voices": list(issue.voices), "note_index": issue.note, "audio_demo": audio})
    return result


def _summary(issues):
    errors = Counter(issue.category for issue in issues if issue.severity == "error")
    warnings = Counter(issue.category for issue in issues if issue.severity == "warning")
    rubric = [{"name": name, "earned": max(0, 3 - errors[name]), "possible": 3,
               "notes": f"{errors[name]} errors, {warnings[name]} warnings"} for name in _RUBRIC]
    points = sum(item["earned"] for item in rubric)
    score = round(points * 100 / 9)
    label = "Excellent" if score >= 90 else "Proficient" if score >= 75 else "Developing" if score >= 60 else "Needs practice"
    return {"score": score, "max_score": 100, "ap_points": points, "ap_max_points": 9, "grade_label": label,
            "error_count": sum(errors.values()), "warning_count": sum(warnings.values()), "rubric": rubric}


def _payload(payload):
    if not isinstance(payload, Mapping):
        raise ValueError("Provide a melody exercise object.")
    return (_key_from_payload(payload), _meter(payload), _read_notes(payload.get("melody")),
            _read_phrases(payload.get("phrases")))


def grade_melody_harmonization(payload: dict) -> dict:
    """Grade a melody and bass, with optional given material before the grading start."""
    key, meter, notes, phrases = _payload(payload)
    grade_from = payload.get("grade_from_onset", 0)
    if type(grade_from) not in (int, float) or not 0 <= grade_from <= float_info.max:
        raise ValueError("Grade from onset must be a nonnegative finite beat value.")
    grade_from = float(grade_from)
    slots = _read_slots(payload.get("harmonization"), key, notes=notes, grade_from=grade_from)
    all_issues, analysis, cadences, motions = _evaluate(notes, slots, phrases, meter, key)
    issues = all_issues
    if grade_from:
        # Evaluate with the given measures in place so the first student transition has its approach.
        issues = [issue for issue in all_issues if (issue.onset if issue.onset is not None
                  else slots[issue.index].onset) >= grade_from - _EPSILON]
        cadences = [cadence for cadence in cadences if cadence["onset"] >= grade_from - _EPSILON]
    preview = _realize(notes, slots, key)
    return {"key": {"tonic": key.tonic, "mode": key.mode, "signature": key.signature},
            "grade_from_onset": grade_from,
            "summary": _summary(issues), "melody_analysis": analysis, "cadences": cadences,
            "motions": motions, "satb_preview": preview,
            "chords": [{"index": index, "onset": slot.onset, "duration": slot.duration,
                        "roman": slot.harmony.symbol, "function": _function(slot.harmony), "bass": slot.bass.to_dict()}
                       for index, slot in enumerate(slots)],
            "issues": _serialize_issues(issues, notes, slots, preview, phrases, meter, key, analysis,
                                        all_issues=all_issues)}


@dataclass(frozen=True)
class _Frame:
    onset: float
    pitch: SpelledPitch
    attack: int | None


@dataclass(frozen=True)
class _SearchPath:
    score: float
    slot: _Slot
    start: int
    run_start: int
    from_slot: _Slot | None
    changes: int
    attacks: tuple
    parent: "_SearchPath | None"


def _search_frames(notes, meter):
    frames = []
    for index, note in enumerate(notes):
        if index:
            previous = notes[index - 1]
            boundary = meter.pickup + (meter.measure(previous.onset) + 1) * meter.bar
            if boundary < note.onset - _EPSILON:
                pitch = previous.pitch if boundary < previous.end - _EPSILON else note.pitch
                frames.append(_Frame(boundary, pitch, None))
        frames.append(_Frame(note.onset, note.pitch, index))
    return frames


def _search_transition(path, slot, frames, notes, index, meter, key, cadence_targets):
    previous = path.slot
    frame = frames[index]
    same = slot.harmony == previous.harmony and slot.bass == previous.bass
    same_roman = slot.harmony == previous.harmony
    start = path.start if same else index
    run_start = path.run_start if same_roman else index
    from_slot = path.from_slot if same else previous
    changes = path.changes + int(not same)
    attacks = path.attacks
    cost = path.score

    if frame.attack is not None:
        attack = frame.attack
        prepared = notes[attack - 2] if attack >= 2 else None
        previous_note = notes[attack - 1]
        last_harmony, last_change = attacks[-1]
        classification = _fit(previous_note, last_harmony, prepared, attacks[0][0] if prepared else None,
                              notes[attack], slot.harmony, meter, changes == last_change + 1)
        if classification == "CLASH":
            cost += 26 + 5 * meter.strength(previous_note.onset) + 5 * min(previous_note.duration, 2)
        elif classification != "CT":
            cost += 1 + 2 * meter.strength(previous_note.onset) + 2 * min(previous_note.duration, 2)
        attacks = (*attacks[-1:], (slot.harmony, changes))
    elif frame.pitch.spelling not in slot.harmony.chord_members:
        # Barline frame under a sustained melody note: penalize dissonant harmonies unless resolved as a suspension.
        next_attack = next((f.attack for f in frames[index + 1:] if f.attack is not None), None)
        resolves_down = (next_attack is not None and _step(frame.pitch, notes[next_attack].pitch, -1)
                         and notes[next_attack].pitch.spelling in slot.harmony.chord_members)
        if not resolves_down:
            cost += 36

    run_onset = frames[run_start].onset
    if (run_start and run_onset >= meter.pickup and meter.strength(run_onset) < 3
            and _crosses_bar(run_onset, slot.end, meter)
            and (not same_roman or not _crosses_bar(run_onset, previous.end, meter))):
        cost += 34
    if slot.bass.midi >= frame.pitch.midi:
        cost += 45
    if not same:
        motion, issue, _ = _motion(previous, slot, frames[path.start].pitch, frame.pitch)
        cost += 28 * bool(issue) + 27 * bool(_syntax(previous, slot, key))
        cost += 30 * bool(_bass_leap(previous.bass, slot.bass))
        cost += 25 * sum(1 for _ in _tendencies(previous, slot, key))
        distance = abs(previous.bass.midi - slot.bass.midi)
        cost += distance * 0.32 + 0.4 * max(0, distance - 5)
        cost += {0: 5, 1: 2.8, 2: 1.6, 3: 1}[meter.strength(slot.onset)]
        cost -= {"contrary": 0.8, "oblique": 0.5}.get(motion, 0)
        if slot.harmony.is_cadential_64:
            if _function(previous.harmony) == "D":
                cost += 22
            if meter.strength(slot.onset) < 2:
                cost += 2
            next_frame_attack = frames[index + 1].attack if index + 1 < len(frames) else None
            next_next_attack = frames[index + 2].attack if index + 2 < len(frames) else None
            near_cadence = (next_frame_attack in cadence_targets) or (next_next_attack in cadence_targets)
            if not near_cadence:
                cost += 3.5
    if meter.strength(slot.onset) >= 2 and slot.harmony.inversion == 0:
        cost -= 0.25
    for target, weight, phrase_start in cadence_targets.get(frame.attack, ()):
        detected = (_cadence(from_slot, slot, frame.pitch, key)
                    if from_slot and from_slot.end > phrase_start + _EPSILON else None)
        if not _cadence_matches(detected, target):
            cost += weight
    return _SearchPath(cost, slot, start, run_start, from_slot, changes, attacks, path)


def _search(notes, phrases, meter, key):
    cadence_targets = {}
    for phrase, note in _phrase_end_notes(notes, phrases).items():
        if note is not None and phrase.expected != "any":
            cadence_targets.setdefault(note.index, []).append((phrase.expected, 42, phrase.start))
    if not phrases and len(notes) >= 2 and notes[-1].pitch.spelling == key.scale_pitches[0]:
        cadence_targets[notes[-1].index] = [("PAC", 14, notes[0].onset)]
    # Note indices refer to the supplied order; the search is in chronological order.
    cadence_targets = {index: cadence_targets[note.index] for index, note in enumerate(notes)
                       if note.index in cadence_targets}
    choices = [(spec, bass) for spec in _harmonies(key) for bass in _voice_options(3, (spec.expected_bass,))]
    frames = _search_frames(notes, meter)
    paths = []
    for index, frame in enumerate(frames):
        end = frames[index + 1].onset if index + 1 < len(frames) else notes[-1].end
        candidates = [_Slot(frame.onset, end - frame.onset, bass, spec) for spec, bass in choices]
        if not index:
            paths = [_SearchPath(8 * (not _tonic(slot.harmony, key)) + 2 * slot.harmony.inversion
                                 + 45 * (slot.bass.midi >= frame.pitch.midi), slot, 0, 0, None, 0,
                                 ((slot.harmony, 0),), None)
                     for slot in candidates if not slot.harmony.is_cadential_64]
            continue
        best = {}
        for path in paths:
            for slot in candidates:
                next_path = _search_transition(path, slot, frames, notes, index, meter, key, cadence_targets)
                # Paths with the same preparation, anchor, and cadence approach have the same future costs.
                attacks = tuple((harmony, min(next_path.changes - change, 2)) for harmony, change in next_path.attacks)
                state = (slot.harmony, slot.bass, attacks, next_path.start, next_path.run_start,
                         (next_path.from_slot.harmony, next_path.from_slot.bass, next_path.from_slot.end)
                         if next_path.from_slot else None)
                if state not in best or next_path.score < best[state].score:
                    best[state] = next_path
        paths = sorted(best.values(), key=lambda path: path.score)[:40]
    final_pitch = notes[-1].pitch.spelling
    path = min(paths, key=lambda entry: entry.score + 38 * (final_pitch not in entry.slot.harmony.chord_members)
               + 34 * entry.slot.harmony.is_cadential_64)
    reversed_slots = []
    while path:
        slot = path.slot
        if reversed_slots and (slot.harmony, slot.bass) == (reversed_slots[-1].harmony, reversed_slots[-1].bass):
            reversed_slots[-1] = replace(slot, duration=reversed_slots[-1].end - slot.onset)
        else:
            reversed_slots.append(slot)
        path = path.parent
    return list(reversed(reversed_slots))


def suggest_harmonization(payload: dict) -> dict:
    """Search for a functional bass and Roman numeral analysis for a given melody."""
    key, meter, notes, phrases = _payload(payload)
    slots = _search(notes, phrases, meter, key)
    harmonization = [{"onset": slot.onset, "duration": slot.duration, "bass": slot.bass.spell, "roman": slot.harmony.symbol}
                     for slot in slots]
    grade = grade_melody_harmonization({**payload, "harmonization": harmonization})
    return {"harmonization": harmonization, "satb_preview": grade["satb_preview"], "grade": grade}

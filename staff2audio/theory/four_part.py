"""Grade spelled SATB progressions and suggest local voice-leading corrections."""

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from functools import lru_cache
from itertools import combinations, product

from staff2audio.theory.chords import (
    FiguredBassSpec, RomanNumeralSpec, identify_chord, parse_figured_bass, parse_roman_numeral,
    with_cadential_context,
)
from staff2audio.theory.pitch import Key, PitchClass, SpelledPitch, interval_between, parse_pitch


VOICES = ("S", "A", "T", "B")
_VOICE_NAMES = ("soprano", "alto", "tenor", "bass")
_VOICE_INDEX = {name: index for index, (short, long) in enumerate(zip(VOICES, _VOICE_NAMES))
                for name in (short, short.lower(), long)}
_PAIRS = tuple(combinations(range(4), 2))
_RANGES = ((60, 79), (55, 74), (48, 67), (40, 60))
_HARMONY, _DOUBLING, _POSITION, _MOTION, _RESOLUTION = (
    "Harmonic accuracy", "Doubling", "Range and spacing", "Voice leading", "Tendency tones",
)
_RUBRIC = (_HARMONY, _DOUBLING, _POSITION, _MOTION, _RESOLUTION)

Voicing = tuple[SpelledPitch, ...]


@dataclass(frozen=True)
class _Chord:
    pitches: Voicing
    harmony: RomanNumeralSpec | None
    figured: FiguredBassSpec | None = None
    locks: tuple[tuple[int, SpelledPitch], ...] = ()


@dataclass(frozen=True)
class _Issue:
    code: str
    category: str
    message: str
    chord_index: int
    voices: tuple[int, ...]
    previous_chord_index: int | None = None
    severity: str = "error"

    @property
    def identity(self) -> tuple:
        return self.chord_index, self.previous_chord_index, self.code, self.severity, self.voices


def _pitch(value: str | SpelledPitch) -> SpelledPitch:
    return value if isinstance(value, SpelledPitch) else parse_pitch(value)


def _voicing(values: Mapping | Sequence) -> Voicing:
    if isinstance(values, Mapping):
        values = [values.get(short, values.get(short.lower(), values.get(long)))
                  for short, long in zip(VOICES, _VOICE_NAMES)]
    if not isinstance(values, Sequence) or isinstance(values, str) or len(values) != 4:
        raise ValueError("Provide four voices in S, A, T, B order.")
    return tuple(_pitch(value) for value in values)


def _locked(values: object, reference: Voicing | None = None) -> tuple[dict[int, SpelledPitch], set[int]]:
    if isinstance(values, (list, tuple)):
        values = dict.fromkeys(values, True) if all(isinstance(name, str) for name in values) else None
    if not isinstance(values, Mapping):
        raise ValueError("Locked voices must be a list of voice names or a mapping to pitches.")
    locks = {}
    explicit = set()
    for name, value in values.items():
        index = _VOICE_INDEX.get(name)
        if index is None:
            raise ValueError(f"Unknown locked voice {name!r}.")
        if value is not False:
            if value is True and reference:
                locks[index] = reference[index]
            else:
                locks[index] = _pitch(value)
                explicit.add(index)
    return locks, explicit


def _key_from_payload(payload: dict) -> Key:
    key = payload.get("key")
    if isinstance(key, Key):
        return key
    if isinstance(key, str):
        parts = key.split()
        if len(parts) == 2:
            return Key.from_tonic_mode(*parts)
        return Key.from_tonic_mode(key, payload.get("mode", "major"))
    if key is None:
        key = payload
    if isinstance(key, Mapping):
        mode = key.get("mode", "major")
        if "signature" in key or "key_signature" in key:
            return Key.from_signature(key.get("signature", key.get("key_signature")), mode)
        return Key.from_tonic_mode(key.get("tonic", key.get("key_tonic")), mode)
    raise ValueError("Provide a key such as C major or a key with tonic and mode.")


def _read_chord(row: dict, exercise_type: str, key: Key) -> _Chord:
    if not isinstance(row, Mapping):
        raise ValueError("Chords must be objects with four voice pitches.")
    pitches = _voicing(row.get("voices", row.get("pitches", row)))
    locks, explicit_locks = _locked(row.get("locked_voices", {}), pitches)
    harmony = None
    figured = None
    if exercise_type == "roman_numeral":
        symbol = row.get("roman_numeral", row.get("roman", row.get("symbol")))
        if not isinstance(symbol, str):
            raise ValueError("Provide a Roman numeral for each chord.")
        harmony = parse_roman_numeral(symbol, key)
    elif exercise_type == "figured_bass":
        figure = row.get("figure", row.get("figured_bass", ""))
        bass = _pitch(row.get("given_bass", row.get("bass", pitches[3])))
        if 3 in explicit_locks and locks[3] != bass:
            raise ValueError("The locked bass must match the given figured bass note.")
        locks[3] = bass
        figured = parse_figured_bass(figure, bass, key)
        harmony = figured.roman_numeral
    else:
        harmony = identify_chord(list(pitches), key, pitches[3])["spec"]
    return _Chord(pitches, harmony, figured, tuple(sorted(locks.items())))


def _pitch_class_name(pitch: PitchClass) -> str:
    return SpelledPitch(*pitch, 4).spell[:-1]


def _members(chord: _Chord) -> tuple[PitchClass, ...]:
    if chord.figured:
        return chord.figured.chord_members
    return chord.harmony.chord_members if chord.harmony else ()


def _required_members(chord: _Chord) -> tuple[PitchClass, ...]:
    harmony, figured = chord.harmony, chord.figured
    members = _members(chord)
    if harmony and harmony.inversion == 0 and harmony.quality not in ("diminished", "augmented"):
        if figured is None or 5 not in figured.explicit_intervals:
            return tuple(member for member in members if member != harmony.fifth)
    return members


def _chord_issues(chord: _Chord, key: Key, index: int) -> list[_Issue]:
    notes, harmony, figured = chord.pitches, chord.harmony, chord.figured
    issues = []

    def add(code: str, category: str, message: str, voices: tuple[int, ...], severity: str = "error") -> None:
        issues.append(_Issue(code, category, message, index, voices, severity=severity))

    for voice, note in enumerate(notes):
        low, high = _RANGES[voice]
        if not low <= note.midi <= high:
            severity = "warning" if voice == 0 and high < note.midi <= 81 else "error"
            add("out_of_range", _POSITION, f"{note.spell} is outside the standard {_VOICE_NAMES[voice]} range.",
                (voice,), severity)
    for upper, limit in enumerate((12, 12, 24)):
        lower = upper + 1
        gap = notes[upper].midi - notes[lower].midi
        if gap < 0:
            add("voice_crossing", _POSITION, f"{VOICES[upper]} is below {VOICES[lower]}.", (upper, lower))
        elif gap > limit:
            distance = "two octaves" if upper == 2 else "an octave"
            add("spacing", _POSITION, f"{VOICES[upper]} and {VOICES[lower]} are more than {distance} apart.",
                (upper, lower), "warning" if upper == 2 else "error")

    spellings = [note.spelling for note in notes]
    members = _members(chord)
    if not members:
        add("unrecognized_chord", _HARMONY, "The pitches do not spell a recognizable AP harmony.", (0, 1, 2, 3))
        return issues
    if figured and notes[3] != figured.bass:
        add("wrong_bass", _HARMONY, f"Keep the given figured bass {figured.bass.spell}.", (3,))
    elif harmony and spellings[3] != harmony.expected_bass:
        add("wrong_bass_inversion", _HARMONY,
            f"{harmony.symbol} requires {_pitch_class_name(harmony.expected_bass)} in the bass.", (3,))
    for voice, spelling in enumerate(spellings):
        if spelling not in members:
            add("extraneous_pitch", _HARMONY, f"{notes[voice].spell} is not a correctly spelled chord member.", (voice,))

    required = _required_members(chord)
    figures_by_pitch = {pitch: size for size, pitch in figured.intervals} if figured else {}
    raised_leading_tone = key.leading_tone if key.mode == "minor" else None
    count = Counter(spellings)
    for member in required:
        if member in count:
            continue
        name = _pitch_class_name(member)
        if figured and (harmony is None or figures_by_pitch.get(member) in figured.explicit_intervals):
            size = figures_by_pitch.get(member)
            if size is not None:
                add("unrealized_figured_bass", _HARMONY,
                    f"The figure requires {name}, a {size} above {figured.bass.spell}.", (0, 1, 2, 3))
                continue
        if harmony:
            if member == raised_leading_tone and any(tone.pitch == member and tone.kind == "leading_tone"
                                                      for tone in harmony.tendency_tones):
                add("missing_raised_leading_tone", _HARMONY, f"Raise scale degree 7 to {name} in {harmony.symbol}.",
                    (0, 1, 2, 3))
            else:
                role = ("root", "third", "fifth", "seventh")[members.index(member)]
                add(f"missing_{role}", _HARMONY, f"The {role} of {harmony.symbol}, {name}, is missing.", (0, 1, 2, 3))

    leading_tones = {tone.pitch: tone for tone in harmony.tendency_tones if tone.kind == "leading_tone"} if harmony else {}
    for spelling, occurrences in count.items():
        if occurrences < 2 or spelling not in members:
            continue
        voices = tuple(voice for voice, note in enumerate(spellings) if note == spelling)
        name = _pitch_class_name(spelling)
        if spelling in leading_tones or (harmony is None and spelling == key.leading_tone):
            secondary = spelling in leading_tones and bool(harmony.secondary_target)
            code = "doubled_secondary_leading_tone" if secondary else "doubled_leading_tone"
            add(code, _DOUBLING, f"The {'secondary ' if secondary else ''}leading tone {name} is doubled.", voices)
        elif harmony and spelling == harmony.seventh:
            add("doubled_chordal_seventh", _DOUBLING, f"The chordal seventh {name} is doubled.", voices)
        elif key.degree_of(notes[voices[0]])[1]:
            add("doubled_chromatic_pitch", _DOUBLING, f"The chromatically altered pitch {name} is doubled.", voices)
    inversion = figured.inversion if figured else harmony.inversion
    is_seventh = figured.is_seventh if figured else harmony.is_seventh
    expected_bass = figured.bass.spelling if figured else harmony.expected_bass
    if inversion == 2 and not is_seventh and count[expected_bass] < 2:
        add("six_four_doubling", _DOUBLING, "Double the bass, the fifth of the triad, in a 6/4 chord.", (0, 1, 2, 3))
    if (harmony and harmony.quality == "diminished" and harmony.inversion == 1
            and count[harmony.root] > 1 and harmony.root not in leading_tones):
        voices = tuple(voice for voice, note in enumerate(spellings) if note == harmony.root)
        add("diminished_triad_doubling", _DOUBLING, "Double the third or fifth of this diminished triad.", voices)
    return issues


def _perfect_family(interval_name: str) -> str | None:
    if interval_name == "P5":
        return "fifths"
    if interval_name in ("P1", "P8"):
        return "octaves"
    return None


def _step(old: SpelledPitch, new: SpelledPitch, direction: int) -> bool:
    return (new.diatonic_number - old.diatonic_number == direction
            and (new.midi - old.midi) * direction in (1, 2))


def _same_harmony(first: RomanNumeralSpec, second: RomanNumeralSpec | None) -> bool:
    return bool(second and first.chord_members == second.chord_members)


def _prolonged_dominant(first: RomanNumeralSpec, second: RomanNumeralSpec | None) -> bool:
    return bool(second and first.root == second.root and first.secondary_target == second.secondary_target
                and first.function == "D" and second.function == "D")


def _primary_dominant(spec: RomanNumeralSpec | None) -> bool:
    return bool(spec and spec.degree == 5 and not spec.secondary_target
                and spec.quality in ("major", "dominant_seventh") and spec.function == "D")


def _tonic(spec: RomanNumeralSpec | None, key: Key) -> bool:
    return bool(spec and spec.degree == 1 and spec.root == key.scale_pitches[0] and not spec.secondary_target)


def _transition_issues(first: _Chord, second: _Chord, key: Key | None, index: int,
                       following: _Chord | None = None) -> list[_Issue]:
    before, after = first.pitches, second.pitches
    old_harmony, new_harmony = first.harmony, second.harmony
    movement = tuple(new.midi - old.midi for old, new in zip(before, after))
    issues = []

    def add(code: str, message: str, voices: tuple[int, ...], category: str = _MOTION,
            severity: str = "error") -> None:
        issues.append(_Issue(code, category, message, index, voices, index - 1, severity))

    for upper, lower in _PAIRS:
        pair = upper, lower
        if (lower == upper + 1 and before[upper].midi >= before[lower].midi and after[upper].midi >= after[lower].midi and
                (after[upper].midi < before[lower].midi or after[lower].midi > before[upper].midi)):
            add("voice_overlap", f"{VOICES[upper]} and {VOICES[lower]} overlap across the two chords.", pair)
        motion = movement[upper] * movement[lower]
        if not motion or before[upper].midi < before[lower].midi or after[upper].midi < after[lower].midi:
            continue
        old_interval = interval_between(before[lower], before[upper]).simple_name
        new_interval = interval_between(after[lower], after[upper]).simple_name
        old_family, new_family = _perfect_family(old_interval), _perfect_family(new_interval)
        if old_family and old_family == new_family:
            direction = "parallel" if motion > 0 else "contrary"
            add(f"{direction}_{new_family}", f"{VOICES[upper]} and {VOICES[lower]} move in {direction} {new_family}.", pair)
        elif lower == 3 and old_interval == "d5" and new_interval == "P5":
            add("unequal_fifths", "A diminished fifth moves to a perfect fifth against the bass.", pair)
        elif pair == (0, 3) and old_interval == "P5" and new_interval == "d5":
            add("unequal_fifths", "A perfect fifth moves to a diminished fifth in the outer voices.", pair,
                severity="warning")
        elif (pair == (0, 3) and motion > 0 and new_family
              and abs(after[0].diatonic_number - before[0].diatonic_number) > 1):
            add(f"direct_{new_family}", f"The outer voices approach {new_family} in similar motion with a soprano leap.", pair)

    for voice, (old, new) in enumerate(zip(before, after)):
        interval = interval_between(old, new)
        if abs(interval.semitones) > 12 or interval.is_compound:
            add("leap_over_octave", f"{VOICES[voice]} leaps more than an octave ({interval.name}).", (voice,))
        elif interval.generic_size == 7:
            add("seventh_leap", f"{VOICES[voice]} leaps a seventh ({interval.name}).", (voice,))
        elif interval.quality.startswith("A") and interval.generic_size in (2, 4, 5):
            sizes = {2: "second", 4: "fourth", 5: "fifth"}
            size = sizes[interval.generic_size]
            add(f"augmented_{size}", f"{VOICES[voice]} moves by an augmented {size} ({interval.name}).", (voice,))
        elif interval.quality.startswith("d") and interval.generic_size > 2:
            if following is None or not _step(new, following.pitches[voice], -interval.direction):
                add("unresolved_diminished_leap", f"{VOICES[voice]} should follow {interval.name} with a step in the opposite direction.",
                    (voice,))

    if old_harmony is None or key is None:
        return issues
    same_harmony = _same_harmony(old_harmony, new_harmony)
    prolonged_dom = _prolonged_dominant(old_harmony, new_harmony)
    for tone in old_harmony.tendency_tones:
        for voice, (old, new) in enumerate(zip(before, after)):
            if old.spelling != tone.pitch or ((same_harmony or prolonged_dom) and old == new):
                continue
            if tone.kind == "leading_tone":
                if _step(old, new, 1) and new.spelling == tone.target:
                    continue
                if (old_harmony.secondary_target and new_harmony and new_harmony.seventh == new.spelling
                        and old.letter == new.letter and new.midi == old.midi - 1):
                    continue
                if (voice in (1, 2) and _primary_dominant(old_harmony) and _tonic(new_harmony, key)
                        and new.spelling == new_harmony.fifth
                        and old.diatonic_number - new.diatonic_number == 2
                        and set(new_harmony.chord_members) <= {note.spelling for note in after}):
                    continue
                add("unresolved_leading_tone", f"{VOICES[voice]}'s leading tone {old.spell} should resolve up to {_pitch_class_name(tone.target)}.",
                    (voice,), _RESOLUTION)
            elif not _step(old, new, -1):
                if new_harmony and new_harmony.is_cadential_64 and old == new and old.spelling == new_harmony.root:
                    continue
                if (_primary_dominant(old_harmony) and old_harmony.inversion == 2 and _tonic(new_harmony, key)
                        and new_harmony.inversion == 1 and before[3].spelling == key.scale_pitches[1]
                        and after[3].spelling == new_harmony.third and _step(before[3], after[3], 1)
                        and _step(old, new, 1) and new.spelling == new_harmony.fifth):
                    continue
                add("unresolved_chordal_seventh", f"{VOICES[voice]}'s chordal seventh {old.spell} should resolve down by step.",
                    (voice,), _RESOLUTION)

    if old_harmony.is_cadential_64:
        if (not _primary_dominant(new_harmony) or new_harmony.inversion != 0
                or before[3].spelling != old_harmony.expected_bass or before[3] != after[3]):
            add("cadential_64_bass", "Resolve the cadential 6/4 to V or V7 over a stationary scale degree 5.",
                (3,), _RESOLUTION)
        else:
            resolutions = {old_harmony.root: (new_harmony.third, "4–3"), old_harmony.third: (new_harmony.fifth, "6–5")}
            for voice, (old, new) in enumerate(zip(before, after)):
                if old.spelling in resolutions:
                    target, label = resolutions[old.spelling]
                    if new.spelling != target or not _step(old, new, -1):
                        add("cadential_64_resolution", f"{VOICES[voice]} should resolve {label} down by step over the bass.",
                            (voice,), _RESOLUTION)
    return issues


def _contextualize(chords: tuple[_Chord, ...]) -> tuple[_Chord, ...]:
    result = []
    for index, chord in enumerate(chords):
        if chord.harmony and index + 1 < len(chords):
            harmony = with_cadential_context(chord.harmony, chords[index + 1].harmony)
            chord = replace(chord, harmony=harmony)
        result.append(chord)
    return tuple(result)


def _cadence(chords: tuple[_Chord, ...], key: Key) -> str | None:
    if len(chords) < 2:
        return None
    previous, current = chords[-2:]
    old, new = previous.harmony, current.harmony
    if not old or not new or old.secondary_target or new.secondary_target:
        return None
    if current.pitches[3].spelling != new.expected_bass or previous.pitches[3].spelling != old.expected_bass:
        return None
    if _tonic(new, key) and not new.is_cadential_64:
        if _primary_dominant(old):
            return "PAC" if old.inversion == new.inversion == 0 and current.pitches[0].spelling == new.root else "IAC"
        if old.degree == 7 and old.function == "D":
            return "IAC"
        if old.degree == 4:
            return "PC"
    if (_primary_dominant(new) and new.inversion == 0 and not new.is_seventh
            and (old.function in ("T", "PD") or old.is_cadential_64)):
        return "HC"
    if _primary_dominant(old) and new.degree == 6 and new.inversion == 0 and new.function == "T":
        return "DC"
    return None


@lru_cache(maxsize=256)
def _voice_options(index: int, members: tuple[PitchClass, ...]) -> Voicing:
    low, high = _RANGES[index]
    return tuple(sorted((pitch for spelling in members for octave in range(1, 7)
                        if low <= (pitch := SpelledPitch(*spelling, octave)).midi <= high),
                        key=lambda note: (note.midi, note.spell)))


def _candidates(chord: _Chord, preferred: Voicing | None = None) -> list[Voicing]:
    members = _members(chord)
    if not members:
        return []
    allowed = set(members)
    required = set(_required_members(chord))
    expected_bass = chord.figured.bass.spelling if chord.figured else chord.harmony.expected_bass
    locked = dict(chord.locks)
    options = [(locked[index],) if index in locked else _voice_options(index, members if index < 3 else (expected_bass,))
               for index in range(4)]
    candidates = []
    for voicing in product(*options):
        if voicing[3].spelling != expected_bass:
            continue
        spacing = tuple(upper.midi - lower.midi for upper, lower in zip(voicing, voicing[1:]))
        if any(not 0 <= gap <= limit for gap, limit in zip(spacing, (12, 12, 24))):
            continue
        spellings = {pitch.spelling for pitch in voicing}
        if required <= spellings <= allowed:
            candidates.append(voicing)
    if preferred:
        candidates.sort(key=lambda voicing: (sum(first != second for first, second in zip(preferred, voicing)),
                                             sum(abs(first.midi - second.midi) for first, second in zip(preferred, voicing))))
    return candidates


def _coerce_harmony(harmony: str | RomanNumeralSpec | None, voicing: Voicing,
                    key: Key | None) -> RomanNumeralSpec | None:
    if isinstance(harmony, str):
        if key is None:
            raise ValueError("A key is required with a Roman numeral.")
        return parse_roman_numeral(harmony, key)
    if harmony is None and key is not None:
        return identify_chord(list(voicing), key, voicing[3])["spec"]
    return harmony


def score_transition_voicing(previous: Mapping | Sequence, current: Mapping | Sequence,
                             key: Key | None = None, *,
                             previous_harmony: str | RomanNumeralSpec | None = None,
                             current_harmony: str | RomanNumeralSpec | None = None,
                             following: Mapping | Sequence | None = None) -> int:
    """Return a transition penalty, with two points per error and one per warning."""
    before, after = _voicing(previous), _voicing(current)
    first = _Chord(before, _coerce_harmony(previous_harmony, before, key))
    second = _Chord(after, _coerce_harmony(current_harmony, after, key))
    first, second = _contextualize((first, second))
    next_chord = _Chord(_voicing(following), None) if following is not None else None
    return sum(2 if issue.severity == "error" else 1
               for issue in _transition_issues(first, second, key, 1, next_chord))


def find_clean_voicing(harmony: str | RomanNumeralSpec | FiguredBassSpec, key: Key, *,
                       previous: Mapping | Sequence | None = None, following: Mapping | Sequence | None = None,
                       previous_harmony: str | RomanNumeralSpec | None = None,
                       following_harmony: str | RomanNumeralSpec | None = None,
                       locked_voices: Mapping | Sequence | None = None,
                       preferred: Mapping | Sequence | None = None) -> dict[str, SpelledPitch] | None:
    """Find a clean voicing respecting both neighbors and any locked pitches."""
    reference = _voicing(preferred) if preferred is not None else None
    locks, explicit_locks = _locked(locked_voices, reference) if locked_voices is not None else ({}, set())
    figure = harmony if isinstance(harmony, FiguredBassSpec) else None
    if figure:
        if 3 in explicit_locks and locks[3] != figure.bass:
            raise ValueError("The locked bass must match the given figured bass note.")
        locks[3] = figure.bass
        harmony = figure.roman_numeral
    elif isinstance(harmony, str):
        harmony = parse_roman_numeral(harmony, key)
    target = _Chord(reference or (), harmony, figure, tuple(sorted(locks.items())))
    before = _voicing(previous) if previous is not None else None
    after = _voicing(following) if following is not None else None
    first = _Chord(before, _coerce_harmony(previous_harmony, before, key)) if before else None
    third = _Chord(after, _coerce_harmony(following_harmony, after, key)) if after else None
    for voicing in _candidates(target, reference):
        sequence = tuple(chord for chord in (first, replace(target, pitches=voicing), third) if chord is not None)
        contextual = _contextualize(sequence)
        index = int(first is not None)
        if _chord_issues(contextual[index], key, index):
            continue
        if first and _transition_issues(contextual[0], contextual[1], key, 1, third):
            continue
        if third and _transition_issues(contextual[index], contextual[index + 1], key, index + 1):
            continue
        return dict(zip(VOICES, voicing))
    return None


def _local_issues(chords: tuple[_Chord, ...], key: Key, index: int, replacement: _Chord) -> list[_Issue]:
    def at(position: int) -> _Chord:
        return replacement if position == index else chords[position]

    issues = _chord_issues(replacement, key, index)
    # A new note can also supply the recovery step for a diminished leap into the previous chord.
    for arrival in range(max(1, index - 1), min(len(chords), index + 2)):
        following = at(arrival + 1) if arrival + 1 < len(chords) else None
        issues.extend(_transition_issues(at(arrival - 1), at(arrival), key, arrival, following))
    return issues


def _events(voicings: Sequence[Voicing], voices: tuple[int, ...], first_index: int) -> list[dict]:
    duration = 2 if len(voicings) == 1 else 1.5
    events = []
    for offset, voicing in enumerate(voicings):
        for voice in voices:
            pitch = voicing[voice]
            events.append({"voice": VOICES[voice], "spell": pitch.spell, "display": pitch.display, "midi": pitch.midi,
                           "onset": offset * duration, "duration": duration, "chordIndex": first_index + offset})
    return events


def _serialize_issue(issue: _Issue, chords: tuple[_Chord, ...], fixed: Voicing | None, issue_index: int) -> dict:
    index = issue.chord_index
    current = chords[index].pitches
    previous = chords[issue.previous_chord_index].pitches if issue.previous_chord_index is not None else None
    voicings = (previous, current) if previous else (current,)
    voices = issue.voices
    if previous and len(voices) == 1 and 3 not in voices:
        voices += (3,)
    all_voices = (0, 1, 2, 3)
    first_index = index - int(previous is not None)
    audio = {"isolated_pair": _events(voicings, voices, first_index), "in_context": _events(voicings, all_voices, first_index)}
    if fixed:
        corrected = (previous, fixed) if previous else (fixed,)
        audio["fixed_comparison"] = {
            "label": "Compare a corrected voicing",
            "description": "Hear how a local change to the voicing addresses this issue.",
            "before_events": audio["in_context"], "after_events": _events(corrected, all_voices, first_index),
            "fixed_voices": {voice: pitch.spell for voice, pitch in zip(VOICES, fixed)},
        }
    hints = {
        "voice_crossing": "Move one voice so the voices stay in SATB order.",
        "voice_overlap": "Keep each voice within the space left by its neighbor in the previous chord.",
        "spacing": "Bring the two voices closer together.",
        "doubled_leading_tone": "Double a stable chord member instead of the leading tone.",
        "doubled_secondary_leading_tone": "Double a stable chord member instead of the applied leading tone.",
        "doubled_chordal_seventh": "Use the chordal seventh in just one voice.",
        "doubled_chromatic_pitch": "Replace the extra chromatic note with a stable chord member.",
        "extraneous_pitch": "Replace the marked note with a correctly spelled chord member.",
        "out_of_range": "Bring the marked voice into its standard range.",
        "unequal_fifths": "Change one voice so the diminished fifth does not move to a perfect fifth.",
    }
    suggestion = hints.get(issue.code, issue.message)
    if issue.code.startswith(("parallel_", "contrary_", "direct_")):
        suggestion = "Change the arrival pitch in one voice to avoid the marked perfect interval."
    if fixed:
        changes = [f"{voice} to {pitch.spell}" for voice, pitch, old in zip(VOICES, fixed, current) if pitch != old]
        suggestion = f"Change {', '.join(changes)} in chord {index + 1}."
    return {"id": f"issue-{issue_index}", "rule_id": issue.code, "title": issue.code.replace("_", " ").capitalize(),
            "chords": [issue.previous_chord_index, index] if previous else [index], "suggestion": suggestion,
            "code": issue.code, "category": issue.category, "severity": issue.severity, "message": issue.message,
            "chord_index": index, "previous_chord_index": issue.previous_chord_index,
            "voices": [VOICES[voice] for voice in issue.voices], "audio_demo": audio}


def _fixes(chords: tuple[_Chord, ...], key: Key, issues: list[_Issue]) -> dict[tuple, Voicing]:
    fixes = {}
    targets = {}
    for issue in issues:
        if issue.severity == "error":
            targets.setdefault(issue.chord_index, set()).add(issue.identity)
    for index, wanted in targets.items():
        chord = chords[index]
        original = {issue.identity for issue in _local_issues(chords, key, index, chord)}
        fallback = {}
        for voicing in _candidates(chord, chord.pitches):
            if voicing == chord.pitches:
                continue
            replacement = replace(chord, pitches=voicing)
            remaining = {issue.identity for issue in _local_issues(chords, key, index, replacement)}
            if remaining - original:
                continue
            if not remaining:
                fixes.update(dict.fromkeys(wanted, voicing))
                break
            for resolved in wanted - remaining:
                fallback.setdefault(resolved, voicing)
        else:
            fixes.update(fallback)
    return fixes


def _summary(issues: list[_Issue]) -> dict:
    errors = Counter(issue.category for issue in issues if issue.severity == "error")
    warnings = Counter(issue.category for issue in issues if issue.severity == "warning")
    rubric = [{"name": name, "earned": max(0, 5 - errors[name]), "possible": 5,
               "notes": f"{errors[name]} errors, {warnings[name]} warnings"} for name in _RUBRIC]
    points = sum(row["earned"] for row in rubric)
    score = points * 4
    label = "Excellent" if score >= 90 else "Proficient" if score >= 75 else "Developing" if score >= 60 else "Needs practice"
    return {"score": score, "max_score": 100, "ap_points": points, "ap_max_points": 25, "grade_label": label,
            "error_count": sum(errors.values()), "warning_count": sum(warnings.values()), "rubric": rubric}


def grade_four_part(payload: dict) -> dict:
    """Grade a progression of SATB chords and return JSON-ready feedback.

    Each chord supplies a ``voices`` map or four pitches in S, A, T, B order.
    Roman numeral exercises supply ``roman_numeral`` for each chord. Figured bass
    exercises can supply ``figure`` and ``given_bass``. An omitted figure is 5/3.
    Feedback uses zero-based chord indices and audio timing in beats.
    """
    if not isinstance(payload, Mapping):
        raise ValueError("Provide a four-part exercise object.")
    exercise_type = payload.get("exercise_type")
    if exercise_type not in ("roman_numeral", "figured_bass", "free"):
        raise ValueError("Exercise type must be roman_numeral, figured_bass, or free.")
    key = _key_from_payload(payload)
    rows = payload.get("chords", payload.get("progression"))
    if not isinstance(rows, (list, tuple)) or not rows:
        raise ValueError("Provide a progression containing at least one chord.")
    chords = []
    timings = []
    for index, row in enumerate(rows):
        try:
            if isinstance(row, Mapping):
                onset = row.get("onset", index)
                duration = row.get("duration", 1)
                if isinstance(onset, bool) or not isinstance(onset, (int, float)) or not (onset >= 0) or onset == float("inf"):
                    raise ValueError("Chord onset must be a non-negative finite number.")
                if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not (duration > 0) or duration == float("inf"):
                    raise ValueError("Chord duration must be a positive finite number.")
                timings.append((float(onset) if isinstance(onset, float) else onset,
                                float(duration) if isinstance(duration, float) else duration))
            else:
                timings.append((index, 1))
            if isinstance(row, Mapping) and "locked_voices" not in row and payload.get("locked_voices") is not None:
                row = {**row, "locked_voices": payload["locked_voices"]}
            chords.append(_read_chord(row, exercise_type, key))
        except ValueError as error:
            raise ValueError(f"Chord {index + 1}: {error}") from error
    chords = _contextualize(tuple(chords))

    issues = []
    for index, chord in enumerate(chords):
        issues.extend(_chord_issues(chord, key, index))
        if index:
            following = chords[index + 1] if index + 1 < len(chords) else None
            issues.extend(_transition_issues(chords[index - 1], chord, key, index, following))
    fixes = _fixes(chords, key, issues)
    cadence = _cadence(chords, key)
    cadence_labels = {"PAC": "Perfect Authentic Cadence", "IAC": "Imperfect Authentic Cadence",
                      "HC": "Half Cadence", "DC": "Deceptive Cadence", "PC": "Plagal Cadence"}
    cadence_detail = ({"type": cadence, "label": cadence_labels.get(cadence, cadence), "valid": True,
                       "chord_indices": [len(chords) - 2, len(chords) - 1]} if cadence else None)
    return {"exercise_type": exercise_type, "key": {"tonic": key.tonic, "mode": key.mode, "signature": key.signature},
            "summary": _summary(issues), "cadence": cadence, "cadence_detail": cadence_detail,
            "issues": [_serialize_issue(issue, chords, fixes.get(issue.identity), index)
                       for index, issue in enumerate(issues)],
            "chords": [{"index": index, "onset": timing[0], "duration": timing[1],
                        "voices": {voice: pitch.to_dict() for voice, pitch in zip(VOICES, chord.pitches)},
                        "detected_roman": (detected := identify_chord(list(chord.pitches), key, chord.pitches[3])["roman_numeral"]),
                        "expected_roman": chord.harmony.symbol if chord.harmony and exercise_type != "free" else None,
                        "expected_figure": chord.figured.figure if chord.figured else None,
                        "roman": chord.harmony.symbol if chord.harmony else detected,
                        "roman_numeral": chord.harmony.symbol if chord.harmony else None,
                        "is_cadential_64": bool(chord.harmony and chord.harmony.is_cadential_64),
                        "figured_bass": chord.figured.figure if chord.figured else None}
                       for index, (timing, chord) in enumerate(zip(timings, chords))]}

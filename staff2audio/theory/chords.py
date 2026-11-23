"""Roman numerals and figured bass with exact enharmonic spelling."""

from dataclasses import dataclass, replace
from functools import lru_cache
import re

from staff2audio.music import LETTERS, NATURAL_SEMITONES, key_accidentals
from staff2audio.theory.pitch import Key, PitchClass, SpelledPitch, transpose_pitch


_DEGREES = ("I", "II", "III", "IV", "V", "VI", "VII")
_INVERSIONS = {"": (0, False), "6": (1, False), "64": (2, False), "7": (0, True),
               "65": (1, True), "43": (2, True), "42": (3, True), "2": (3, True)}
_SUFFIXES = {False: ("", "6", "6/4"), True: ("7", "6/5", "4/3", "4/2")}
_TRIAD_INTERVALS = {"major": (4, 7), "minor": (3, 7), "diminished": (3, 6), "augmented": (4, 8)}
_ROLES = ("root", "third", "fifth", "seventh")
_ACCIDENTALS = {"b": -1, "bb": -2, "#": 1, "##": 2, "n": 0}
_TRANSLATION = str.maketrans({"♯": "#", "♭": "b", "♮": "n", "𝄪": "##", "𝄫": "bb",
                              "º": "°", "Ø": "ø", "%": "ø", "−": "-"})
_ROMAN_PATTERN = r"([b#]?)(VII|III|VI|IV|II|V|I|vii|iii|vi|iv|ii|v|i)(°ø|°|ø|o|\+|dim|aug)?"


@dataclass(frozen=True)
class TendencyTone:
    pitch: PitchClass
    direction: int
    kind: str
    target: PitchClass | None = None


@dataclass(frozen=True)
class RomanNumeralSpec:
    symbol: str
    degree: int
    root: PitchClass
    third: PitchClass
    fifth: PitchClass
    seventh: PitchClass | None
    quality: str
    inversion: int
    function: str
    tendency_tones: tuple[TendencyTone, ...]
    secondary_target: str | None = None
    is_cadential_64: bool = False

    @property
    def chord_members(self) -> tuple[PitchClass, ...]:
        triad = self.root, self.third, self.fifth
        return triad + (self.seventh,) if self.seventh else triad

    @property
    def expected_bass(self) -> PitchClass:
        return self.chord_members[self.inversion]

    @property
    def is_seventh(self) -> bool:
        return self.seventh is not None


def _pitch_class_at(pitch: PitchClass, diatonic_steps: int, semitones: int) -> PitchClass:
    return transpose_pitch(SpelledPitch(*pitch, 4), diatonic_steps, semitones).spelling


def _semitone(pitch: PitchClass) -> int:
    letter, alteration = pitch
    return NATURAL_SEMITONES[LETTERS.index(letter)] + alteration


def _degree_pitch(key: Key, degree: int, accidental: str = "") -> PitchClass:
    letter, alteration = key.scale_pitches[degree - 1]
    return letter, alteration + _ACCIDENTALS.get(accidental, 0)


def parse_roman_numeral(symbol: str, key: Key) -> RomanNumeralSpec:
    """Parse one harmony. A plain tonic 6/4 needs its successor to establish cadential function."""
    if not isinstance(symbol, str):
        raise ValueError("Roman numeral must be text, such as V6/5/V.")
    return _parse_roman_numeral(symbol, key)


@lru_cache(maxsize=2048)
def _parse_roman_numeral(symbol: str, key: Key) -> RomanNumeralSpec:
    raw = "".join(symbol.translate(_TRANSLATION).split())
    if raw.lower() in ("cad64", "cad6/4"):
        tonic = "I6/4" if key.mode == "major" else "i6/4"
        return replace(parse_roman_numeral(tonic, key), symbol="Cad6/4", is_cadential_64=True, function="D")
    if raw in ("N", "N6"):
        return replace(parse_roman_numeral("bII6", key), symbol="N6")

    raw = raw.replace("°/7", "ø7")
    match = re.fullmatch(_ROMAN_PATTERN + r"(6/?[45]|4/?[23]|[267])?(?:/([b#]?[IViv]+))?", raw)
    if match is None:
        raise ValueError(f"Invalid Roman numeral {symbol!r}. Use a symbol such as iiø6/5 or V7/V.")
    accidental, numeral, modifier, figures, secondary = match.groups()
    figures = (figures or "").replace("/", "")
    secondary_match = re.fullmatch(_ROMAN_PATTERN, secondary) if secondary else None
    if figures not in _INVERSIONS or (secondary and secondary_match is None):
        raise ValueError(f"Invalid inversion or secondary target in {symbol!r}.")
    # Accept °ø as a redundant half-diminished symbol.
    if modifier == "°ø":
        modifier = "ø"
    modifier = {"o": "°", "dim": "°", "aug": "+"}.get(modifier, modifier or "")
    inversion, is_seventh = _INVERSIONS[figures]
    degree = _DEGREES.index(numeral.upper()) + 1
    if secondary and (degree not in (5, 7) or accidental):
        raise ValueError(f"A secondary chord must be a dominant or leading-tone chord in {symbol!r}.")
    if modifier == "ø" and not is_seventh:
        raise ValueError(f"A half-diminished chord must include a seventh in {symbol!r}.")

    target = key.scale_pitches[0]
    target_mode = key.mode
    if secondary_match:
        target_accidental, target_numeral, _ = secondary_match.groups()
        target = _degree_pitch(key, _DEGREES.index(target_numeral.upper()) + 1, target_accidental)
        target_mode = "major" if target_numeral.isupper() else "minor"
    leading_tone = _pitch_class_at(target, -1, -1)
    root = _degree_pitch(key, degree, accidental)
    diminished = modifier in ("°", "ø")
    if degree == 7 and diminished and not accidental:
        root = leading_tone
    elif secondary_match and degree == 5:
        root = _pitch_class_at(target, 4, 7)
    elif secondary_match:
        root = _pitch_class_at(target, -1, -1 if target_mode == "major" else -2)

    triad_quality = {"°": "diminished", "ø": "diminished", "+": "augmented"}.get(modifier)
    if triad_quality is None:
        triad_quality = "major" if numeral.isupper() else "minor"
    third_interval, fifth_interval = _TRIAD_INTERVALS[triad_quality]
    third = _pitch_class_at(root, 2, third_interval)
    fifth = _pitch_class_at(root, 4, fifth_interval)
    seventh = None
    quality = triad_quality
    if is_seventh:
        if diminished:
            seventh_interval = 10 if modifier == "ø" else 9
            quality = "half_diminished_seventh" if modifier == "ø" else "diminished_seventh"
        else:
            natural_seventh = key.scale_pitches[(degree + 5) % 7]
            seventh_interval = (_semitone(natural_seventh) - _semitone(root)) % 12
            if degree == 5 and triad_quality == "major" and not accidental:
                seventh_interval = 10
            elif key.mode == "major" and numeral in ("i", "iv"):
                seventh_interval = 10
            elif accidental or seventh_interval not in (10, 11):
                seventh_interval = 11 if triad_quality in ("major", "augmented") else 10
            quality = {
                ("major", 10): "dominant_seventh", ("major", 11): "major_seventh",
                ("minor", 10): "minor_seventh", ("minor", 11): "minor_major_seventh",
                ("augmented", 10): "augmented_seventh", ("augmented", 11): "augmented_major_seventh",
            }[triad_quality, seventh_interval]
        seventh = _pitch_class_at(root, 6, seventh_interval)

    dominant = not accidental and (degree == 5 or (degree == 7 and diminished))
    function = "D" if dominant else "PD" if degree in (2, 4) else "T"
    tendencies = []
    if dominant and leading_tone in (root, third, fifth):
        tendencies.append(TendencyTone(leading_tone, 1, "leading_tone", target))
    if seventh:
        tendencies.append(TendencyTone(seventh, -1, "chordal_seventh"))
    normalized = accidental + numeral + modifier + _SUFFIXES[is_seventh][inversion]
    if secondary:
        normalized += "/" + secondary
    return RomanNumeralSpec(normalized, degree, root, third, fifth, seventh, quality, inversion,
                            function, tuple(tendencies), secondary)


def with_cadential_context(spec: RomanNumeralSpec, following: RomanNumeralSpec | None) -> RomanNumeralSpec:
    if (spec.degree == 1 and spec.inversion == 2 and not spec.is_seventh and not spec.secondary_target
            and following and following.degree == 5 and following.function == "D"
            and not following.secondary_target and following.inversion == 0
            and following.quality in ("major", "dominant_seventh")
            and spec.expected_bass == following.expected_bass):
        return replace(spec, is_cadential_64=True, function="D")
    return spec


@lru_cache(maxsize=30)
def _roman_candidates(key: Key) -> tuple[RomanNumeralSpec, ...]:
    if key.mode == "major":
        triads = ("I", "ii", "iii", "IV", "V", "vi", "vii°", "N6", "iv", "ii°", "bVI", "bIII", "v")
        sevenths = ("I", "ii", "iii", "IV", "V", "vi", "viiø", "vii°", "iv", "iiø", "bVI", "bIII", "v")
        targets = ("ii", "iii", "IV", "V", "vi", "iv", "VI", "III", "VII")
    else:
        triads = ("i", "ii°", "III", "iv", "V", "VI", "vii°", "v", "VII", "III+", "N6", "I", "IV", "ii")
        sevenths = ("i", "iiø", "III", "iv", "V", "VI", "vii°", "v", "VII", "III+", "I", "ii", "ii°", "viiø")
        targets = ("III", "iv", "V", "VI", "VII", "ii", "iii", "IV", "vi")
    candidates = [(root, "") for root in triads] + [(root, "7") for root in sevenths]
    result = []
    for root, suffix in candidates:
        result.append(parse_roman_numeral(root + suffix, key))
    for target in targets:
        for harmony in ("V", "V7", "vii°", "vii°7", "viiø7"):
            try:
                result.append(parse_roman_numeral(f"{harmony}/{target}", key))
            except ValueError:
                # Some applied chords in extreme signatures require triple accidentals.
                continue
    return tuple(result)


def _best_match(pitches: set[PitchClass], key: Key, bass: PitchClass,
                is_seventh: bool | None = None) -> tuple[RomanNumeralSpec | None, tuple[PitchClass, ...]]:
    choices = []
    for index, candidate in enumerate(_roman_candidates(key)):
        members = candidate.chord_members
        if bass not in members or (is_seventh is not None and candidate.is_seventh != is_seventh):
            continue
        inversion = members.index(bass)
        if candidate.symbol == "N6" and inversion != 1:
            continue
        missing = tuple(pitch for pitch in members if pitch not in pitches)
        extraneous = len(pitches.difference(members))
        missing_essential = len(missing) - (inversion == 0 and candidate.quality != "diminished"
                                            and candidate.fifth in missing)
        rank = (extraneous + missing_essential, extraneous, len(missing), index)
        if extraneous + missing_essential <= 1 and len(pitches.intersection(members)) >= 2:
            choices.append((rank, candidate, inversion, missing))
    if not choices:
        return None, ()
    _, candidate, inversion, missing = min(choices, key=lambda choice: choice[0])
    symbol = candidate.symbol
    if symbol != "N6":
        head, delimiter, target = symbol.partition("/")
        symbol = head.removesuffix("7") + _SUFFIXES[candidate.is_seventh][inversion] + delimiter + target
    return replace(candidate, symbol=symbol, inversion=inversion), missing


def identify_chord(pitches: list[SpelledPitch], key: Key, bass: SpelledPitch | None = None) -> dict:
    """Classify a sonority by spelling and return the role of each supplied pitch."""
    if not pitches:
        raise ValueError("At least one pitch is required to identify a chord.")
    bass = bass if bass is not None else min(pitches, key=lambda pitch: pitch.midi)
    spellings = {pitch.spelling for pitch in pitches} | {bass.spelling}
    spec, missing = _best_match(spellings, key, bass.spelling)
    members = spec.chord_members if spec else ()
    roles = {pitch: role for pitch, role in zip(members, _ROLES)}
    extraneous = sorted(spellings.difference(members))
    return {"roman_numeral": spec.symbol if spec else None, "root": spec.root if spec else None,
            "quality": spec.quality if spec else None, "inversion": spec.inversion if spec else None,
            "complete": bool(spec and not missing and not extraneous), "missing_members": missing,
            "extraneous_pitches": extraneous, "chord_members": members,
            "member_roles": [roles.get(pitch.spelling) for pitch in pitches], "spec": spec}


@dataclass(frozen=True)
class FiguredBassSpec:
    figure: str
    bass: SpelledPitch
    intervals: tuple[tuple[int, PitchClass], ...]
    roman_numeral: RomanNumeralSpec | None
    inversion: int
    is_seventh: bool
    explicit_intervals: tuple[int, ...] = ()

    @property
    def required_pitches(self) -> tuple[PitchClass, ...]:
        return tuple(pitch for _, pitch in self.intervals)

    @property
    def chord_members(self) -> tuple[PitchClass, ...]:
        if self.roman_numeral:
            return self.roman_numeral.chord_members
        return (self.bass.spelling,) + self.required_pitches

    @property
    def is_cadential_64(self) -> bool:
        return bool(self.roman_numeral and self.roman_numeral.is_cadential_64)

    @property
    def tendency_tones(self) -> tuple[TendencyTone, ...]:
        return self.roman_numeral.tendency_tones if self.roman_numeral else ()


_FIGURED_PATTERNS = {
    (): (0, (3, 5)), (3,): (0, (3, 5)), (5,): (0, (3, 5)), (3, 5): (0, (3, 5)),
    (6,): (1, (3, 6)), (3, 6): (1, (3, 6)), (4, 6): (2, (4, 6)),
    (7,): (0, (3, 5, 7)), (3, 7): (0, (3, 5, 7)), (5, 7): (0, (3, 5, 7)),
    (3, 5, 7): (0, (3, 5, 7)), (5, 6): (1, (3, 5, 6)), (3, 5, 6): (1, (3, 5, 6)),
    (3, 4): (2, (3, 4, 6)), (3, 4, 6): (2, (3, 4, 6)),
    (2,): (3, (2, 4, 6)), (2, 4): (3, (2, 4, 6)), (2, 4, 6): (3, (2, 4, 6)),
}
_FIGURE_TOKEN = re.compile(r"(?:(bb|##|[bn#])?([2-7])((?:bb|##|[bn#+])(?![2-7]))?|(bb|##|[bn#]))")


def parse_figured_bass(figure: str, bass: SpelledPitch, key: Key) -> FiguredBassSpec:
    """Realize figures against the key signature, then identify the spelled chord if possible."""
    if not isinstance(figure, str):
        raise ValueError("Figured bass must be text, such as 6/5 or 7/#.")
    raw = figure.translate(_TRANSLATION).strip()
    if re.search(r"/\s*/", raw):
        raise ValueError(f"Invalid figured bass {figure!r}.")
    if raw.lower() in ("cad64", "cad6/4"):
        spec = parse_roman_numeral(raw, key)
        if bass.spelling != spec.expected_bass:
            raise ValueError("The bass of a cadential 6/4 must be scale degree 5.")
        return FiguredBassSpec(figure, bass, ((4, spec.root), (6, spec.third)), spec, 2, False)
    raw = re.sub(r"([2-7])/$", r"\1+", raw)
    adjustments = {}
    numbered = set()
    for token in re.split(r"[/,\s]+", raw) if raw else ():
        if not token:
            raise ValueError(f"Invalid figured bass {figure!r}.")
        cursor = 0
        while cursor < len(token):
            match = _FIGURE_TOKEN.match(token, cursor)
            if match is None:
                raise ValueError(f"Invalid figured bass {figure!r} near {token[cursor:]!r}.")
            prefix, number, suffix, standalone = match.groups()
            size = int(number) if number else 3
            if (prefix and suffix) or size in adjustments:
                raise ValueError(f"Repeated interval {size} in figured bass {figure!r}.")
            if number:
                numbered.add(size)
            adjustments[size] = standalone or prefix or suffix
            cursor = match.end()

    pattern = _FIGURED_PATTERNS.get(tuple(sorted(numbered)))
    if not pattern or adjustments.keys() - set(pattern[1]):
        raise ValueError(f"Unsupported figured bass inversion {figure!r}.")
    inversion, sizes = pattern
    signature = key_accidentals(key.signature)
    intervals = []
    for size in sizes:
        letter = LETTERS[(LETTERS.index(bass.letter) + size - 1) % 7]
        alteration = signature.get(letter, 0)
        accidental = adjustments.get(size)
        if accidental:
            alteration = alteration + 1 if accidental == "+" else _ACCIDENTALS[accidental]
        intervals.append((size, (letter, alteration)))
    spellings = {pitch for _, pitch in intervals} | {bass.spelling}
    is_seventh = len(sizes) == 3
    spec, missing = _best_match(spellings, key, bass.spelling, is_seventh)
    if spec and (missing or spellings != set(spec.chord_members) or spec.inversion != inversion):
        spec = None
    return FiguredBassSpec(figure, bass, tuple(intervals), spec, inversion, is_seventh, tuple(sorted(adjustments)))

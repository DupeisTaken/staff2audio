"""Spelled pitches, key signatures, and directed diatonic intervals."""

from dataclasses import dataclass
import re

from staff2audio.music import LETTERS, NATURAL_SEMITONES, key_accidentals, midi_pitch, pitch_name


PitchClass = tuple[str, int]
_ASCII_ACCIDENTALS = {-2: "bb", -1: "b", 0: "", 1: "#", 2: "##"}
_ALTERATIONS = {symbol: value for value, symbol in _ASCII_ACCIDENTALS.items()}
_ALTERATIONS.update({"♭": -1, "♭♭": -2, "𝄫": -2, "♮": 0, "♯": 1, "♯♯": 2, "𝄪": 2})
_PITCH_PATTERN = r"([A-Ga-g])(bb|##|♭♭|♯♯|[b#♭♯♮𝄫𝄪]?)(-?[0-9]+)"
_KEY_TONICS = {
    "major": ("Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"),
    "minor": ("Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#"),
}


@dataclass(frozen=True)
class SpelledPitch:
    letter: str
    alteration: int
    octave: int

    def __post_init__(self) -> None:
        if self.letter not in tuple(LETTERS):
            raise ValueError("Pitch letter must be A through G.")
        if type(self.alteration) is not int or self.alteration not in _ASCII_ACCIDENTALS:
            raise ValueError("Pitch alteration must be between a double flat and a double sharp.")
        if type(self.octave) is not int or not 0 <= self.midi <= 127:
            raise ValueError("Pitch must be within the MIDI range 0 to 127.")

    @property
    def midi(self) -> int:
        return midi_pitch(self.letter, self.octave, self.alteration)

    @property
    def diatonic_number(self) -> int:
        return self.octave * 7 + LETTERS.index(self.letter)

    @property
    def pitch_class(self) -> int:
        return self.midi % 12

    @property
    def spelling(self) -> PitchClass:
        return self.letter, self.alteration

    @property
    def spell(self) -> str:
        return f"{self.letter}{_ASCII_ACCIDENTALS[self.alteration]}{self.octave}"

    @property
    def display(self) -> str:
        return pitch_name(self.letter, self.octave, self.alteration)

    def to_dict(self) -> dict:
        return {"spell": self.spell, "display": self.display, "letter": self.letter,
                "alteration": self.alteration, "octave": self.octave, "midi": self.midi}


def parse_pitch(text: str) -> SpelledPitch:
    match = re.fullmatch(_PITCH_PATTERN, text.strip()) if isinstance(text, str) else None
    if match is None:
        raise ValueError(f"Invalid pitch {text!r}. Use a letter, optional accidental, and octave, such as F#4.")
    letter, accidental, octave = match.groups()
    return SpelledPitch(letter.upper(), _ALTERATIONS[accidental], int(octave))


@dataclass(frozen=True)
class Interval:
    diatonic_steps: int
    semitones: int

    @property
    def generic_size(self) -> int:
        return abs(self.diatonic_steps) + 1

    @property
    def simple_size(self) -> int:
        steps = abs(self.diatonic_steps)
        return (steps - 1) % 7 + 2 if steps else 1

    @property
    def quality(self) -> str:
        steps = abs(self.diatonic_steps)
        octaves, degree = divmod(steps, 7)
        expected = octaves * 12 + NATURAL_SEMITONES[degree]
        if self.diatonic_steps:
            actual = self.semitones if self.diatonic_steps > 0 else -self.semitones
        else:
            actual = abs(self.semitones)
        difference = actual - expected
        if degree in (0, 3, 4):
            return "A" * difference if difference > 0 else "d" * -difference or "P"
        if difference > 0:
            return "A" * difference
        if difference < -1:
            return "d" * (-difference - 1)
        return "m" if difference == -1 else "M"

    @property
    def name(self) -> str:
        return f"{self.quality}{self.generic_size}"

    @property
    def simple_name(self) -> str:
        return f"{self.quality}{self.simple_size}"

    @property
    def is_compound(self) -> bool:
        return self.generic_size > 8

    @property
    def direction(self) -> int:
        movement = self.diatonic_steps or self.semitones
        return (movement > 0) - (movement < 0)


def interval_between(p1: SpelledPitch, p2: SpelledPitch) -> Interval:
    return Interval(p2.diatonic_number - p1.diatonic_number, p2.midi - p1.midi)


def transpose_pitch(p: SpelledPitch, diatonic_steps: int, semitones: int) -> SpelledPitch:
    octave, index = divmod(p.diatonic_number + diatonic_steps, 7)
    letter = LETTERS[index]
    return SpelledPitch(letter, p.midi + semitones - midi_pitch(letter, octave), octave)


@dataclass(frozen=True)
class Key:
    tonic: str
    mode: str

    def __post_init__(self) -> None:
        if not isinstance(self.mode, str) or self.mode.lower().strip() not in _KEY_TONICS:
            raise ValueError("Key mode must be major or minor.")
        mode = self.mode.lower().strip()
        if not isinstance(self.tonic, str):
            raise ValueError("Key tonic must be a note name, such as Bb.")
        pitch = parse_pitch(self.tonic.strip() + "4")
        tonic = pitch.letter + _ASCII_ACCIDENTALS[pitch.alteration]
        if tonic not in _KEY_TONICS[mode]:
            raise ValueError(f"{tonic} {mode} is outside the supported key signatures.")
        object.__setattr__(self, "tonic", tonic)
        object.__setattr__(self, "mode", mode)

    @classmethod
    def from_tonic_mode(cls, tonic: str, mode: str) -> "Key":
        return cls(tonic, mode)

    @classmethod
    def from_signature(cls, signature: int, mode: str) -> "Key":
        if type(signature) is not int or not -7 <= signature <= 7:
            raise ValueError("Key signature must contain between seven flats and seven sharps.")
        if not isinstance(mode, str) or mode.lower().strip() not in _KEY_TONICS:
            raise ValueError("Key mode must be major or minor.")
        mode = mode.lower().strip()
        return cls(_KEY_TONICS[mode][signature + 7], mode)

    @property
    def signature(self) -> int:
        return _KEY_TONICS[self.mode].index(self.tonic) - 7

    @property
    def scale_letters(self) -> tuple[str, ...]:
        index = LETTERS.index(self.tonic[0])
        return tuple(LETTERS[index:] + LETTERS[:index])

    @property
    def scale_pitches(self) -> tuple[PitchClass, ...]:
        alterations = key_accidentals(self.signature)
        return tuple((letter, alterations.get(letter, 0)) for letter in self.scale_letters)

    @property
    def leading_tone(self) -> PitchClass:
        letter, alteration = self.scale_pitches[-1]
        return letter, alteration + (self.mode == "minor")

    def degree_of(self, pitch: SpelledPitch) -> tuple[int, int]:
        index = self.scale_letters.index(pitch.letter)
        return index + 1, pitch.alteration - self.scale_pitches[index][1]


def spell_midi_in_key(midi: int, key: Key) -> SpelledPitch:
    if type(midi) is not int or not 0 <= midi <= 127:
        raise ValueError("MIDI pitch must be an integer between 0 and 127.")
    octave = midi // 12 - 1
    scale = key.scale_pitches
    candidates = []
    for letter, scale_alteration in scale:
        for written_octave in (octave - 1, octave, octave + 1):
            alteration = midi - midi_pitch(letter, written_octave)
            if -2 <= alteration <= 2:
                pitch = SpelledPitch(letter, alteration, written_octave)
                rank = (pitch.spelling not in scale, pitch.spelling != key.leading_tone,
                        abs(alteration - scale_alteration), abs(alteration),
                        alteration > 0 if key.signature < 0 else alteration < 0)
                candidates.append((rank, pitch))
    return min(candidates, key=lambda candidate: candidate[0])[1]

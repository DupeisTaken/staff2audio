"""Small, explicit notation helpers shared by the recognizer and callers."""

LETTERS = "CDEFGAB"
NATURAL_SEMITONES = (0, 2, 4, 5, 7, 9, 11)
KEY_NAMES = {
    -7: "C♭ major / A♭ minor", -6: "G♭ major / E♭ minor",
    -5: "D♭ major / B♭ minor", -4: "A♭ major / F minor",
    -3: "E♭ major / C minor", -2: "B♭ major / G minor",
    -1: "F major / D minor", 0: "C major / A minor",
    1: "G major / E minor", 2: "D major / B minor",
    3: "A major / F♯ minor", 4: "E major / C♯ minor",
    5: "B major / G♯ minor", 6: "F♯ major / D♯ minor",
    7: "C♯ major / A♯ minor",
}


def key_accidentals(signature: int) -> dict[str, int]:
    """Return alterations of letter names; tonal mode is not inferred."""
    if not -7 <= signature <= 7:
        raise ValueError("Key signature must contain between seven flats and seven sharps.")
    order = "FCGDAEB" if signature >= 0 else "BEADGCF"
    return {letter: (1 if signature > 0 else -1) for letter in order[:abs(signature)]}


def staff_pitch(step: int, clef: str) -> tuple[str, int]:
    """Diatonic step 0 is the bottom line; each space/line adds one step."""
    base = 4 * 7 + 2 if clef == "treble" else 2 * 7 + 4  # E4 / G2
    octave, index = divmod(base + step, 7)
    return LETTERS[index], octave


def midi_pitch(letter: str, octave: int, alteration: int = 0) -> int:
    return 12 * (octave + 1) + NATURAL_SEMITONES[LETTERS.index(letter)] + alteration


def pitch_name(letter: str, octave: int, alteration: int = 0) -> str:
    return letter + {-2: "𝄫", -1: "♭", 0: "", 1: "♯", 2: "𝄪"}[alteration] + str(octave)

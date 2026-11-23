"""Curated four-part and two-phrase exercises for the theory workspace."""

from copy import deepcopy

from staff2audio.theory.pitch import Key


def _four_part(identifier, key, exercise_type, title, instructions, solution, *, figures=None,
               mistakes=(), sample_description=None):
    voices = ("S", "A", "T", "B")
    locks = ["B"] if exercise_type == "figured_bass" else []
    metadata = {"key_tonic": key.tonic, "mode": key.mode, "key_signature": key.signature,
                "time_signature": "4/4", "exercise_type": exercise_type, "locked_voices": locks}
    chords = []
    for index, (roman, notes) in enumerate(solution):
        pitches = dict(zip(voices, notes.split()))
        chord = {"onset": index, "duration": 1, "roman": roman, "voices": pitches,
                 "figure": figures[index] if figures else ""}
        if figures:
            chord["given_bass"] = pitches["B"]
        chords.append(chord)
    starter = deepcopy(chords)
    if exercise_type != "free":
        upper_template = {voice: chords[0]["voices"][voice] for voice in voices[:3]}
        for chord in starter:
            chord["voices"].update(upper_template)
    attempt = None
    if mistakes:
        attempt = deepcopy(chords)
        for index, voice, pitch in mistakes:
            attempt[index]["voices"][voice] = pitch
        attempt = {**metadata, "chords": attempt, "description": sample_description}
    return {
        **metadata, "id": identifier, "title": title, "instructions": instructions,
        "subtitle": {"figured_bass": "FRQ 5 · Figured Bass", "roman_numeral": "FRQ 6 · Roman Numerals",
                     "free": "Free SATB Sandbox"}[exercise_type],
        "starter": {**metadata, "chords": starter}, "sample_attempt": attempt,
        "model_solution": {**metadata, "chords": chords},
    }


def _melody(identifier, key, meter, instructions, notes, solution, *, mistakes, sample_description):
    beats_per_measure = int(meter.split("/")[0])
    melody = []
    onset = 0
    for token in notes.split():
        pitch, _, length = token.partition(":")
        duration = float(length) if length else 1
        melody.append({"onset": onset, "duration": duration, "pitch": pitch})
        onset += duration
    phrases = [
        {"name": "Phrase 1", "start_onset": 0, "end_onset": 2 * beats_per_measure - 1, "expected_cadence": "HC"},
        {"name": "Phrase 2", "start_onset": 2 * beats_per_measure,
         "end_onset": 4 * beats_per_measure - 1, "expected_cadence": "PAC"},
    ]
    harmonization = []
    onset = 0
    for roman, bass, duration in solution:
        harmonization.append({"onset": onset, "duration": duration, "roman": roman, "bass": bass})
        onset += duration
    first = harmonization[0]
    starter = [dict(row, roman=first["roman"], bass=first["bass"]) for row in harmonization]
    attempt = deepcopy(harmonization)
    for index, roman, bass in mistakes:
        attempt[index].update(roman=roman, bass=bass)
    metadata = {"key_tonic": key.tonic, "mode": key.mode, "key_signature": key.signature,
                "time_signature": meter, "melody": melody, "phrases": phrases}
    return {
        **metadata, "id": identifier, "title": f"{key.tonic} {key.mode.title()} · Two-Phrase Melody",
        "subtitle": "FRQ 7 · Harmonize a Melody", "instructions": instructions,
        "starter": {**metadata, "harmonization": starter},
        "sample_attempt": {**metadata, "harmonization": attempt, "description": sample_description},
        "model_solution": {**metadata, "harmonization": harmonization},
    }


def get_exercise_catalog() -> dict:
    """Return fresh, JSON-ready exercises with independent starter and solution voicings."""
    return {
        "four_part": [
            _four_part(
                "fb-c-major-cad64", Key("C", "major"), "figured_bass", "C Major · Cadential Six-Four",
                "Realize the figures over the given bass. Resolve 6–5 and 4–3 over the dominant bass.",
                [("I", "C5 E4 G3 C3"), ("vi", "C5 E4 A3 A2"), ("ii6", "D5 F4 A3 F2"),
                 ("Cad6/4", "C5 E4 G3 G2"), ("V7", "B4 D4 F3 G2"), ("I", "C5 E4 E3 C3")],
                figures=("", "", "6", "6/4", "7", ""),
                mistakes=((5, "T", "F3"),),
                sample_description="The dominant seventh is held into the last chord",
            ),
            _four_part(
                "fb-a-minor-harmonic", Key("A", "minor"), "figured_bass", "A Minor · Raised Leading Tone",
                "Follow the figured bass closely. The last dominant requires a raised third above E.",
                [("i", "A4 E4 C4 A2"), ("iv", "A4 F4 D4 D3"), ("V6/5", "B4 E4 D4 G#2"),
                 ("i", "C5 E4 C4 A2"), ("ii°6", "B4 F4 D4 D3"), ("Cad6/4", "A4 E4 C4 E3"),
                 ("V7", "G#4 D4 B3 E3"), ("i", "A4 C4 C4 A2")],
                figures=("", "", "6/5", "", "6", "6/4", "7/#", ""),
                mistakes=((6, "S", "G4"),),
                sample_description="The soprano forgets to raise the leading tone over the final dominant",
            ),
            _four_part(
                "rn-f-major-diatonic", Key("F", "major"), "roman_numeral", "F Major · Tonic Pedal",
                "Realize the Roman numerals. Keep the bass on F through the opening pedal six-four.",
                [("I", "F4 C4 A3 F3"), ("IV6/4", "F4 D4 Bb3 F3"), ("I", "F4 C4 A3 F3"),
                 ("vi", "F4 D4 A3 D3"), ("ii6", "G4 D4 Bb3 Bb2"), ("V7", "G4 E4 Bb3 C3"),
                 ("I", "F4 F4 A3 F2")],
                mistakes=((1, "S", "Bb4"), (5, "A", "C4")),
                sample_description="The pedal six-four loses its doubled bass and V7 omits its third",
            ),
            _four_part(
                "rn-d-major-sec-dom", Key("D", "major"), "roman_numeral", "D Major · Applied Dominant",
                "Resolve the applied leading tone into V, then write the deceptive motion into vi.",
                [("I", "D5 F#4 A3 D3"), ("IV6", "D5 G4 B3 B2"), ("V6/5/V", "D5 E4 B3 G#2"),
                 ("V", "C#5 E4 A3 A2"), ("vi", "D5 D4 F#3 B2"), ("ii6", "B4 E4 G3 G2"),
                 ("V7", "C#5 E4 G3 A2"), ("I", "D5 D4 F#3 D3")],
                mistakes=((3, "A", "C#4"),),
                sample_description="The student doubles the dominant leading tone in the soprano and alto",
            ),
            _four_part(
                "free-g-major-sandbox", Key("G", "major"), "free", "G Major · Free SATB Sandbox",
                "Edit all four voices on the staff and grade your own chorale.",
                [("I", "G4 D4 B3 G2"), ("IV", "G4 E4 C4 C3"), ("V", "F#4 D4 A3 D3"), ("I", "G4 D4 B3 G2")],
            ),
        ],
        "melody": [
            _melody(
                "mel-c-major-two-phrase", Key("C", "major"), "4/4",
                "Write a half cadence and then a perfect authentic cadence. Check the eighth-note passing and neighbor tones.",
                "E5:.5 F5:.5 G5 E5:.5 F5:.5 E5 A4 G4:.5 F4:.5 B4 D5 E5 G5 A4 F5 C5 C5 B4 C5",
                [("I", "C3", 2), ("I6", "E3", 2), ("ii6", "F3", 2), ("V", "G3", 2), ("I", "C3", 2),
                 ("IV", "F3", 2), ("Cad6/4", "G3", 2), ("V7", "G3", 1), ("I", "C4", 1)],
                mistakes=((8, "I6", "E3"), (5, "IV", "A3")),
                sample_description="The predominant has the wrong inversion and the final tonic is inverted",
            ),
            _melody(
                "mel-g-major-triple", Key("G", "major"), "3/4",
                "Group the harmonies in three, ending the first phrase on V and the second on I.",
                "B4 D5 B4 A4 C5 A4 B4 D5 G4 B4 A4 G4",
                [("I", "G2", 3), ("ii6", "C3", 2), ("V", "D3", 1), ("I", "G2", 2), ("IV", "C3", 1),
                 ("Cad6/4", "D3", 1), ("V7", "D3", 1), ("I", "G2", 1)],
                mistakes=((1, "ii6", "A2"), (7, "vi", "E3")),
                sample_description="The bass contradicts ii6 and the final dominant moves deceptively",
            ),
            _melody(
                "mel-e-minor-two-phrase", Key("E", "minor"), "4/4",
                "Use the raised D-sharp to support the half cadence and the final authentic cadence.",
                "G4 B4 E5 B4 C5 A4 D#5 F#5 G5 E5 C5 A4 E5 E5 D#5 E5",
                [("i", "E3", 2), ("i6", "G3", 2), ("ii°6", "A3", 2), ("V", "B3", 2), ("i", "E3", 2),
                 ("iv", "A2", 2), ("Cad6/4", "B2", 2), ("V7", "B2", 1), ("i", "E3", 1)],
                mistakes=((3, "v", "B3"), (8, "i6", "G3")),
                sample_description="The first dominant is minor and the final tonic is inverted",
            ),
        ],
    }

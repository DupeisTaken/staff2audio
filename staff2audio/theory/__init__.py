"""AP Music Theory pitch, harmony, and four-part writing tools."""

from staff2audio.theory.chords import FiguredBassSpec, RomanNumeralSpec, TendencyTone, identify_chord, parse_figured_bass, parse_roman_numeral
from staff2audio.theory.exercises import get_exercise_catalog
from staff2audio.theory.four_part import find_clean_voicing, grade_four_part, score_transition_voicing
from staff2audio.theory.melody_harmonizer import grade_melody_harmonization, realize_satb, suggest_harmonization
from staff2audio.theory.pitch import Interval, Key, SpelledPitch, interval_between, parse_pitch, spell_midi_in_key, transpose_pitch

__all__ = [
    "FiguredBassSpec", "Interval", "Key", "RomanNumeralSpec", "SpelledPitch", "TendencyTone",
    "find_clean_voicing", "get_exercise_catalog", "grade_four_part", "grade_melody_harmonization",
    "identify_chord", "interval_between", "parse_figured_bass", "parse_pitch", "parse_roman_numeral",
    "realize_satb", "score_transition_voicing", "spell_midi_in_key", "suggest_harmonization", "transpose_pitch",
]

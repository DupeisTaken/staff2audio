import json

import pytest

from staff2audio.theory import (
    Key, find_clean_voicing, grade_four_part, identify_chord, interval_between, parse_figured_bass,
    parse_pitch, parse_roman_numeral, score_transition_voicing, spell_midi_in_key, transpose_pitch,
)


C_MAJOR = Key("C", "major")
A_MINOR = Key("A", "minor")
VOICES = ("S", "A", "T", "B")


def grade(*chords, key="C major"):
    return grade_four_part({"key": key, "exercise_type": "roman_numeral", "chords": [
        {"roman_numeral": symbol, "voices": dict(zip(VOICES, notes.split()))} for symbol, notes in chords
    ]})


def matching(result, code, voices=None):
    return [issue for issue in result["issues"] if issue["code"] == code
            and (voices is None or issue["voices"] == list(voices))]


@pytest.mark.parametrize(("text", "spell", "display", "midi"), [
    ("F#4", "F#4", "F♯4", 66), ("Bb3", "Bb3", "B♭3", 58), ("C4", "C4", "C4", 60),
    ("Abb3", "Abb3", "A𝄫3", 55), ("F##4", "F##4", "F𝄪4", 67), ("F♯4", "F#4", "F♯4", 66),
    ("B♭3", "Bb3", "B♭3", 58), ("F𝄪4", "F##4", "F𝄪4", 67), ("B𝄫3", "Bbb3", "B𝄫3", 57),
    ("F♮4", "F4", "F4", 65), ("B#-2", "B#-2", "B♯-2", 0),
])
def test_spelled_pitch(text, spell, display, midi):
    pitch = parse_pitch(text)
    assert pitch.to_dict() == {"spell": spell, "display": display, "midi": midi, "letter": pitch.letter,
                               "octave": pitch.octave, "alteration": pitch.alteration}
    assert pitch.pitch_class == midi % 12


@pytest.mark.parametrize("bad", ["Q4", "C###4", "G", "B#9", "Cb-1", "E4.5", None])
def test_invalid_pitch(bad):
    with pytest.raises(ValueError, match="pitch|Pitch"):
        parse_pitch(bad)


@pytest.mark.parametrize(("first", "second", "name", "simple", "steps", "semitones", "direction"), [
    ("Ab4", "B4", "A2", "A2", 1, 3, 1), ("F#4", "C5", "d5", "d5", 4, 6, 1),
    ("F4", "B4", "A4", "A4", 3, 6, 1), ("C6", "G4", "P11", "P4", -10, -17, -1),
    ("C3", "C5", "P15", "P8", 14, 24, 1), ("D4", "D4", "P1", "P1", 0, 0, 0),
    ("G4", "Eb4", "M3", "M3", -2, -4, -1), ("C4", "B#3", "d2", "d2", -1, 0, -1),
])
def test_exact_intervals_and_transposition(first, second, name, simple, steps, semitones, direction):
    old, new = parse_pitch(first), parse_pitch(second)
    interval = interval_between(old, new)
    assert (interval.name, interval.simple_name, interval.diatonic_steps, interval.semitones) == (name, simple, steps, semitones)
    assert interval.direction == direction
    assert interval.is_compound == (abs(steps) > 7)
    assert transpose_pitch(old, steps, semitones) == new


@pytest.mark.parametrize("mode", ["major", "minor"])
def test_all_key_signatures_and_midi_round_trips(mode):
    for signature in range(-7, 8):
        key = Key.from_signature(signature, mode)
        assert Key.from_tonic_mode(key.tonic, mode).signature == signature
        leading_tone = key.leading_tone
        assert key.degree_of(parse_pitch(key.tonic + "4")) == (1, 0)
        assert key.scale_pitches[6][0] == leading_tone[0]
        assert key.scale_pitches[6][1] + (mode == "minor") == leading_tone[1]
        assert all(spell_midi_in_key(midi, key).midi == midi for midi in range(128))
        assert identify_chord([parse_pitch(key.tonic + "4"),
                              transpose_pitch(parse_pitch(key.tonic + "4"), 2, 4 if mode == "major" else 3)], key)["root"]
    assert spell_midi_in_key(68, A_MINOR).spell == "G#4"
    assert spell_midi_in_key(70, Key("F", "major")).spell == "Bb4"
    assert spell_midi_in_key(71, Key("Cb", "major")).spell == "Cb5"
    assert spell_midi_in_key(69, Key("A#", "minor")).spell == "G##4"


@pytest.mark.parametrize(("symbol", "key", "members", "bass", "function"), [
    ("I", C_MAJOR, "C4 E4 G4", "C4", "T"), ("IV7", C_MAJOR, "F4 A4 C4 E4", "F4", "PD"),
    ("vi6", C_MAJOR, "A4 C4 E4", "C4", "T"), ("V64", C_MAJOR, "G4 B4 D4", "D4", "D"),
    ("V43", C_MAJOR, "G4 B4 D4 F4", "D4", "D"), ("V2", C_MAJOR, "G4 B4 D4 F4", "F4", "D"),
    ("i", A_MINOR, "A4 C4 E4", "A4", "T"), ("v", A_MINOR, "E4 G4 B4", "E4", "D"),
    ("V7", A_MINOR, "E4 G#4 B4 D4", "E4", "D"), ("vii°7", A_MINOR, "G#4 B4 D4 F4", "G#4", "D"),
    ("III+", A_MINOR, "C4 E4 G#4", "C4", "T"), ("VII7", A_MINOR, "G4 B4 D4 F4", "G4", "T"),
    ("V7/V", C_MAJOR, "D4 F#4 A4 C4", "D4", "D"), ("V6/5/V", C_MAJOR, "D4 F#4 A4 C4", "F#4", "D"),
    ("V4/3/ii", C_MAJOR, "A4 C#4 E4 G4", "E4", "D"), ("V4/2/iv", C_MAJOR, "C4 E4 G4 Bb4", "Bb4", "D"),
    ("vii°6/V", C_MAJOR, "F#4 A4 C4", "A4", "D"), ("viio7/V", C_MAJOR, "F#4 A4 C4 Eb4", "F#4", "D"),
    ("vii°ø7/V", C_MAJOR, "F#4 A4 C4 E4", "F#4", "D"), ("iiø6/5", C_MAJOR, "D4 F4 Ab4 C4", "F4", "PD"),
    ("ii°/7", A_MINOR, "B4 D4 F4 A4", "B4", "PD"), ("ii%65", A_MINOR, "B4 D4 F4 A4", "D4", "PD"),
    ("N6", C_MAJOR, "Db4 F4 Ab4", "F4", "PD"), ("bII6", A_MINOR, "Bb4 D4 F4", "D4", "PD"),
    ("iv", C_MAJOR, "F4 Ab4 C4", "F4", "PD"), ("ii°6", C_MAJOR, "D4 F4 Ab4", "F4", "PD"),
    ("bVI", C_MAJOR, "Ab4 C4 Eb4", "Ab4", "T"), ("bIII", C_MAJOR, "Eb4 G4 Bb4", "Eb4", "T"),
    ("I", A_MINOR, "A4 C#4 E4", "A4", "T"),
])
def test_roman_numeral_spelling(symbol, key, members, bass, function):
    spec = parse_roman_numeral(symbol, key)
    assert spec.chord_members == tuple(parse_pitch(pitch).spelling for pitch in members.split())
    assert spec.expected_bass == parse_pitch(bass).spelling
    assert spec.function == function
    assert spec.is_seventh == (len(members.split()) == 4)


def test_applied_tendencies_and_cadential_marking():
    spec = parse_roman_numeral("V6/5/V", C_MAJOR)
    assert [(tone.pitch, tone.direction, tone.target) for tone in spec.tendency_tones] == [
        (("F", 1), 1, ("G", 0)), (("C", 0), -1, None),
    ]
    assert parse_roman_numeral("Cad6/4", C_MAJOR).is_cadential_64
    assert parse_roman_numeral("cad6/4", A_MINOR).third == ("C", 0)
    assert not parse_roman_numeral("V6/4", C_MAJOR).is_cadential_64
    assert not parse_roman_numeral("I6/4", C_MAJOR).is_cadential_64


@pytest.mark.parametrize(("figure", "bass", "key", "notes", "roman"), [
    ("", "C3", C_MAJOR, "E4 G4", "I"), ("5/3", "C3", C_MAJOR, "E4 G4", "I"),
    ("6", "E3", C_MAJOR, "G4 C4", "I6"), ("6/3", "E3", C_MAJOR, "G4 C4", "I6"),
    ("6/4", "G2", C_MAJOR, "C4 E4", "I6/4"), ("65", "B2", C_MAJOR, "D4 F4 G4", "V6/5"),
    ("6/5", "B2", C_MAJOR, "D4 F4 G4", "V6/5"), ("4/3", "D3", C_MAJOR, "F4 G4 B4", "V4/3"),
    ("4/2", "F3", C_MAJOR, "G4 B4 D4", "V4/2"), ("2", "F3", C_MAJOR, "G4 B4 D4", "V4/2"),
    ("#", "E3", A_MINOR, "G#4 B4", "V"), ("7/#", "E3", A_MINOR, "G#4 B4 D4", "V7"),
    ("#6", "D3", A_MINOR, "F4 B#4", None), ("6/#4", "D3", A_MINOR, "G#4 B4", "vii°6/4"),
    ("6/4#", "D3", A_MINOR, "G#4 B4", "vii°6/4"), ("#4/2", "D3", A_MINOR, "E4 G#4 B4", "V4/2"),
    ("6+", "E3", A_MINOR, "G4 C#4", "vii°6/iv"), ("6/", "E3", A_MINOR, "G4 C#4", "vii°6/iv"),
    ("b5", "D3", C_MAJOR, "F4 Ab4", "ii°"), ("b", "F3", C_MAJOR, "Ab4 C4", "iv"),
    ("n", "C3", Key("Ab", "major"), "E4 G4", "V/vi"),
    ("♮", "C3", Key("Ab", "major"), "E4 G4", "V/vi"),
    ("b7", "C3", C_MAJOR, "E4 G4 Bb4", "V7/IV"), ("Cad6/4", "G2", C_MAJOR, "C4 E4", "Cad6/4"),
])
def test_figured_bass_intervals(figure, bass, key, notes, roman):
    spec = parse_figured_bass(figure, parse_pitch(bass), key)
    assert spec.required_pitches == tuple(parse_pitch(pitch).spelling for pitch in notes.split())
    assert (spec.roman_numeral.symbol if spec.roman_numeral else None) == roman
    assert spec.is_seventh == (len(notes.split()) == 3)
    assert spec.is_cadential_64 == (roman == "Cad6/4")


def test_identify_chord_retains_spelling_inversion_and_member_roles():
    result = identify_chord([parse_pitch(pitch) for pitch in "F4 B3 G3 D3".split()], C_MAJOR)
    assert result["roman_numeral"] == "V4/3"
    assert result["root"] == ("G", 0)
    assert result["quality"] == "dominant_seventh"
    assert result["inversion"] == 2
    assert result["complete"]
    assert result["member_roles"] == ["seventh", "third", "root", "fifth"]
    incomplete = identify_chord([parse_pitch(pitch) for pitch in "C5 E4 C4 C3".split()], C_MAJOR)
    assert incomplete["roman_numeral"] == "I"
    assert not incomplete["complete"]
    assert incomplete["missing_members"] == (("G", 0),)


@pytest.mark.parametrize(("key", "chords"), [
    ("C major", [("I", "C4 G3 E3 C3"), ("ii6", "D4 A3 D3 F2"), ("I6/4", "E4 C4 G3 G2"),
                 ("V7", "D4 B3 F3 G2"), ("I", "C4 G3 E3 C3")]),
    ("A minor", [("i", "A4 C4 E3 A2"), ("iv", "A4 A3 F3 D3"), ("V7", "G#4 D4 E3 E3"),
                 ("i", "A4 C4 E3 A2")]),
    ("D major", [("I", "D4 A3 F#3 D3"), ("V6/5/V", "D4 B3 E3 G#2"), ("V", "C#4 A3 E3 A2"),
                 ("I", "D4 A3 F#3 D3")]),
])
def test_perfect_progressions(key, chords):
    result = grade(*chords, key=key)
    assert result["summary"]["score"] == result["summary"]["max_score"] == 100
    assert result["summary"]["ap_points"] == result["summary"]["ap_max_points"] == 25
    assert result["summary"]["error_count"] == result["summary"]["warning_count"] == 0
    assert result["cadence"] == "PAC"
    assert not result["issues"]
    assert [chord["is_cadential_64"] for chord in result["chords"]].count(True) == (key == "C major")


@pytest.mark.parametrize(("code", "voices", "chords"), [
    ("parallel_fifths", "SB", [("I", "G4 E4 C4 C3"), ("ii7", "A4 F4 C4 D3")]),
    ("parallel_octaves", "SB", [("I", "C5 G4 E4 C3"), ("ii", "D5 A4 F4 D3")]),
    ("parallel_octaves", "AT", [("I", "G4 C4 C4 C3"), ("ii", "A4 D4 D4 D3")]),
    ("parallel_octaves", "TB", [("V", "B4 D4 G3 G2"), ("I", "G4 E4 C4 C4")]),
    ("parallel_fifths", "AT", [("I", "E5 G4 C4 C3"), ("ii", "F5 A4 D4 D3")]),
    ("contrary_fifths", "SB", [("I", "G4 E4 C4 C4"), ("ii", "A4 F4 A3 D3")]),
    ("contrary_octaves", "AT", [("I", "G4 C4 C4 C3"), ("I", "G4 E4 E3 C3")]),
    ("direct_fifths", "SB", [("I", "E4 C4 G3 C3"), ("IV", "C5 A4 F4 F3")]),
    ("direct_octaves", "SB", [("I", "E4 C4 G3 C3"), ("IV", "F5 C5 A4 F3")]),
    ("unequal_fifths", "SB", [("vii°", "F4 D4 D3 B2"), ("I", "G4 E4 C4 C3")]),
    ("unresolved_leading_tone", "S", [("V", "B4 D4 G3 G2"), ("I", "G4 E4 C4 C3")]),
    ("unresolved_leading_tone", "B", [("V6/5/V", "D4 B3 E3 G#2"), ("I", "D4 A3 F#3 D3")]),
    ("unresolved_chordal_seventh", "T", [("V7", "D4 B3 F3 G2"), ("I", "C4 G3 G3 C3")]),
    ("cadential_64_resolution", "S", [("Cad6/4", "E4 C4 G3 G2"), ("V", "B4 D4 G3 G2")]),
    ("cadential_64_bass", "B", [("Cad6/4", "E4 C4 G3 G2"), ("V", "D4 B3 G3 G3")]),
    ("voice_overlap", "SA", [("I", "E4 C4 G3 C3"), ("IV", "A4 F4 C4 F3")]),
    ("augmented_fourth", "S", [("IV", "F4 C4 A3 F3"), ("V", "B4 D4 G3 G2")]),
    ("augmented_fifth", "S", [("I", "C4 G3 E3 C3"), ("V/V", "G#4 E4 B3 E3")]),
    ("seventh_leap", "S", [("I", "C4 G3 E3 C3"), ("V", "B4 D4 G3 G2")]),
    ("leap_over_octave", "S", [("I", "C4 G3 E3 C3"), ("IV", "F5 C5 A4 F3")]),
    ("unresolved_diminished_leap", "S", [("V/V", "F#4 D4 A3 D3"), ("I", "C5 G4 E4 C3")]),
])
def test_transition_errors(code, voices, chords):
    key = "D major" if code == "unresolved_leading_tone" and voices == "B" else "C major"
    issues = matching(grade(*chords, key=key), code, voices)
    assert len(issues) == 1
    assert issues[0]["severity"] == "error"
    assert (issues[0]["previous_chord_index"], issues[0]["chord_index"]) == (0, 1)


@pytest.mark.parametrize(("code", "voices", "chord", "key"), [
    ("doubled_leading_tone", "SA", ("V", "B4 B3 D3 G2"), "C major"),
    ("doubled_secondary_leading_tone", "SB", ("V6/5/V", "F#4 C4 A3 F#3"), "C major"),
    ("doubled_chordal_seventh", "SA", ("V7", "F4 F3 B2 G2"), "C major"),
    ("doubled_chromatic_pitch", "SB", ("bVI", "Ab4 Eb4 C4 Ab2"), "C major"),
    ("six_four_doubling", None, ("I6/4", "E4 C4 C4 G2"), "C major"),
    ("diminished_triad_doubling", "ST", ("ii°6", "D4 Ab3 D3 F2"), "C major"),
    ("missing_third", None, ("I", "G4 C4 G3 C3"), "C major"),
    ("missing_seventh", None, ("V7", "D4 B3 G3 G2"), "C major"),
    ("missing_fifth", None, ("I6", "E4 C4 C4 E3"), "C major"),
    ("missing_fifth", None, ("vii°", "D4 B3 D3 B2"), "C major"),
    ("wrong_bass_inversion", "B", ("I6", "E4 C4 G3 C3"), "C major"),
    ("missing_raised_leading_tone", None, ("V", "G4 B3 E3 E2"), "A minor"),
    ("missing_raised_leading_tone", None, ("V7", "G4 D4 B3 E3"), "A minor"),
    ("missing_raised_leading_tone", None, ("vii°6", "G4 B3 D3 B2"), "A minor"),
    ("extraneous_pitch", "S", ("I", "B#4 E4 G3 C3"), "C major"),
    ("voice_crossing", "SA", ("I", "E4 G4 C4 C3"), "C major"),
    ("spacing", "SA", ("I", "G5 E4 C4 C3"), "C major"),
    ("spacing", "AT", ("I", "G5 E5 C4 C3"), "C major"),
    ("out_of_range", "S", ("I", "C6 G4 E4 C3"), "C major"),
])
def test_single_chord_errors(code, voices, chord, key):
    assert matching(grade(chord, key=key), code, voices)[0]["severity"] == "error"


def test_static_voices_and_stepwise_approach_do_not_create_perfect_interval_errors():
    static = ("I", "G4 E4 C4 C3")
    assert not grade(static, static)["issues"]
    stepwise = grade(("I", "E4 C4 G3 C3"), ("IV", "F4 C4 A3 F3"))
    assert not matching(stepwise, "direct_octaves")
    assert score_transition_voicing(["C4", "C4", "G3", "C3"], ["E4", "E3", "E3", "C3"]) > 0


def test_upper_unequal_fifths_and_ascending_seventh_in_v43_i6_are_allowed():
    chord = grade(("V4/3", "F4 B3 G3 D3"), ("I6", "G4 C4 G3 E3"))
    assert not matching(chord, "unequal_fifths", "SA")
    assert not matching(chord, "unresolved_chordal_seventh", "S")
    outer = grade(("I", "G4 E4 C4 C3"), ("vii°", "F4 D4 B3 B2"))
    assert matching(outer, "unequal_fifths", "SB")[0]["severity"] == "warning"


def test_tendency_frustration_and_common_tone_retention():
    result = grade(("V", "D4 B3 G3 G2"), ("I", "C4 G3 E3 C3"))
    assert not matching(result, "unresolved_leading_tone", "A")
    result = grade(("V7", "F4 B3 D3 G2"), ("V4/3", "F4 B3 G3 D3"))
    assert not matching(result, "unresolved_chordal_seventh", "S")
    result = grade(("V", "D4 B3 G3 G2"), ("I", "C4 G3 C3 C3"))
    assert matching(result, "unresolved_leading_tone", "A")


def test_minor_augmented_second_and_diminished_leap_recovery():
    result = grade(("iv", "F4 A3 D3 D3"), ("V", "G#4 B3 E3 E3"), key="A minor")
    assert matching(result, "augmented_second", "S")
    result = grade(("V/V", "F#4 D4 A3 D3"), ("I", "C5 G4 E4 C3"), ("V", "B4 G4 D4 G3"))
    assert not matching(result, "unresolved_diminished_leap", "S")


def test_range_and_bass_spacing_soft_warnings():
    result = grade(("ii", "A5 F4 A3 D3"), ("iii", "E5 B4 G4 E2"))
    assert matching(result, "out_of_range", "S")[0]["severity"] == "warning"
    assert matching(result, "spacing", "TB")[0]["severity"] == "warning"


@pytest.mark.parametrize(("cadence", "chords"), [
    ("IAC", [("V7", "D4 B3 F3 G2"), ("I", "E4 C4 G3 C3")]),
    ("HC", [("I", "E4 C4 G3 C3"), ("V", "D4 B3 G3 G2")]),
    ("DC", [("V", "B4 D4 G3 G2"), ("vi", "C5 E4 A3 A2")]),
    ("PC", [("IV", "F4 C4 A3 F3"), ("I", "E4 C4 G3 C3")]),
])
def test_cadence_classes(cadence, chords):
    assert grade(*chords)["cadence"] == cadence


def test_figured_bass_detects_an_unrealized_accidental_and_locks_bass_in_demo():
    chord = {"figure": "7/#", "bass": "E3", "voices": ["G4", "D4", "B3", "E3"]}
    payload = {"key": {"signature": 0, "mode": "minor"}, "exercise_type": "figured_bass", "chords": [chord]}
    result = grade_four_part(payload)
    issue = matching(result, "unrealized_figured_bass")[0]
    demo = issue["audio_demo"]
    assert len(demo["in_context"]) == 4
    assert {(event["onset"], event["duration"]) for event in demo["in_context"]} == {(0, 2)}
    fix = demo["fixed_comparison"]
    assert fix["fixed_voices"]["B"] == "E3"
    assert "G#4" in fix["fixed_voices"].values()
    fixed = {**payload, "chords": [{**chord, "voices": fix["fixed_voices"]}]}
    assert grade_four_part(fixed)["summary"]["error_count"] == 0
    assert fix["before_events"] == demo["in_context"]
    assert {event["spell"] for event in fix["after_events"]} == set(fix["fixed_voices"].values())
    json.dumps(result)


def test_parallel_audio_and_local_correction_can_be_regraded():
    first = ("I", "G4 E4 C4 C3")
    second = ("ii7", "A4 F4 C4 D3")
    result = grade(first, second)
    audio = matching(result, "parallel_fifths", "SB")[0]["audio_demo"]
    assert [event["voice"] for event in audio["isolated_pair"]] == ["S", "B", "S", "B"]
    assert [event["onset"] for event in audio["isolated_pair"]] == [0, 0, 1.5, 1.5]
    assert [event["chordIndex"] for event in audio["isolated_pair"]] == [0, 0, 1, 1]
    assert all(event["duration"] == 1.5 for event in audio["isolated_pair"])
    assert len(audio["in_context"]) == 8
    fixed = audio["fixed_comparison"]["fixed_voices"]
    assert grade(first, ("ii7", " ".join(fixed[voice] for voice in VOICES)))["issues"] == []
    assert score_transition_voicing(first[1].split(), fixed, C_MAJOR, previous_harmony="I", current_harmony="ii7") == 0


def test_tendency_audio_uses_bass_anchor_and_lists_every_voice_in_context():
    result = grade(("V", "B4 D4 G3 G2"), ("I", "G4 E4 C4 C3"))
    audio = matching(result, "unresolved_leading_tone", "S")[0]["audio_demo"]
    assert [event["voice"] for event in audio["isolated_pair"]] == ["S", "B", "S", "B"]
    assert len(audio["in_context"]) == 8


def test_free_mode_and_reusable_local_search():
    result = grade_four_part({"key": "C major", "exercise_type": "free", "progression": [
        {"soprano": "D4", "alto": "B3", "tenor": "F3", "bass": "G2"},
        {"voices": ["C4", "G3", "E3", "C3"]},
    ]})
    assert result["cadence"] == "PAC"
    assert result["chords"][0]["roman_numeral"] == "V7"
    figure = parse_figured_bass("", parse_pitch("C3"), C_MAJOR)
    previous = ["D4", "B3", "F3", "G2"]
    resolved = find_clean_voicing(figure, C_MAJOR, previous=previous, locked_voices={"S": "C4"})
    assert resolved["S"].spell == "C4"
    assert resolved["B"].spell == "C3"
    assert score_transition_voicing(previous, resolved, C_MAJOR) == 0
    assert find_clean_voicing(figure, C_MAJOR, locked_voices={"S": "B4"}) is None


@pytest.mark.parametrize("payload", [
    None, {}, {"exercise_type": []}, {"exercise_type": "free", "key": "H major"},
    {"exercise_type": "free", "key": "C major", "chords": []},
    {"exercise_type": "free", "key": "C major", "chords": [{"voices": ["C4", "E3"]}]},
    {"exercise_type": "roman_numeral", "key": "C major", "chords": [{"voices": ["C4", "G3", "E3", "C3"]}]},
    {"exercise_type": "roman_numeral", "key": "C major", "chords": [
        {"voices": ["C4", "G3", "E3", "C3"], "roman": "V6//5"},
    ]},
    {"exercise_type": "figured_bass", "key": "C major", "chords": [
        {"voices": ["C4", "G3", "E3", "C3"], "figure": "4/5/7"},
    ]},
])
def test_malformed_payload_raises_value_error(payload):
    with pytest.raises(ValueError):
        grade_four_part(payload)


def test_review_edge_cases_doubling_tendency_and_figured_bass():
    # Unslashed figured bass with accidentals before digits (7#3, 6#4, 6b5)
    fb_7s3 = parse_figured_bass("7#3", parse_pitch("E3"), A_MINOR)
    assert dict(fb_7s3.intervals)[3] == ("G", 1)
    assert dict(fb_7s3.intervals)[7] == ("D", 0)
    fb_6s4 = parse_figured_bass("6#4", parse_pitch("C3"), C_MAJOR)
    assert dict(fb_6s4.intervals)[4] == ("F", 1)
    assert dict(fb_6s4.intervals)[6] == ("A", 0)

    # V/iii and iii6/4 in C major can be cleanly voiced without false doubled_leading_tone
    assert find_clean_voicing("V/iii", C_MAJOR) is not None
    assert find_clean_voicing("iii6/4", C_MAJOR) is not None

    # Prolonged dominant V -> V7 -> I and delayed 7th ii6/5 -> Cad6/4 -> V -> I and V7/V -> V7 -> I
    prolonged = grade(("V", "B4 D4 G3 G2"), ("V7", "B4 F4 G3 G2"), ("I", "C5 E4 G3 C3"))
    assert not [i for i in prolonged["issues"] if i["code"] == "unresolved_leading_tone"]

    delayed7 = grade(("ii6/5", "A4 C4 D3 F2"), ("Cad6/4", "G4 C4 E3 G2"), ("V", "G4 B3 D3 G2"), ("I", "G4 C4 E3 C3"))
    assert not [i for i in delayed7["issues"] if i["code"] == "unresolved_chordal_seventh"]

    sec_desc = grade(("V7/V", "A4 F#4 C4 D3"), ("V7", "G4 F4 B3 G2"), ("I", "G4 E4 C4 C3"))
    assert not [i for i in sec_desc["issues"] if i["code"] == "unresolved_leading_tone"]

    # Figured bass with locked_voices=["B"] and edited bass grades wrong_bass instead of raising 422
    edited_fb = grade_four_part({
        "key_tonic": "C", "mode": "major", "exercise_type": "figured_bass", "locked_voices": ["B"],
        "chords": [{"voices": {"S": "C5", "A": "E4", "T": "G3", "B": "D3"}, "given_bass": "C3", "figure": ""}],
    })
    assert any(i["code"] == "wrong_bass" for i in edited_fb["issues"])
    assert edited_fb["cadence"] is None

    # V -> V is not HC and V -> vi6 is not DC
    assert grade(("V", "B4 D4 G3 G2"), ("V", "D5 B4 G3 G2"))["cadence"] is None
    assert grade(("V", "B4 D4 G3 G2"), ("vi6", "C5 E4 A3 C3"))["cadence"] is None

    # Invalid onset / duration raise ValueError
    with pytest.raises(ValueError):
        grade_four_part({"exercise_type": "free", "key": "C major", "chords": [
            {"onset": -1, "duration": 1, "voices": ["C5", "E4", "G3", "C3"]}
        ]})
    with pytest.raises(ValueError):
        grade_four_part({"exercise_type": "free", "key": "C major", "chords": [
            {"onset": 0, "duration": 0, "voices": ["C5", "E4", "G3", "C3"]}
        ]})

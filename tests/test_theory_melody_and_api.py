from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from app import MAX_THEORY_BYTES, MAX_THEORY_ROWS, app
from staff2audio.theory import (
    Key, get_exercise_catalog, grade_four_part, grade_melody_harmonization, parse_pitch, parse_roman_numeral,
    realize_satb, suggest_harmonization,
)


def melody(*rows):
    return [{"onset": onset, "duration": duration, "pitch": pitch} for onset, duration, pitch in rows]


def slots(*rows):
    return [{"onset": onset, "duration": duration, "bass": bass, "roman": roman}
            for onset, duration, roman, bass in rows]


def exercise(notes, harmonization, **extra):
    return {"key_tonic": "C", "mode": "major", "time_signature": "4/4", "melody": notes,
            "harmonization": harmonization, **extra}


def grade(*rows, **extra):
    return grade_melody_harmonization(exercise(
        melody(*[(i, 1, soprano) for i, (_, _, soprano) in enumerate(rows)]),
        slots(*[(i, 1, roman, bass) for i, (roman, bass, _) in enumerate(rows)]), **extra,
    ))


def issues(result, code):
    return [issue for issue in result["issues"] if issue["code"] == code]


@pytest.mark.parametrize(("label", "notes", "harmonization", "index"), [
    ("CT", [(0, 1, "E5")], [(0, 1, "I", "C3")], 0),
    ("PT", [(0, .5, "C5"), (.5, .5, "D5"), (1, 1, "E5")], [(0, 2, "I", "C3")], 1),
    ("NT", [(0, .5, "C5"), (.5, .5, "D5"), (1, 1, "C5")], [(0, 2, "I", "C3")], 1),
    ("SUS", [(1.5, .5, "C5"), (2, .5, "C5"), (2.5, 1, "B4")],
     [(1.5, .5, "I", "C3"), (2, 1.5, "V", "G2")], 1),
    ("APP", [(0, 1, "E5"), (1, 1, "A5"), (2, 1, "G5")], [(0, 3, "I", "C3")], 1),
    ("ET", [(0, .5, "C5"), (.5, .5, "D5"), (1, 1, "G4")], [(0, 2, "I", "C3")], 1),
    ("ANT", [(0, .5, "C5"), (.5, .5, "D5"), (1, 1, "D5")],
     [(0, 1, "IV", "F3"), (1, 1, "V", "G3")], 1),
    ("CLASH", [(0, 2, "F#5"), (2, 1, "C5")], [(0, 3, "I", "C3")], 0),
])
def test_melody_classification(label, notes, harmonization, index):
    result = grade_melody_harmonization(exercise(melody(*notes), slots(*harmonization)))
    analysis = result["melody_analysis"][index]
    assert analysis["classification"] == label
    if label == "CT":
        assert analysis["label"] == "Chord tone (3rd)"
    assert bool(issues(result, "melody_clash")) == (label == "CLASH")


def test_spelling_rests_and_timed_audio_demos():
    result = grade_melody_harmonization(exercise(
        melody((0, .5, "E5"), (.5, .5, "D#5"), (1.5, .5, "E5"), (3, 1, "B#4")),
        slots((0, 2, "I", "C3"), (3, 1, "I", "C3")),
    ))
    assert [note["classification"] for note in result["melody_analysis"]] == ["CT", "CLASH", "CT", "CLASH"]
    issue = issues(result, "melody_clash")[0]
    assert issue["chords"] == [0]
    assert issue["note_index"] == 1
    pair = issue["audio_demo"]["isolated_pair"]
    assert set(event["voice"] for event in pair) == {"S", "B"}
    assert [(event["onset"], event["duration"]) for event in pair if event["spell"] == "D#5"] == [(.5, .5)]
    assert {event["voice"] for event in issue["audio_demo"]["in_context"]} == {"S", "A", "T", "B"}


def test_held_suspension_and_clash_repair():
    held = grade_melody_harmonization(exercise(
        melody((1.5, 1, "C5"), (2.5, 1, "B4")),
        slots((1.5, .5, "I", "C3"), (2, 1.5, "V", "G2")),
    ))
    note = held["melody_analysis"][0]
    assert note["classification"] == "CT"
    assert note["sustained_dissonance"] == {"classification": "SUS", "label": "Suspension", "onset": 2, "chord_index": 1}
    result = grade(("I", "C3", "F5"))
    issue, = issues(result, "melody_clash")
    fixed = issue["audio_demo"]["fixed_comparison"]
    assert fixed["before_events"] != fixed["after_events"]
    assert not issues(grade((fixed["fixed_roman"], fixed["fixed_bass"], "F5")), "melody_clash")


@pytest.mark.parametrize(("code", "first", "second"), [
    ("parallel_fifths", ("I", "C3", "G4"), ("IV", "F3", "C5")),
    ("parallel_octaves", ("I", "C3", "C4"), ("IV", "F3", "F4")),
    ("contrary_fifths", ("I", "C3", "G4"), ("V", "G3", "D4")),
    ("contrary_octaves", ("I", "C3", "C5"), ("V", "G3", "G4")),
    ("direct_fifths", ("I", "C3", "E4"), ("IV", "F3", "C5")),
    ("direct_octaves", ("I", "C3", "G4"), ("IV", "F3", "F5")),
    ("unequal_fifths", ("V6/5", "B2", "F4"), ("I", "C3", "G4")),
    ("voice_crossing", ("I", "C3", "E4"), ("IV", "F3", "F3")),
])
def test_soprano_bass_counterpoint(code, first, second):
    result = grade(first, second)
    issue, = issues(result, code)
    assert issue["voices"] == ["S", "B"]
    assert issue["chords"] == ([1] if code == "voice_crossing" else [0, 1])
    if code.startswith("parallel"):
        comparison = issue["audio_demo"]["fixed_comparison"]
        assert comparison["before_events"] != comparison["after_events"]
        fixed = grade(first, (comparison["fixed_roman"], comparison["fixed_bass"], second[2]))
        assert not issues(fixed, code)


def test_syntax_and_bass_inversion_with_playable_repair():
    retrogression = grade(("V", "G2", "B4"), ("IV", "F2", "A4"))
    assert issues(retrogression, "harmonic_retrogression")
    applied = grade(("V/V", "D3", "F#4"), ("V", "G2", "G4"))
    assert not issues(applied, "harmonic_retrogression")
    assert applied["chords"][0]["function"] == "PD"
    pedal = grade(("I", "C3", "G4"), ("IV6/4", "C3", "A4"), ("I", "C3", "G4"))
    assert pedal["summary"]["error_count"] == 0
    wrong_bass = grade(("I", "C3", "E4"), ("IV6", "F3", "C4"))
    issue, = issues(wrong_bass, "wrong_bass_inversion")
    fixed = issue["audio_demo"]["fixed_comparison"]
    assert fixed["fixed_bass"].startswith("A")
    assert fixed["fixed_roman"] == "IV6"
    assert {event["voice"] for event in fixed["after_events"]} == {"S", "A", "T", "B"}


@pytest.mark.parametrize(("harmonization", "meter", "pickup", "syncopates"), [
    ([(0, 3, "I", "C3"), (3, 2, "V", "G2")], "4/4", 0, True),
    ([(0, 3, "I", "C3"), (3, 1, "V", "G2"), (4, 1, "V", "G2")], "4/4", 0, True),
    ([(0, 3, "I", "C3"), (3, 1, "V", "G2"), (4, 1, "I", "C3")], "4/4", 0, False),
    ([(0, 2, "I", "C3"), (2, 3, "IV", "F3")], "4/4", 0, True),
    ([(0, 4, "I", "C3"), (4, 1, "IV", "F3")], "4/4", 0, False),
    ([(0, 1, "V", "G2"), (1, 4, "I", "C3")], "4/4", 1, False),
    ([(0, 2, "I", "C3"), (2, 2, "V", "G2")], "6/8", 0, True),
    ([(0, 3, "V", "G2"), (3, 5, "I", "C3")], "4/4", 0, False),
])
def test_harmonic_syncopation(harmonization, meter, pickup, syncopates):
    notes = [(onset, duration, "G4") for onset, duration, _, _ in harmonization]
    result = grade_melody_harmonization(exercise(
        melody(*notes), slots(*harmonization), time_signature=meter, pickup_duration=pickup,
    ))
    assert bool(issues(result, "harmonic_syncopation")) == syncopates


@pytest.mark.parametrize(("code", "first", "second"), [
    ("augmented_second", ("iv6", "Ab2", "F4"), ("V6", "B2", "G4")),
    ("augmented_fourth", ("IV", "F2", "A4"), ("V6", "B2", "D4")),
    ("augmented_fifth", ("i", "Eb3", "G4"), ("I6", "B3", "G4")),
    ("seventh_leap", ("I", "C3", "E4"), ("V6", "B3", "D4")),
    ("leap_over_octave", ("IV", "F2", "A4"), ("V", "G3", "D4")),
    ("unresolved_diminished_leap", ("V6/V", "F#2", "A4"), ("I", "C3", "G4")),
    ("unresolved_leading_tone", ("V6/5", "B2", "D4"), ("I6", "E3", "C4")),
    ("unresolved_chordal_seventh", ("V4/2", "F3", "B4"), ("I", "C3", "C5")),
])
def test_bass_leaps_and_tendencies(code, first, second):
    issue, = issues(grade(first, second), code)
    assert issue["voices"] == ["B"]
    assert issue["severity"] == ("warning" if code == "unresolved_diminished_leap" else "error")


def test_bass_ranges_and_correct_resolutions():
    good = grade(("V6", "B2", "D4"), ("I", "C3", "E4"), ("V4/2", "F3", "B4"), ("I6", "E3", "C5"))
    assert not issues(good, "unresolved_leading_tone")
    assert not issues(good, "unresolved_chordal_seventh")
    range_result = grade(("V", "G1", "D5"), ("V4/3", "D4", "B4"))
    assert [issue["severity"] for issue in issues(range_result, "bass_out_of_range")] == ["error", "warning"]
    diminished = grade(("V6/V", "F#2", "A4"), ("I", "C3", "G4"), ("V6", "B2", "D4"))
    assert not issues(diminished, "unresolved_diminished_leap")


def test_outer_voice_motion_and_warning():
    stepwise = grade(("I", "C3", "E4"), ("ii", "D3", "F4"), ("I6", "E3", "G4"),
                     ("IV", "F3", "A4"), ("V", "G3", "B4"), ("vi", "A3", "C5"))
    assert [row["motion"] for row in stepwise["motions"]] == ["parallel"] * 5
    for code in ("repeated_parallel_motion", "limited_motion_variety"):
        assert issues(stepwise, code)[0]["severity"] == "warning"
    assert grade(("I", "C3", "E4"), ("IV6/4", "C3", "F4"))["motions"][0]["motion"] == "oblique"


def test_static_root_and_consecutive_leap_warnings():
    held = grade_melody_harmonization(exercise(melody((0, 10, "C5")), slots((0, 10, "I", "C3"))))
    assert issues(held, "static_bass")[0]["severity"] == "warning"
    leaps = grade(("IV", "F2", "A4"), ("V", "G2", "B4"), ("I", "C3", "E4"),
                  ("I6", "E3", "G4"), ("V", "G3", "B4"))
    assert issues(leaps, "consecutive_bass_leaps")[0]["severity"] == "warning"


@pytest.mark.parametrize(("expected", "detected", "first", "second"), [
    ("PAC", "PAC", ("V7", "G2", "B4"), ("I", "C3", "C5")),
    ("AC", "IAC", ("V", "G2", "D5"), ("I", "C3", "E5")),
    ("IAC", "IAC", ("vii°6", "D3", "B4"), ("I", "C3", "E5")),
    ("HC", "HC", ("ii6", "F3", "A4"), ("V", "G3", "B4")),
    ("DC", "DC", ("V", "G2", "D5"), ("vi", "A2", "C5")),
    ("PC", "PC", ("IV", "F2", "A4"), ("I", "C3", "E4")),
    ("PAC", "IAC", ("V", "G2", "D5"), ("I6", "E3", "C5")),
])
def test_cadence_grading(expected, detected, first, second):
    phrase = {"name": "Phrase 1", "start_onset": 0, "end_onset": 1, "expected_cadence": expected}
    result = grade(first, second, phrases=[phrase])
    cadence, = result["cadences"]
    assert cadence["chord_indices"] == [0, 1]
    assert cadence["detected"] == detected
    passed = expected in (detected, "AC")
    assert cadence["passed"] is passed
    assert bool(issues(result, "cadence_mismatch")) is not passed
    assert grade(first, second)["cadences"][0]["detected"] == detected


def test_contextual_cadential_six_four_and_sustained_cadence_arrival():
    result = grade(("I6/4", "G2", "C5"), ("I6/4", "G2", "C5"), ("V", "G2", "B4"))
    assert [row["function"] for row in result["chords"]] == ["D"] * 3
    assert result["cadences"][0]["detected"] == "HC"
    assert not issues(result, "cadential_64_resolution")
    notes = melody((0, 1, "B4"), (1, 3, "C5"))
    harmonization = slots((0, 1, "V", "G2"), (1, 3, "I", "C3"))
    result = grade_melody_harmonization(exercise(notes, harmonization, phrases=[
        {"name": "Phrase 1", "start_onset": 0, "end_onset": 4, "expected_cadence": "PAC"},
    ]))
    assert result["cadences"][0]["detected"] == "PAC"


def test_satb_realization_keeps_given_voices_and_spells_inner_voices():
    key = Key("C", "major")
    notes = melody((0, 1, "E4"), (1, 1, "F4"), (2, 1, "D4"), (3, 2, "C4"))
    harmonization = slots((0, 1, "I", "C3"), (1, 1, "ii6", "F2"), (2, 1, "V7", "G2"), (3, 2, "I", "C3"))
    preview = realize_satb(notes, harmonization, key)
    assert len(preview) == len(harmonization)
    for note, expected, entry in zip(notes, harmonization, preview):
        assert (entry["onset"], entry["duration"], entry["roman"]) == (expected["onset"], expected["duration"], expected["roman"])
        voices = entry["voices"]
        assert list(voices) == ["S", "A", "T", "B"]
        assert voices["S"] == parse_pitch(note["pitch"]).to_dict()
        assert voices["B"]["spell"] == expected["bass"]
        ordered = [row["midi"] for row in voices.values()]
        assert ordered == sorted(ordered, reverse=True)
        allowed = parse_roman_numeral(entry["roman"], key).chord_members
        assert all((voices[voice]["letter"], voices[voice]["alteration"]) in allowed for voice in ("A", "T"))


CATALOG = get_exercise_catalog()


@pytest.mark.parametrize(("kind", "item"), [(kind, item) for kind, group in CATALOG.items() for item in group],
                         ids=[item["id"] for group in CATALOG.values() for item in group])
def test_curated_exercise_models_and_student_attempts(kind, item):
    grader = grade_four_part if kind == "four_part" else grade_melody_harmonization
    result = grader(item["model_solution"])
    assert result["summary"]["score"] == 100
    assert result["summary"]["error_count"] == 0
    assert result["summary"]["ap_points"] == result["summary"]["ap_max_points"]
    if item["id"] == "free-g-major-sandbox":
        assert item["sample_attempt"] is None
    else:
        sample = grader(item["sample_attempt"])
        assert 2 <= sample["summary"]["error_count"] <= 3
        assert all(issue["audio_demo"]["isolated_pair"] and issue["audio_demo"]["in_context"] for issue in sample["issues"])


@pytest.mark.parametrize("item", CATALOG["melody"], ids=[item["id"] for item in CATALOG["melody"]])
def test_suggest_harmonizes_the_curated_melodies(item):
    suggested = suggest_harmonization(item)
    assert suggested["grade"]["summary"]["score"] == 100
    assert [row["detected"] for row in suggested["grade"]["cadences"]] == ["HC", "PAC"]
    assert suggested["grade"]["satb_preview"] == suggested["satb_preview"]


@pytest.mark.parametrize(("key", "mode", "names"), [
    ("C", "major", "E5 D5 C5 D5 E5 F5 B4 C5"),
    ("D", "minor", "F4 E4 D4 E4 F4 G4 C#4 D4"),
])
def test_suggest_custom_scanned_melody(key, mode, names):
    notes = melody(*[(index + .25, .5 if index in (1, 4) else 1, pitch)
                     for index, pitch in enumerate(names.split())])
    payload = {"key": key, "mode": mode, "melody": notes, "phrases": [
        {"name": "Open", "start_onset": 0, "end_onset": 3.25, "expected_cadence": "HC"},
        {"name": "Close", "start_onset": 4, "end_onset": 7.25, "expected_cadence": "PAC"},
    ]}
    result = suggest_harmonization(payload)
    assert result["grade"]["summary"]["score"] >= 89
    assert result["grade"]["cadences"][-1]["detected"] == "PAC"
    assert all(40 <= parse_pitch(row["bass"]).midi <= 60 for row in result["harmonization"])


def test_four_part_ui_aliases_preserve_the_legacy_payload_and_row_lock_override():
    payload = {"key_tonic": "C", "exercise_type": "roman_numeral", "locked_voices": ["B"], "chords": [
        {"roman": "I", "onset": .5, "duration": 2, "voices": ["G4", "E4", "C4", "C3"]},
        {"roman": "IV", "locked_voices": [], "voices": ["C5", "F4", "A3", "F3"]},
    ]}
    result = grade_four_part(payload)
    first, second = result["chords"]
    assert (first["onset"], first["duration"], first["index"], first["detected_roman"], first["expected_roman"]) == (.5, 2, 0, "I", "I")
    assert (second["onset"], second["duration"], second["index"], second["expected_figure"]) == (1, 1, 1, None)
    issue, = [row for row in issues(result, "parallel_fifths") if row["voices"] == ["S", "B"]]
    assert issue["id"].startswith("issue-")
    assert issue["rule_id"] == issue["code"]
    assert issue["title"] == "Parallel fifths"
    assert issue["chords"] == [0, 1]
    assert issue["suggestion"]
    assert isinstance(issue["audio_demo"]["isolated_pair"], list)
    assert isinstance(issue["audio_demo"]["in_context"], list)
    with pytest.raises(ValueError, match="Chord 1.*Unknown locked voice"):
        grade_four_part({**payload, "locked_voices": ["novice"]})
    override = deepcopy(payload)
    override["locked_voices"] = ["novice"]
    override["chords"] = override["chords"][1:]
    assert grade_four_part(override)["key"]["tonic"] == "C"


@pytest.fixture
def client():
    return TestClient(app)


def test_theory_catalog_api(client):
    response = client.get("/api/theory/exercises")
    assert response.status_code == 200
    assert response.json() == CATALOG
    assert response.headers["cache-control"] == "no-store"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


@pytest.mark.parametrize(("path", "kind"), [
    ("grade/four-part", "four_part"), ("grade/melody", "melody"), ("harmonize/suggest", "melody"),
])
def test_theory_json_api(client, path, kind):
    payload = CATALOG[kind][0]["model_solution"]
    response = client.post(f"/api/theory/{path}", json=payload)
    assert response.status_code == 200
    data = response.json()
    grade_result = data.get("grade", data)
    assert grade_result["summary"]["score"] == 100
    assert not grade_result["issues"]
    if kind == "melody":
        assert data["satb_preview"]
    bad_payload = dict(payload, key_tonic="Q")
    del bad_payload["key_signature"]
    bad = client.post(f"/api/theory/{path}", json=bad_payload)
    assert bad.status_code == 422
    assert "Invalid pitch" in bad.json()["detail"]
    assert client.post(f"/api/theory/{path}", json=[]).status_code == 422


def test_theory_api_preserves_origin_and_host_restrictions(client):
    assert client.get("/api/theory/exercises", headers={"Origin": "https://unrelated.example"}).status_code == 403
    assert client.post("/api/theory/grade/melody", json={}, headers={"Origin": "https://unrelated.example"}).status_code == 403
    assert client.get("/api/theory/exercises", headers={"Host": "unrelated.example"}).status_code == 400
    assert client.get("/api/theory/exercises", headers={"Origin": "http://testserver"}).status_code == 200


@pytest.mark.parametrize("content", [b"{bad}", b'{"extra": NaN}', b'{"extra": 1e400}', b"[" * 1200 + b"]" * 1200])
def test_theory_api_rejects_malformed_and_nonfinite_json(client, content):
    response = client.post("/api/theory/grade/melody", content=content)
    assert response.status_code == 422
    assert response.json()["detail"]


def test_theory_api_bounds_stream_body_and_work(client):
    path = "/api/theory/harmonize/suggest"
    response = client.post(path, content=iter([b" " * (MAX_THEORY_BYTES // 2)] * 3))
    assert response.status_code == 413
    response = client.post(path, json={"melody": [{}] * (MAX_THEORY_ROWS + 1)})
    assert response.status_code == 422
    assert "at most" in response.json()["detail"]


@pytest.mark.parametrize(("notes", "message"), [
    (melody((0, 2, "C4"), (1, 1, "D4")), "cannot contain overlapping"),
    (melody((0, 0, "C4")), "Duration must be"),
    (melody((0, 1, "Q4")), "Invalid pitch"),
])
def test_theory_melody_api_validates_music_rows(client, notes, message):
    response = client.post("/api/theory/grade/melody", json=exercise(notes, slots((0, 1, "I", "C3"))))
    assert response.status_code == 422
    assert message in response.json()["detail"]


def test_melody_review_edge_cases_double_pt_sustained_clash_and_syntax():
    # Double passing tones (G4 -> A4 -> B4 -> C5 over I)
    double_pt = grade_melody_harmonization(exercise(
        melody((0, 0.5, "G4"), (0.5, 0.5, "A4"), (1, 0.5, "B4"), (1.5, 0.5, "C5")),
        slots((0, 2, "I", "C3")),
    ))
    assert [row["classification"] for row in double_pt["melody_analysis"]] == ["CT", "PT", "PT", "CT"]
    assert not issues(double_pt, "melody_clash")

    # Sustained melody note crossing into dissonant harmony without suspension resolution emits melody_clash
    sustained_bad = grade_melody_harmonization(exercise(
        melody((0, 2, "E5"), (2, 4, "C5"), (6, 1, "D5"), (7, 1, "C5")),
        slots((0, 2, "I", "C3"), (2, 2, "I", "C3"), (4, 2, "V", "G2"), (6, 1, "V", "G2"), (7, 1, "I", "C3")),
    ))
    assert issues(sustained_bad, "melody_clash")

    # Lament bass i -> v6 -> iv6 -> V in A minor has no harmonic_retrogression
    lament = grade_melody_harmonization(exercise(
        melody((0, 1, "C5"), (1, 1, "B4"), (2, 1, "A4"), (3, 1, "G#4")),
        slots((0, 1, "i", "A2"), (1, 1, "v6", "G2"), (2, 1, "iv6", "F2"), (3, 1, "V", "E2")),
        key_tonic="A", mode="minor",
    ))
    assert not issues(lament, "harmonic_retrogression")

    # V/V -> Cad6/4 -> V and V7/ii -> V7/V -> V are valid syntax
    sec_cad = grade_melody_harmonization(exercise(
        melody((0, 1, "A4"), (1, 1, "G4"), (2, 1, "G4")),
        slots((0, 1, "V/V", "D3"), (1, 1, "Cad6/4", "G2"), (2, 1, "V", "G2")),
    ))
    assert not issues(sec_cad, "unresolved_secondary_dominant")

    # Root-position vii°7 -> i counts as IAC
    lt7 = grade_melody_harmonization(exercise(
        melody((0, 1, "F5"), (1, 1, "E5")),
        slots((0, 1, "vii°7", "G#2"), (1, 1, "i", "A2")),
        key_tonic="A", mode="minor",
    ))
    assert lt7["cadences"][0]["detected"] == "IAC"

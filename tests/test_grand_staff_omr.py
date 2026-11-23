"""Grand-staff recognition and grading checks with original worksheet fixtures."""
from io import BytesIO

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

from app import app
from staff2audio.grand_staff_omr import recognize_worksheet
from staff2audio.omr import FONT_PATH, GLYPHS
from staff2audio.theory.melody_harmonizer import grade_melody_harmonization


class Worksheet:
    space = 18
    blue = (43, 111, 187)
    bright_blue = (117, 191, 255)

    def __init__(self, systems=1, *, border=False, key=-1):
        self.image = Image.new("RGB", (820, 120 + systems * 334), "white")
        self.draw = ImageDraw.Draw(self.image)
        self.font = ImageFont.truetype(str(FONT_PATH), self.space * 4)
        for system in range(systems):
            for staff in ("treble", "bass"):
                bottom = self.y(system, staff, 0)
                top = self.y(system, staff, 8)
                for y in range(top, bottom + 1, self.space):
                    self.draw.line((38, y, 779, y), fill="black", width=2)
                for x in (38, 460, 779):
                    self.draw.line((x, top, x, bottom), fill="black", width=2)
                self.glyph(staff, 47, self.y(system, staff, 2 if staff == "treble" else 6))
                if key == -1:
                    self.glyph("flat", 110, self.y(system, staff, 4 if staff == "treble" else 2))
                self.glyph("4", 145, self.y(system, staff, 6))
                self.glyph("4", 145, self.y(system, staff, 2))
        if border:
            self.draw.rectangle((0, self.image.height - 32, self.image.width - 1, self.image.height), fill="black")
            self.draw.rectangle((self.image.width - 16, 0, self.image.width, self.image.height), fill="black")

    def y(self, system, staff, step):
        return 140 + system * 334 + (160 if staff == "bass" else 0) - step * self.space // 2

    def glyph(self, name, x, y):
        code = 0xE080 + int(name) if name.isdigit() else GLYPHS[name]
        self.draw.text((x, y), chr(code), font=self.font, fill="black", anchor="ls")

    def printed(self, staff, x, step, direction="up", *, system=0, duration=1):
        y = self.y(system, staff, step)
        self.glyph({1: "filled", 2: "half", 4: "whole"}[duration], x - 10, y)
        if duration == 4:
            return
        sx = x + 10 if direction == "up" else x - 9
        self.draw.line((sx, y, sx, y - 58 if direction == "up" else y + 58), fill="black", width=2)

    def pen(self, staff, x, step, direction="up", *, system=0, half=False, sharp=False, color=None):
        color = color or self.blue
        y = self.y(system, staff, step)
        if half:
            self.draw.ellipse((x - 10, y - 6, x + 10, y + 6), outline=color, width=3)
        else:
            self.draw.line((x - 8, y + 4, x + 9, y - 4), fill=color, width=5)
        sx = x + 9 if direction == "up" else x - 8
        tip = (sx + 3, y - 52 if direction == "up" else y + 52)
        self.draw.line((sx, y - 3 if direction == "up" else y + 3, *tip), fill=color, width=3)
        if sharp:
            for a in (x - 32, x - 25):
                self.draw.line((a, y + 10, a + 2, y - 10), fill=color, width=2)
            for b in (y - 4, y + 4):
                self.draw.line((x - 37, b + 2, x - 18, b - 2), fill=color, width=2)
        return tip

    def png(self):
        stream = BytesIO()
        self.image.save(stream, "PNG")
        return stream.getvalue()

    def recognize(self, mode="four_part"):
        return recognize_worksheet(np.asarray(self.image), mode=mode)


@pytest.fixture
def printed_worksheet():
    sheet = Worksheet(border=True)
    for x, steps, duration in ((248, (6, 3, 8, 4), 1), (340, (7, 6, 7, 2), 2), (530, (6, 2, 8, 4), 1)):
        for staff, step, direction in zip(("treble", "treble", "bass", "bass"), steps, ("up", "down") * 2):
            sheet.printed(staff, x, step, direction, duration=duration)
    return sheet


@pytest.fixture
def mixed_worksheet():
    sheet = Worksheet()
    for x in (248, 342, 536):
        sheet.printed("bass", x, 4, "down", duration=2 if x == 536 else 1)
        sheet.pen("bass", x, 8, sharp=x == 342)
        sheet.pen("treble", x, 6, half=x == 536)
        sheet.pen("treble", x, 3, "down")
    # Mark made in the Roman numeral row, well below the playable bass zone.
    sheet.draw.text((350, 380), "IV", fill=sheet.blue)
    return sheet


@pytest.fixture
def melody_worksheet():
    sheet = Worksheet(systems=2, key=0, border=True)
    for system in (0, 1):
        for x, step in zip((245, 355, 510, 580, 645), (2, 4, 5, 4, 2)):
            sheet.printed("treble", x, step, system=system, duration=2 if x in (245, 355, 645) else 1)
        x = (245, 355) if not system else ()
        for attack in x:
            sheet.printed("bass", attack, 3, duration=2)
        for attack, step in zip((510, 580, 645), (4, 5, 3)):
            sheet.pen("bass", attack, step, system=system, half=attack == 645, color=sheet.bright_blue)
    return sheet


def test_printed_polyphonic_columns_preserve_seconds_and_half_notes(printed_worksheet):
    result = printed_worksheet.recognize()
    assert (result["key_signature"], result["key_tonic"], result["key_mode"]) == (-1, "D", "minor")
    assert result["time_signature"] == "4/4"
    assert [(s["treble"]["clef"], s["bass"]["clef"]) for s in result["systems"]] == [("treble", "bass")]
    assert result["exercise_type"] == "free"
    assert result["locked_voices"] == []
    assert [tuple(c["voices"].values()) for c in result["chords"]] == [
        ("D5", "A4", "A3", "D3"), ("E5", "D5", "G3", "Bb2"), ("D5", "G4", "A3", "D3"),
    ]
    assert [c["duration"] for c in result["chords"]] == [1., 2., 1.]
    assert [c["measure"] for c in result["chords"]] == [1, 1, 2]
    assert all(v["source"] == "printed" and not v["missing"]
               for chord in result["chords"] for v in chord["voice_coords"].values())


def test_mixed_layers_lock_printed_bass_and_keep_pen_metadata(mixed_worksheet):
    result = mixed_worksheet.recognize()
    assert result["exercise_type"] == "figured_bass"
    assert result["locked_voices"] == ["B"]
    assert len(result["chords"]) == 3
    for chord in result["chords"]:
        assert chord["given_bass"] == "D3"
        assert chord["voice_coords"]["B"]["source"] == "printed"
        assert chord["voices"]["S"] == "D5"
        assert chord["voices"]["A"] == "A4"
        assert all(chord["voice_coords"][voice]["source"] == "handwritten" for voice in "SAT")
    assert any(note["staff_step"] == 6 and note["duration"] == 2. for note in result["systems"][0]["treble"]["notes"])
    tenor = [c["voices"]["T"] for c in result["chords"]]
    assert tenor == ["A3", "A#3", "A3"]


def test_missing_voices_carry_forward_and_whole_notes_keep_duration():
    sheet = Worksheet(key=0)
    for staff, step, direction in (("treble", 6, "up"), ("treble", 3, "down"),
                                   ("bass", 6, "up"), ("bass", 4, "down")):
        sheet.printed(staff, 248, step, direction)
    sheet.printed("bass", 540, 2, "down", duration=4)
    result = sheet.recognize()
    first, second = result["chords"]
    assert second["duration"] == 4.
    assert second["given_bass"] == "B2"
    for voice in "SAT":
        assert second["voices"][voice] == first["voices"][voice]
        assert second["voice_coords"][voice]["missing"]
        assert second["voice_coords"][voice]["confidence"] == .2


@pytest.mark.parametrize("direction", ["up", "down"])
def test_slanted_pen_beams_split_into_eighth_notes(direction):
    sheet = Worksheet(key=0)
    tips = [sheet.pen("treble", x, step, direction) for x, step in ((248, 6), (290, 5), (332, 4))]
    sheet.draw.line(tips, fill=sheet.blue, width=5)
    result = sheet.recognize("melody")
    assert [(row["pitch"], row["duration"], row["onset"]) for row in result["melody"]] == [
        ("D5", .5, 0.), ("C5", .5, .5), ("B4", .5, 1.),
    ]


def test_melody_systems_align_student_bass_after_given_opening(melody_worksheet):
    result = melody_worksheet.recognize("melody")
    assert len(result["systems"]) == 2
    assert len(result["melody"]) == 10
    assert len(result["harmonization"]) == 8
    assert result["grade_from_onset"] == 4.
    assert [row["onset"] for row in result["harmonization"]] == [0., 2., 4., 5., 6., 12., 13., 14.]
    assert [row["duration"] for row in result["harmonization"]] == [2., 2., 1., 1., 2., 1., 1., 2.]
    assert result["harmonization"][2]["source"] == "handwritten"
    assert [row["measure"] for row in result["melody"]] == [1, 1, 2, 2, 2, 3, 3, 4, 4, 4]
    assert result["phrases"][-1]["end_onset"] == result["melody"][-1]["onset"]


def test_rejects_single_staff_and_invalid_mode():
    worksheet = Worksheet()
    worksheet.draw.rectangle((0, 200, 800, 400), fill="white")
    with pytest.raises(ValueError, match="No grand-staff"):
        worksheet.recognize()
    with pytest.raises(ValueError, match="worksheet mode"):
        worksheet.recognize("other")


def _grading_payload():
    return {
        "key": {"tonic": "C", "mode": "major"},
        "melody": [{"onset": beat, "duration": 1, "pitch": pitch}
                   for beat, pitch in enumerate(("C5", "C5", "D5", "C5"))],
        "harmonization": [{"onset": beat, "duration": 1, "bass": pitch, "roman": roman}
                          for beat, (pitch, roman) in enumerate((("E3", "I"), ("C3", "I"), ("D3", "ii"), ("C3", "I")))],
        "phrases": [{"name": name, "start_onset": start, "end_onset": end, "expected_cadence": "PAC"}
                    for name, start, end in (("Given", 0, 1), ("Student", 1, 3))],
    }


def test_grade_cutoff_keeps_preview_and_the_transition_from_given_music():
    payload = _grading_payload()
    full = grade_melody_harmonization(payload)
    graded = grade_melody_harmonization({**payload, "grade_from_onset": 2})
    assert full["grade_from_onset"] == 0.
    assert graded["grade_from_onset"] == 2.
    assert graded["satb_preview"] == full["satb_preview"]
    assert len(graded["satb_preview"]) == 4
    assert full["summary"]["error_count"] > graded["summary"]["error_count"]
    assert [(row["phrase"], row["onset"]) for row in graded["cadences"]] == [("Student", 3)]
    assert any(row["code"] == "parallel_octaves" and row["chord_index"] == 2
               and row["previous_chord_index"] == 1 for row in graded["issues"])
    assert all(row["chord_index"] is None or row["chord_index"] >= 2 for row in graded["issues"])
    blank_ref = {**payload, "grade_from_onset": 2, "harmonization": [
        {**row, "roman": "" if row["onset"] < 2 else row["roman"]} for row in payload["harmonization"]
    ]}
    inferred = grade_melody_harmonization(blank_ref)
    assert len(inferred["satb_preview"]) == 4
    assert inferred["chords"][0]["roman"] in ("I", "I6", "vi")


@pytest.mark.parametrize("cutoff", [-1, float("inf"), float("nan"), True, "2"])
def test_grade_cutoff_must_be_a_nonnegative_finite_number(cutoff):
    with pytest.raises(ValueError, match="Grade from onset"):
        grade_melody_harmonization({**_grading_payload(), "grade_from_onset": cutoff})


@pytest.mark.parametrize("mode", [None, "four_part", "melody"])
def test_worksheet_upload_modes_and_preview(mode, mixed_worksheet):
    fields = {}
    if mode:
        fields = {"mode": mode, "page": "1"}
    with TestClient(app) as client:
        response = client.post("/api/theory/analyze-worksheet", data=fields,
                               files={"file": ("worksheet.png", mixed_worksheet.png(), "image/png")})
    assert response.status_code == 200
    result = response.json()
    assert result["mode"] == (mode or "four_part")
    assert ("melody" if mode == "melody" else "chords") in result
    assert result["preview"].startswith("data:image/png;base64,")
    assert result["filename"] == "worksheet.png"
    assert result["page"] == result["pages"] == 1
    assert result["elapsed_ms"] >= 0


def test_worksheet_upload_rejects_invalid_mode_image_and_foreign_origin(mixed_worksheet):
    endpoint = "/api/theory/analyze-worksheet"
    files = {"file": ("worksheet.png", mixed_worksheet.png(), "image/png")}
    with TestClient(app) as client:
        assert client.post(endpoint, files=files, data={"mode": "invalid"}).status_code == 422
        bad = client.post(endpoint, files={"file": ("bad.png", b"invalid", "image/png")})
        assert bad.status_code == 422
        assert client.post(endpoint, files=files, headers={"Origin": "https://example.com"}).status_code == 403
        assert client.post("/api/analyze", files=files, data={"mode": "melody"}).status_code == 422

"""End-to-end recognition checks on original, redistributable notation."""
import cv2
import numpy as np
import pytest

from staff2audio.music import key_accidentals, midi_pitch, staff_pitch
from staff2audio.omr import recognize
from tools.generate_fixtures import make_score,make_demo_image


def test_music_theory_helpers():
    assert staff_pitch(0,"treble")==("E",4)
    assert staff_pitch(-2,"treble")==("C",4)
    assert staff_pitch(0,"bass")==("G",2)
    assert staff_pitch(8,"bass")==("A",3)
    assert key_accidentals(3)=={"F":1,"C":1,"G":1}
    assert key_accidentals(-3)=={"B":-1,"E":-1,"A":-1}
    assert midi_pitch("B",3,-1)==58


def test_rejects_blank_and_too_small_images():
    with pytest.raises(ValueError,match="No five-line"):
        recognize(np.full((600,800,3),255,np.uint8))
    with pytest.raises(ValueError,match="too small"):
        recognize(np.full((40,40,3),255,np.uint8))


def test_public_demo_against_independent_transcription():
    actual=recognize(make_demo_image())["staffs"]
    assert [(s["clef"],s["key_signature"],s["time_signature"]) for s in actual]==[("treble",-3,"4/4"),("bass",2,"6/8")]
    assert [e["midi"] for e in actual[0]["events"]]==[60,63,65,67,70,68,67,63]
    assert [e["duration"] for e in actual[0]["events"]]==[1,.5,.5,2,1,1,1,1]
    assert [e["midi"] for e in actual[1]["events"]]==[43,47,50,49,47,45,43,42]
    assert [e["duration"] for e in actual[1]["events"]]==[.5,.5,.5,1.5,.5,.5,.5,1.5]


@pytest.mark.parametrize("clef,key",[("treble",0),("treble",-3),("bass",3)])
def test_diatonic_pitches_ledgers_clef_and_key(clef,key):
    spec={"clef":clef,"key":key,"meter":"4/4",
          "notes":[{"step":n,"duration":1} for n in (-2,0,1,2,4,6,8,10)]}
    image,expected=make_score([spec])
    result=recognize(image)["staffs"]
    assert len(result)==1
    assert result[0]["clef"]==clef
    assert result[0]["key_signature"]==key
    assert [e["midi"] for e in result[0]["events"]]==[e["midi"] for e in expected[0]["events"]]


def test_beamed_rhythm_dots_hollow_heads_and_rests():
    spec={"clef":"treble","key":0,"meter":"4/4","notes":[
        {"step":0,"duration":.5,"beam":"a"},{"step":1,"duration":.5,"beam":"a"},
        {"step":2,"duration":.25,"beam":"b"},{"step":3,"duration":.25,"beam":"b"},
        {"step":4,"duration":1,"dotted":True}, {"step":None,"duration":1},
        {"step":2,"duration":2},{"step":0,"duration":4}]}
    image,expected=make_score([spec])
    actual=recognize(image)["staffs"][0]["events"]
    assert [e["midi"] for e in actual]==[e["midi"] for e in expected[0]["events"]]
    assert [e["duration"] for e in actual]==[e["duration"] for e in expected[0]["events"]]


def test_accidentals_persist_for_octave_and_reset_at_barline():
    spec={"clef":"treble","key":1,"meter":"4/4","notes":[
        {"step":1,"duration":1,"accidental":0},{"step":1,"duration":1},
        {"step":8,"duration":1},{"step":1,"duration":1,"bar":True},
        {"step":2,"duration":1,"accidental":-1},{"step":2,"duration":1}]}
    image,expected=make_score([spec])
    actual=recognize(image)["staffs"][0]["events"]
    assert [e["midi"] for e in actual]==[e["midi"] for e in expected[0]["events"]]


def test_isolated_flags_above_and_below_staff_with_slurs():
    spec={"clef":"treble","key":0,"meter":"4/4","slurs":[(0,3,"above"),(4,7,"below")],"notes":[
        {"step":0,"duration":1,"stem":"up"},{"step":1,"duration":.5,"stem":"up"},
        {"step":2,"duration":.25,"stem":"up"},{"step":3,"duration":1,"stem":"up"},
        {"step":8,"duration":1,"stem":"down"},{"step":7,"duration":.5,"stem":"down"},
        {"step":6,"duration":.25,"stem":"down"},{"step":5,"duration":1,"stem":"down"}]}
    image,_=make_score([spec])
    actual=recognize(image)["staffs"][0]["events"]
    assert [e["duration"] for e in actual]==[1,.5,.25,1,1,.5,.25,1]


def test_whole_and_half_rests_are_isolated_from_beams():
    spec={"clef":"bass","key":0,"meter":"4/4","notes":[
        {"step":6,"duration":.5,"beam":"a"},{"step":8,"duration":.5,"beam":"a"},
        {"step":None,"duration":2},{"step":None,"duration":4},
        {"step":2,"duration":1}]}
    image,_=make_score([spec])
    actual=recognize(image)["staffs"][0]["events"]
    assert [e["midi"] for e in actual]==[53,57,None,None,47]
    assert [e["duration"] for e in actual]==[.5,.5,2,4,1]


def test_low_contrast_jpeg_preserves_demo_notes():
    image=make_demo_image()
    faded=(image.astype(np.float32)*.45+130).clip(0,255).astype(np.uint8)
    ok,encoded=cv2.imencode(".jpg",cv2.cvtColor(faded,cv2.COLOR_RGB2BGR),[cv2.IMWRITE_JPEG_QUALITY,76])
    assert ok
    decoded=cv2.cvtColor(cv2.imdecode(encoded,cv2.IMREAD_COLOR),cv2.COLOR_BGR2RGB)
    actual=recognize(decoded)["staffs"]
    assert [[e["midi"] for e in s["events"]] for s in actual]==[[60,63,65,67,70,68,67,63],[43,47,50,49,47,45,43,42]]
    assert [[e["duration"] for e in s["events"]] for s in actual]==[[1,.5,.5,2,1,1,1,1],[.5,.5,.5,1.5,.5,.5,.5,1.5]]


@pytest.mark.parametrize("factor",[.65,1.4])
def test_resizing_preserves_independent_staves_and_pitch(factor):
    image=make_demo_image()
    original=recognize(image)["staffs"]
    resized=cv2.resize(image,None,fx=factor,fy=factor,interpolation=cv2.INTER_AREA)
    result=recognize(resized)["staffs"]
    assert len(result)==len(original)==2
    assert [s["clef"] for s in result]==["treble","bass"]
    assert [[e["midi"] for e in s["events"]] for s in result]==[[e["midi"] for e in s["events"]] for s in original]
    assert [[e["duration"] for e in s["events"]] for s in result]==[[e["duration"] for e in s["events"]] for s in original]
    assert all(0<=e["x"]<resized.shape[1] and 0<=e["y"]<resized.shape[0]
               for staff in result for e in staff["events"])

"""Generate original, synthetic scores. No private source music is embedded here.

Run ``python -m tools.generate_fixtures`` to write the public demo into tmp/.
The glyph font is Steinberg Bravura (SIL Open Font License, bundled separately).
"""
from __future__ import annotations

from pathlib import Path
import json

import numpy as np
from PIL import Image,ImageDraw,ImageFont

from staff2audio.omr import FONT_PATH,GLYPHS
from staff2audio.music import key_accidentals,midi_pitch,pitch_name,staff_pitch


def make_score(staves: list[dict], *, space: int = 20, width: int = 1600,
               title: str = "A little sight-reading") -> tuple[np.ndarray,list[dict]]:
    """Draw declarative monophonic fixtures; step 0 denotes a staff's bottom line.

    Notes use ``step,duration,accidental`` (None for a rest). Consecutive eighths
    may be joined by specifying the same ``beam`` name. ``bar`` adds a barline
    before the note. Expected pitches/durations derive from musical semantics.
    """
    d=space
    margin=round(d*3)
    row_height=round(d*12)
    canvas=Image.new("RGB",(width,round(d*5)+row_height*len(staves)),"white")
    draw=ImageDraw.Draw(canvas)
    font=ImageFont.truetype(str(FONT_PATH),round(d*4))
    def label_font(size,bold=False):
        for path in (("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
                     ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")):
            try:
                return ImageFont.truetype(path,round(size))
            except OSError:
                pass
        return ImageFont.load_default(size=round(size))
    textfont=label_font(d*1.15)
    titlefont=label_font(d*1.9,True)
    draw.text((margin,d*.9),title,font=titlefont,fill="#18312f")
    expected=[]

    def glyph(name,x,y):
        code=0xE080+int(name) if name.isdigit() else GLYPHS[name]
        draw.text((round(x),round(y)),chr(code),font=font,fill="black",anchor="ls")

    for si,staff in enumerate(staves):
        top=round(d*6+si*row_height)
        bottom=top+4*d
        left,right=margin,width-margin
        clef=staff.get("clef","treble")
        key=staff.get("key",0)
        meter=staff.get("meter","4/4")
        for line in range(5):
            draw.line((left,top+line*d,right,top+line*d),fill="black",width=max(1,round(d*.065)))
        glyph(clef,left+d*.4,top+(3*d if clef=="treble" else d))
        x=left+d*4.1
        positions=([8,5,9,6,3,7,4] if clef=="treble" else [6,3,7,4,1,5,2]) if key>0 else ([4,7,3,6,2,5,1] if clef=="treble" else [2,5,1,4,0,3,-1])
        for step in positions[:abs(key)]:
            glyph("sharp" if key>0 else "flat",x,bottom-step*d/2)
            x+=d*.95
        x+=d*.45
        a,b=meter.split("/")
        glyph(a,x,top+d)
        glyph(b,x,top+3*d)
        x+=d*2.9
        notes=staff["notes"]
        gap=(right-x-d*3)/max(len(notes)-1,1)
        rendered=[]
        scope={}
        ev=[]
        onset=0.
        for ni,note in enumerate(notes):
            nx=x+ni*gap
            if note.get("bar"):
                draw.line((nx-gap*.48,top,nx-gap*.48,bottom),fill="black",width=max(1,round(d*.075)))
                scope={}
            step=note.get("step")
            duration=note["duration"]
            dotted=bool(note.get("dotted",False))
            if step is None:
                glyph({4:"rest_whole",2:"rest_half",1:"rest_quarter",.5:"rest_eighth",.25:"rest_sixteenth"}[duration],nx,top+2*d)
                midi,name=None,"Rest"
                ny=top+2*d
            else:
                ny=bottom-step*d/2
                # Ledger lines run through every other diatonic step outside the staff.
                for ledger in range(-2,step-1,-2) if step<0 else range(10,step+1,2):
                    ly=bottom-ledger*d/2
                    draw.line((nx-d*.35,ly,nx+d*1.6,ly),fill="black",width=max(1,round(d*.065)))
                if "accidental" in note:
                    alter=note["accidental"]
                    glyph({-1:"flat",0:"natural",1:"sharp",2:"double_sharp"}[alter],nx-d*1.3,ny)
                    letter,octave=staff_pitch(step,clef)
                    scope[(letter,octave)]=alter
                glyph("whole" if duration==4 else "half" if duration==2 else "filled",nx,ny)
                letter,octave=staff_pitch(step,clef)
                alter=scope.get((letter,octave),key_accidentals(key).get(letter,0))
                midi=midi_pitch(letter,octave,alter)
                name=pitch_name(letter,octave,alter)
            if dotted:
                doty=ny-d*.5 if step is not None and step%2==0 else ny
                draw.ellipse((nx+d*1.7,doty-d*.13,nx+d*1.96,doty+d*.13),fill="black")
            rendered.append({**note,"x":nx,"y":ny,"duration":duration})
            length=duration*(1.5 if dotted else 1)
            ev.append({"midi":midi,"name":name,"duration":length,"onset":onset})
            onset+=length
        # Beamed groups have a shared stem tip and horizontal beams.
        groups={}
        for note in rendered:
            if note.get("step") is not None and note["duration"]<4:
                if note.get("beam"):
                    groups.setdefault(note["beam"],[]).append(note)
                else:
                    groups[id(note)]=[note]
        for group in groups.values():
            direction=group[0].get("stem", "up" if sum(n["step"] for n in group)/len(group)<4 else "down")
            up=direction=="up"
            tip=min(n["y"] for n in group)-d*3.35 if up else max(n["y"] for n in group)+d*3.35
            stemxs=[]
            for note in group:
                sx=note["x"]+d*1.15 if up else note["x"]+d*.04
                stemxs.append(sx)
                draw.line((sx,note["y"]-d*.05,sx,tip),fill="black",width=max(1,round(d*.095)))
                if len(group)==1 and note["duration"]<1:
                    flag={.5:"8",.25:"16",.125:"32"}[note["duration"]]
                    glyph(f"flag{flag}_{'up' if up else 'down'}",sx,tip)
            if len(group)>1:
                count=min(round(-np.log2(n["duration"])) for n in group)
                for beam in range(count):
                    by=tip+(d*.68*beam if up else -d*.68*beam)
                    draw.line((stemxs[0],by,stemxs[-1],by),fill="black",width=round(d*.33))
        for first,last,side in staff.get("slurs",[]):
            first_note,last_note=rendered[first],rendered[last]
            x0,x1=first_note["x"]+d*.6,last_note["x"]+d*.6
            above=side=="above"
            y0,y1=first_note["y"]+(-d if above else d),last_note["y"]+(-d if above else d)
            control_y=top-d*3.2 if above else bottom+d*3.2
            points=[]
            for t in np.linspace(0,1,160):
                points.append(((1-t)*x0+t*x1,(1-t)**2*y0+2*(1-t)*t*control_y+t*t*y1))
            draw.line(points,fill="black",width=max(1,round(d*.14)))
        draw.line((right-d*.4,top,right-d*.4,bottom),fill="black",width=max(1,round(d*.08)))
        draw.line((right,top,right,bottom),fill="black",width=max(2,round(d*.25)))
        draw.text((left,bottom+d*3.5),staff.get("label",f"Melody {si+1} · {clef} clef"),font=textfont,fill="#52605e")
        expected.append({"clef":clef,"key_signature":key,"time_signature":meter,"events":ev})
    return np.array(canvas),expected


def make_demo_image() -> np.ndarray:
    """Two original practice lines, free to copy and redistribute."""
    staves=[
        {"clef":"treble","key":-3,"meter":"4/4","label":"1. E-flat major · an original practice melody",
         "notes":[{"step":-2,"duration":1},{"step":0,"duration":.5,"beam":"a"},
                  {"step":1,"duration":.5,"beam":"a"},{"step":2,"duration":2},
                  {"step":4,"duration":1,"bar":True},{"step":3,"duration":1},
                  {"step":2,"duration":1},{"step":0,"duration":1}]},
        {"clef":"bass","key":2,"meter":"6/8","label":"2. D major · compound meter in the bass clef",
         "notes":[{"step":0,"duration":.5,"beam":"a"},{"step":2,"duration":.5,"beam":"a"},
                  {"step":4,"duration":.5,"beam":"a"},{"step":3,"duration":1,"dotted":True},
                  {"step":2,"duration":.5,"beam":"b","bar":True},
                  {"step":1,"duration":.5,"beam":"b"},{"step":0,"duration":.5,"beam":"b"},
                  {"step":-1,"duration":1,"dotted":True}]},
    ]
    return make_score(staves,title="Two melodies for a quiet afternoon")[0]


if __name__=="__main__":
    target=Path("tmp")
    target.mkdir(exist_ok=True)
    Image.fromarray(make_demo_image()).save(target/"demo-score.png")
    print(target/"demo-score.png")

# Integration contract

Backend Python FastAPI, static HTML/CSS/ES modules, no frontend build.
Recognition implementation: staff2audio/omr.py and staff2audio/music.py. Synthetic fixtures live in tools/generate_fixtures.py.
Function recognize(image: numpy RGB uint8 array) -> dict. Caller handles image/PDF decoding, page selection, storing previews. Returned coordinates refer to passed image.
Result:
{width,height,staffs:[{id:int,box:[x,y,w,h],lines:[y1,...,y5],clef:'treble'|'bass',key_signature:int (-7..7),key_name:str,time_signature:str,confidence:float,events:[{id:str,midi:int|null,name:str,onset:float,duration:float,x:float,y:float,confidence:float}]}],warnings:[str],engine:str}
Each staff is individually playable; onsets and durations in quarter-note beats, rests midi=null. No hidden hardcoded answers for supplied images. Clean monophonic printed music target. If unsure, disclose through warnings/confidence. Optional fields OK. Expose errors as ValueError human-readable.
Piano implementation: static/piano.js, static/audio/*; tests/audio.test.mjs exercises scheduling and exports. Export class PianoPlayer: constructor({onNote,onProgress,onState}), async load(), async play(events,{tempo=90,transpose=0,fromBeat=0,loop=false}={}), pause(), stop(), seek(beat), setVolume(value 0..1), get currentBeat(), get duration(), async preview(midi), async exportWav(events,{tempo,transpose}): Blob, exportMidi(events,{tempo,transpose}): Blob. onNote(event|null) and onProgress(beat,total), onState('playing'|'paused'|'stopped'). play schedules fromBeat; pause maintains beat; stop resets. Actual local grand piano samples preferred with licensed attribution. Can provide extra pure helpers for tests. No external requests at runtime.
app.py owns decoding and HTTP bounds. static/app.js owns the browser flow. static/score.js reinterprets clef/key while preserving manual pitches and explicit/measure accidentals; see tests/score.test.mjs.

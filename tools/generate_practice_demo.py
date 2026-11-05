"""Original sharp/flat practice examples for reproducible UI verification."""
from pathlib import Path
from PIL import Image
from tools.generate_fixtures import make_score


def make_practice_demo():
    staves = [
        {"clef": "treble", "key": 3, "meter": "4/4", "label": "A major: keep the sharps in the scale",
         "notes": [{"step": -2, "duration": 1}, {"step": 0, "duration": .5, "beam": "a"},
                   {"step": 1, "duration": .5, "beam": "a"}, {"step": 2, "duration": 2},
                   {"step": 4, "duration": 1, "bar": True}, {"step": 3, "duration": 1},
                   {"step": 2, "duration": 1}, {"step": 0, "duration": 1}]},
        {"clef": "treble", "key": -2, "meter": "6/8", "label": "B-flat major: subdivide the dotted-quarter beat",
         "notes": [{"step": -1, "duration": .5, "beam": "b"},
                   {"step": 0, "duration": .25, "beam": "c"}, {"step": 1, "duration": .25, "beam": "c"},
                   {"step": 2, "duration": .5, "beam": "d"}, {"step": 3, "duration": 1, "dotted": True},
                   {"step": 4, "duration": .5, "beam": "e", "bar": True},
                   {"step": 3, "duration": .5, "beam": "e"}, {"step": 2, "duration": .5, "beam": "e"},
                   {"step": 1, "duration": 1, "dotted": True}]}
    ]
    return make_score(staves, title="A steady pulse, a clear melody")[0]


if __name__ == "__main__":
    target = Path("tmp/practice-tempo-demo.png")
    target.parent.mkdir(exist_ok=True)
    Image.fromarray(make_practice_demo()).save(target)
    print(target)

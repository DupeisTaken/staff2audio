"""Original six-page regression PDF: blank covers and four music pages."""
from pathlib import Path
import io

import fitz
from PIL import Image
from tools.generate_practice_demo import make_practice_demo


def make_pdf():
    image = make_practice_demo()
    png = io.BytesIO()
    Image.fromarray(image).save(png, format="PNG")
    with fitz.open() as document:
        cover = document.new_page(width=800, height=600)
        cover.insert_text((60, 90), "Original practice collection", fontsize=24)
        cover.insert_text((60, 130), "This cover intentionally contains no staff.", fontsize=14)
        for number in range(2, 6):
            page = document.new_page(width=800, height=360)
            page.insert_image(fitz.Rect(0, 20, 800, 310), stream=png.getvalue())
            page.insert_text((30, 340), f"Original regression music page {number}", fontsize=10)
        document.new_page(width=800, height=600)
        return document.tobytes()


if __name__ == "__main__":
    target = Path("tmp/multipage-practice.pdf")
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(make_pdf())
    print(target)

# -*- coding: utf-8 -*-
"""Draw the default social sharing image, site/assets/img/og/rayhab-share.jpg.

1200 x 630, the size Facebook, LinkedIn, WhatsApp and X all crop well. It is
built from the site's own assets, so it changes only when they do: the forest
ground, the wordmark, the home hero's headline in Bricolage Grotesque with
"Scoliosis" in spring green, the locations line in Public Sans, and the
founder's cut-out portrait.

Run by hand when the brand assets change; the result is committed. Needs
Pillow, and fontTools with brotli to read the site's woff2 fonts.
"""
import io
import os

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.normpath(os.path.join(HERE, "..", "site"))
OUT = os.path.join(SITE, "assets", "img", "og", "rayhab-share.jpg")

W, H = 1200, 630
FOREST_900 = (14, 42, 23)
FOREST_850 = (18, 48, 24)
BONE = (245, 243, 236)
SPRING = (98, 227, 107)
ON_DARK = (180, 199, 184)


def font(woff2, size, axes):
    """The site's variable woff2, as a TrueType PIL can draw with."""
    t = TTFont(os.path.join(SITE, "assets", "fonts", woff2))
    t.flavor = None
    buf = io.BytesIO()
    t.save(buf)
    buf.seek(0)
    f = ImageFont.truetype(buf, size)
    f.set_variation_by_axes(axes)
    return f


def main():
    img = Image.new("RGB", (W, H), FOREST_900)

    # A soft lift of colour behind the portrait, as on the dark heroes.
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).ellipse((620, 40, 1260, 680), fill=150)
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    img.paste(Image.new("RGB", (W, H), FOREST_850), (0, 0), glow)

    # Founder portrait, a transparent cut-out, standing on the bottom edge.
    face = Image.open(os.path.join(SITE, "assets", "img", "team", "rayan.webp")).convert("RGBA")
    ph = 600
    face = face.resize((round(face.width * ph / face.height), ph), Image.LANCZOS)
    img.paste(face, (W - face.width - 40, H - ph), face)

    # Wordmark: its alpha is the shape, painted in bone like the site's nav.
    mark = Image.open(os.path.join(SITE, "assets", "img", "rayhab-wordmark.png")).convert("RGBA")
    mw = 190
    mark = mark.resize((mw, round(mark.height * mw / mark.width)), Image.LANCZOS)
    img.paste(Image.new("RGB", mark.size, BONE), (72, 70), mark.split()[3])

    d = ImageDraw.Draw(img)
    head = font("bricolage-grotesque-latin.woff2", 76, [96, 700])
    body = font("public-sans-latin.woff2", 28, [400])
    y = 210
    d.text((72, y), "Scoliosis", font=head, fill=SPRING)
    d.text((72, y + 80), "Specialist &", font=head, fill=BONE)
    d.text((72, y + 160), "Sports Rehab", font=head, fill=BONE)
    d.text((74, y + 270), "Movement clinic · Beirut · Aley · Online", font=body, fill=ON_DARK)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT, "JPEG", quality=86, optimize=True, progressive=True)
    print("wrote %s (%d bytes)" % (os.path.relpath(OUT, SITE), os.path.getsize(OUT)))


if __name__ == "__main__":
    main()

"""Draw the Android launcher icons (android/app/src/main/res/mipmap-*): a golf flag on a green, drawn from shapes
(nothing taken from the game). Writes ic_launcher.png (legacy, round green) per density and ic_launcher_fg.png
(the adaptive icon's foreground; the background is drawable/ic_launcher_bg.xml).
usage: make_android_icons.py"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")
SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
S = 432                                       # drawing size (the adaptive foreground canvas is 108 dp = 4 x 27)


def flag(d, k):
    """The flag in a 108-unit box, k = pixels per unit (the safe zone is the middle 66 units)."""
    u = lambda v: v * k
    d.ellipse([u(30), u(70), u(78), u(82)], fill=(30, 90, 34))            # the hole's shadow on the green
    d.ellipse([u(46), u(73), u(62), u(79)], fill=(16, 40, 18))            # the cup
    d.rectangle([u(53), u(28), u(56), u(76)], fill=(245, 245, 240))         # the pin
    d.polygon([(u(56), u(28)), (u(80), u(36)), (u(56), u(45))], fill=(229, 57, 53))   # the flag
    d.ellipse([u(36), u(60), u(46), u(70)], fill=(255, 255, 255), outline=(200, 200, 200), width=max(1, int(k)))   # the ball


def main():
    fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    flag(ImageDraw.Draw(fg), S / 108)
    legacy = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(legacy)
    d.ellipse([0, 0, S - 1, S - 1], fill=(76, 160, 72))
    d.ellipse([S * 0.08, S * 0.08, S * 0.92, S * 0.92], fill=(98, 184, 84))
    inner = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    flag(ImageDraw.Draw(inner), S / 108)
    legacy.alpha_composite(inner)
    for name, px in SIZES.items():
        out = os.path.join(RES, "mipmap-" + name)
        os.makedirs(out, exist_ok=True)
        legacy.resize((px, px), Image.LANCZOS).save(os.path.join(out, "ic_launcher.png"))
        fg.resize((px * 9 // 4, px * 9 // 4), Image.LANCZOS).save(os.path.join(out, "ic_launcher_fg.png"))
    print("icons in", RES)


if __name__ == "__main__":
    main()

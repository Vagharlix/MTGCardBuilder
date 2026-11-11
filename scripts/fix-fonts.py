"""Removes TrueType hinting from card fonts that WebKit cannot render.

mplantin.ttf (rules text) ships hinting bytecode that makes FreeType return
empty glyphs in WebKitGTK/WKWebView (Linux and macOS apps): text drawn with
it is invisible there, while Chromium (Windows, Android) shows it. Hinting is
useless for these large anti-aliased canvas renders, so it is dropped.

Usage: python3 scripts/fix-fonts.py   (needs: pip install fonttools)
"""
import os
from fontTools.ttLib import TTFont

FONTS = ['mplantin.ttf']
HINTING_TABLES = ['fpgm', 'prep', 'cvt ', 'gasp']

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'fonts')
for name in FONTS:
    path = os.path.join(root, name)
    font = TTFont(path)
    removed = [t for t in HINTING_TABLES if t in font]
    for t in removed:
        del font[t]
    # also clear per-glyph instructions
    if 'glyf' in font:
        for g in font['glyf'].glyphs.values():
            if hasattr(g, 'program'):
                g.program.fromBytecode(b'')
    font.save(path)
    print(name, 'removed:', removed or 'nothing')

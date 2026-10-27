# -*- coding: utf-8 -*-
"""GateLink 小程序图标生成器。
全部自生产线性图标，不使用 emoji，不依赖第三方图标库。
用法：python generate-icons.py
输出：../miniprogram/assets/icons/*.png
"""

import os
from PIL import Image, ImageDraw

S = 4                 # 超采样倍数
N = 81 * S            # 画布 81px @3x
LW = 6 * S            # 线宽 6px（2pt @3x）

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   '..', 'miniprogram', 'assets', 'icons')

GRAY = (142, 142, 147, 255)
BLUE = (0, 122, 255, 255)


def canvas():
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def scale(pts):
    return [(x * S, y * S) for x, y in pts]


def stroke(d, pts, color, width=LW, dots=True):
    p = scale(pts)
    d.line(p, fill=color, width=width, joint='curve')
    if dots:
        r = width / 2.0
        for x, y in p:
            d.ellipse([x - r, y - r, x + r, y + r], fill=color)


def poly_outline(d, pts, color, width=LW):
    stroke(d, pts + [pts[0]], color, width)


def poly_fill(d, pts, color):
    d.polygon(scale(pts), fill=color)


def circle(d, cx, cy, r, color, width=LW):
    r = r * S
    cx, cy = cx * S, cy * S
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=width)


def dot(d, cx, cy, r, color):
    r = r * S
    cx, cy = cx * S, cy * S
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)


def arc(d, bbox, start, end, color, width=LW):
    b = [v * S for v in bbox]
    d.arc(b, start, end, fill=color, width=width)


def save(img, name):
    img = img.resize((81, 81), Image.LANCZOS)
    img.save(os.path.join(OUT, name), 'PNG')
    return name


def rect1(d, x, y, w, h, color, width=LW):
    x, y, w, h = x * S, y * S, w * S, h * S
    d.rectangle([x, y, x + w, y + h], outline=color, width=width)


# ---------- 图标定义 ----------

def home(color):
    img, d = canvas()
    stroke(d, [(18, 40), (40, 20), (62, 40)], color)
    stroke(d, [(26, 38), (26, 62), (54, 62), (54, 38)], color)
    stroke(d, [(34, 62), (34, 48), (46, 48), (46, 62)], color, width=int(LW * 0.8))
    return img


def chart(color):
    img, d = canvas()
    stroke(d, [(24, 54), (24, 38)], color)
    stroke(d, [(40, 54), (40, 24)], color)
    stroke(d, [(56, 54), (56, 32)], color)
    stroke(d, [(18, 60), (62, 60)], color)
    return img


def user(color):
    img, d = canvas()
    circle(d, 40, 27, 11, color)
    arc(d, (13, 42, 67, 76), 180, 360, color)
    return img


def plus(color):
    img, d = canvas()
    stroke(d, [(40, 22), (40, 58)], color)
    stroke(d, [(22, 40), (58, 40)], color)
    return img


def chevron_right(color):
    img, d = canvas()
    stroke(d, [(33, 24), (50, 40), (33, 56)], color)
    return img


def chevron_left(color):
    img, d = canvas()
    stroke(d, [(47, 24), (30, 40), (47, 56)], color)
    return img


def qr(color):
    img, d = canvas()
    rect1(d, 18, 18, 16, 16, color, width=int(LW * 0.9))
    rect1(d, 47, 18, 16, 16, color, width=int(LW * 0.9))
    rect1(d, 18, 47, 16, 16, color, width=int(LW * 0.9))
    dot(d, 55, 55, 3.4, color)
    dot(d, 63, 55, 3.4, color)
    dot(d, 55, 63, 3.4, color)
    dot(d, 47, 63, 3.4, color)
    dot(d, 63, 63, 3.4, color)
    dot(d, 63, 47, 3.4, color)
    stroke(d, [(40, 20), (40, 34)], color, width=int(LW * 0.7), dots=False)
    stroke(d, [(20, 40), (34, 40)], color, width=int(LW * 0.7), dots=False)
    return img


def edit(color):
    img, d = canvas()
    poly_outline(d, [(24, 57), (43, 38), (52, 47), (33, 66)], color)
    stroke(d, [(43, 38), (52, 47)], color, dots=False)
    stroke(d, [(48, 24), (58, 34)], color, width=int(LW * 0.8))
    return img


def trash(color):
    img, d = canvas()
    stroke(d, [(36, 22), (44, 22)], color)
    stroke(d, [(22, 30), (58, 30)], color)
    stroke(d, [(28, 30), (30, 62), (50, 62), (52, 30)], color)
    stroke(d, [(37, 40), (39, 56)], color, width=int(LW * 0.8))
    stroke(d, [(45, 40), (43, 56)], color, width=int(LW * 0.8))
    return img


def pause(color):
    img, d = canvas()
    stroke(d, [(31, 24), (31, 56)], color)
    stroke(d, [(49, 24), (49, 56)], color)
    return img


def play(color):
    img, d = canvas()
    poly_outline(d, [(31, 22), (31, 58), (57, 40)], color)
    return img


def share(color):
    img, d = canvas()
    stroke(d, [(40, 18), (40, 42)], color)
    poly_outline(d, [(28, 30), (40, 18), (52, 30)], color)
    stroke(d, [(24, 46), (56, 46), (56, 64), (24, 64), (24, 46)], color)
    return img


def download(color):
    img, d = canvas()
    stroke(d, [(40, 20), (40, 48)], color)
    poly_outline(d, [(26, 36), (40, 50), (54, 36)], color)
    stroke(d, [(22, 62), (58, 62)], color)
    return img


def copy(color):
    img, d = canvas()
    stroke(d, [(30, 24), (58, 24), (58, 52)], color)
    poly_outline(d, [(20, 34), (48, 34), (48, 64), (20, 64)], color)
    return img


def close(color):
    img, d = canvas()
    stroke(d, [(27, 27), (54, 54)], color)
    stroke(d, [(54, 27), (27, 54)], color)
    return img


def check(color):
    img, d = canvas()
    stroke(d, [(22, 42), (34, 55), (60, 27)], color)
    return img


def warning(color):
    img, d = canvas()
    poly_outline(d, [(40, 16), (63, 57), (17, 57)], color, width=int(LW * 1.05))
    stroke(d, [(40, 31), (40, 45)], color, width=int(LW * 0.95), dots=False)
    dot(d, 40, 51, 3.6, color)
    return img


def camera(color):
    img, d = canvas()
    poly_outline(d, [(18, 30), (26, 24), (34, 30)], color, width=int(LW * 0.85))
    poly_outline(d, [(18, 26), (18, 60), (62, 60), (62, 26)], color)
    circle(d, 40, 43, 10, color, width=int(LW * 0.85))
    return img


def eye(color):
    img, d = canvas()
    arc(d, (14, 24, 66, 58), 180, 360, color)
    arc(d, (14, 24, 66, 58), 0, 180, color)
    circle(d, 40, 41, 9, color, width=int(LW * 0.85))
    return img


def drag(color):
    img, d = canvas()
    for y in (26, 40, 54):
        for x in (29, 51):
            dot(d, x, y, 3.4, color)
    return img


def link(color):
    img, d = canvas()
    circle(d, 29, 40, 13, color, width=int(LW * 0.85))
    circle(d, 51, 40, 13, color, width=int(LW * 0.85))
    stroke(d, [(36, 40), (44, 40)], color, width=int(LW * 0.75), dots=False)
    return img


def refresh(color):
    img, d = canvas()
    arc(d, (16, 16, 64, 64), 30, 330, color)
    poly_outline(d, [(50, 14), (64, 14), (64, 28)], color, width=int(LW * 0.85))
    return img


def empty_illustration(color):
    """空状态插画，画布 240x240"""
    size = 240
    ss = 3
    img = Image.new('RGBA', (size * ss, size * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    global S
    old = S
    S = ss
    lw = int(4 * ss)
    poly_outline(d, [(40, 78), (120, 40), (200, 78), (200, 140), (120, 178), (40, 140)], color, lw)
    stroke(d, [(40, 78), (40, 140)], color, lw)
    stroke(d, [(120, 78), (120, 178)], color, lw)
    stroke(d, [(200, 78), (200, 140)], color, lw)
    stroke(d, [(84, 190), (84, 206)], color, lw)
    stroke(d, [(112, 198), (112, 206)], color, lw)
    S = old
    return img.resize((size, size), Image.LANCZOS)


ICONS = [home, chart, user, plus, chevron_right, chevron_left, qr, edit, trash,
         pause, play, share, download, copy, close, check, warning, camera,
         eye, drag, link, refresh]

NAMES = {home: 'home', chart: 'chart', user: 'user', plus: 'plus',
         chevron_right: 'chevron-right', chevron_left: 'chevron-left',
         qr: 'qr', edit: 'edit', trash: 'trash', pause: 'pause', play: 'play',
         share: 'share', download: 'download', copy: 'copy', close: 'close',
         check: 'check', warning: 'warning', camera: 'camera', eye: 'eye',
         drag: 'drag', link: 'link', refresh: 'refresh'}


def main():
    os.makedirs(OUT, exist_ok=True)
    made = []
    for fn in ICONS:
        n = NAMES[fn]
        save(fn(GRAY), 'icon-%s.png' % n)
        made.append('icon-%s.png' % n)
    for fn in (home, chart, user):
        n = NAMES[fn]
        save(fn(BLUE), 'tabbar-%s-active.png' % n)
        save(fn(GRAY), 'tabbar-%s.png' % n)
        made.append('tabbar-%s.png' % n)
        made.append('tabbar-%s-active.png' % n)
    e = empty_illustration((198, 198, 201, 255))
    e.save(os.path.join(OUT, 'illustration-empty.png'), 'PNG')
    made.append('illustration-empty.png')
    print('generated %d files -> %s' % (len(made), os.path.abspath(OUT)))
    for m in made:
        p = os.path.join(OUT, m)
        print('  %-28s %5d B' % (m, os.path.getsize(p)))


if __name__ == '__main__':
    main()

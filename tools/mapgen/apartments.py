import os
HERE = os.path.dirname(os.path.abspath(__file__))
P = lambda name: os.path.join(HERE, name)
from PIL import Image, ImageDraw, ImageFont, ImageFilter
SRC = Image.open(P('town-original.webp')).convert('RGB')
FONT = '/System/Library/Fonts/Supplemental/Georgia Bold.ttf'

def sign(dr, cx, top, text, size, minw=0):
    f = ImageFont.truetype(FONT, size)
    tw = dr.textlength(text, font=f)
    w = max(minw, tw + 16); h = size + 7
    dr.rounded_rectangle([cx - w / 2 - 2, top - 2, cx + w / 2 + 2, top + h + 2], radius=3, fill=(84, 52, 24))
    dr.rounded_rectangle([cx - w / 2, top, cx + w / 2, top + h], radius=2, fill=(140, 88, 38))
    dr.line([(cx - w / 2 + 2, top + 1), (cx + w / 2 - 2, top + 1)], fill=(170, 112, 52))
    dr.text((cx - tw / 2 + 1, top + 1), text, font=f, fill=(60, 34, 14))
    dr.text((cx - tw / 2, top), text, font=f, fill=(246, 231, 200))

def tall_apartments(floors=2):
    """A tall half-timbered apartment block built from the Library's art."""
    L = SRC.crop((985, 120, 1235, 336))           # 250 x 216
    W = L.width
    roof = L.crop((0, 0, W, 116))                  # roof, chimney, top of the gable
    base = L.crop((0, 148, W, 216))                # ground floor: windows, door, flowers
    # one upper floor: the left wing's window bay, mirrored across the facade
    bay = L.crop((14, 112, 72, 150))               # 58 x 38: timber wall with a lit window
    floor_h = bay.height
    out = Image.new('RGB', (W, roof.height + floors * floor_h + base.height), (0, 0, 0))
    y = roof.height
    for f in range(floors):
        row = Image.new('RGB', (W, floor_h))
        # wall background from the facade's plain timber section
        wall = L.crop((60, 112, 120, 150))
        for x in range(0, W, wall.width): row.paste(wall, (x, 0))
        for i, x in enumerate(range(8, W - 50, 60)):
            b = bay if i % 2 == 0 else bay.transpose(Image.FLIP_LEFT_RIGHT)
            row.paste(b, (x, 0))
        out.paste(row, (0, y)); y += floor_h
    out.paste(base, (0, y))
    out.paste(roof, (0, 0))
    d = ImageDraw.Draw(out)
    # cover the book emblem on the gable with a round window
    cx = 108
    d.rectangle([cx - 24, 88, cx + 24, 116], fill=(118, 80, 46))
    for x in range(cx - 24, cx + 25, 6): d.line([(x, 88), (x, 116)], fill=(96, 62, 34))
    d.ellipse([cx - 10, 92, cx + 10, 112], fill=(59, 36, 20)); d.ellipse([cx - 7, 95, cx + 7, 109], fill=(255, 211, 110))
    d.line([(cx, 95), (cx, 109)], fill=(59, 36, 20)); d.line([(cx - 7, 102), (cx + 7, 102)], fill=(59, 36, 20))
    # floor ledges
    for k in range(floors + 1):
        yy = roof.height + k * floor_h
        d.line([(4, yy), (W - 6, yy)], fill=(90, 58, 30), width=2)
    # sign over the entrance
    sign(d, cx, roof.height + floors * floor_h + 2, 'Gotham Heights', 13, minw=128)
    return out

if __name__ == '__main__':
    img = tall_apartments(2)
    img.resize((img.width * 2, img.height * 2), Image.NEAREST).save(P('apartments_preview.png'))
    print(img.size)

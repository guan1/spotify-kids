from PIL import Image, ImageDraw
import math

SCALE = 4
SIZE = 512 * SCALE

def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))

def draw_icon():
    img = Image.new('RGB', (SIZE, SIZE), (0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Warm gradient background (coral -> golden orange), friendly/inviting.
    top = (255, 145, 110)
    bottom = (255, 175, 70)
    for y in range(SIZE):
        t = y / SIZE
        draw.line([(0, y), (SIZE, y)], fill=lerp_color(top, bottom, t))

    cx, cy = SIZE // 2, SIZE // 2 + 10 * SCALE

    # Headphone band (arc behind the head, thick stroke).
    band_color = (58, 42, 74)
    band_w = int(26 * SCALE)
    band_r = int(190 * SCALE)
    bbox = [cx - band_r, cy - band_r - int(40 * SCALE), cx + band_r, cy + band_r - int(40 * SCALE)]
    draw.arc(bbox, start=200, end=340, fill=band_color, width=band_w)
    # Round the arc's cut ends.
    for angle in (200, 340):
        rad = math.radians(angle)
        ex = cx + band_r * math.cos(rad)
        ey = cy - int(40 * SCALE) + band_r * math.sin(rad)
        r = band_w / 2
        draw.ellipse([ex - r, ey - r, ex + r, ey + r], fill=band_color)

    # Face (cream circle).
    face_r = int(150 * SCALE)
    face_color = (255, 244, 224)
    draw.ellipse([cx - face_r, cy - face_r, cx + face_r, cy + face_r], fill=face_color)

    # Ear cups (rounded rectangles) sitting on the face's sides.
    cup_w, cup_h = int(70 * SCALE), int(110 * SCALE)
    cup_y = cy - cup_h // 2
    for side in (-1, 1):
        cup_x = cx + side * (face_r - int(18 * SCALE)) - (cup_w // 2 if side < 0 else -cup_w // 2 + cup_w) + (0)
    # simpler explicit placement:
    left_cup = [cx - face_r - int(4 * SCALE), cup_y, cx - face_r - int(4 * SCALE) + cup_w, cup_y + cup_h]
    right_cup = [cx + face_r + int(4 * SCALE) - cup_w, cup_y, cx + face_r + int(4 * SCALE), cup_y + cup_h]
    radius = int(28 * SCALE)
    draw.rounded_rectangle(left_cup, radius=radius, fill=band_color)
    draw.rounded_rectangle(right_cup, radius=radius, fill=band_color)
    # inner cushion detail
    pad = int(14 * SCALE)
    cushion_color = (90, 70, 110)
    draw.rounded_rectangle([left_cup[0] + pad, left_cup[1] + pad, left_cup[2] - pad, left_cup[3] - pad],
                            radius=int(16 * SCALE), fill=cushion_color)
    draw.rounded_rectangle([right_cup[0] + pad, right_cup[1] + pad, right_cup[2] - pad, right_cup[3] - pad],
                            radius=int(16 * SCALE), fill=cushion_color)

    # Rosy cheeks.
    cheek_r = int(26 * SCALE)
    cheek_color = (255, 178, 160)
    draw.ellipse([cx - int(95 * SCALE) - cheek_r, cy + int(35 * SCALE) - cheek_r,
                  cx - int(95 * SCALE) + cheek_r, cy + int(35 * SCALE) + cheek_r], fill=cheek_color)
    draw.ellipse([cx + int(95 * SCALE) - cheek_r, cy + int(35 * SCALE) - cheek_r,
                  cx + int(95 * SCALE) + cheek_r, cy + int(35 * SCALE) + cheek_r], fill=cheek_color)

    # Eyes (simple friendly dots).
    eye_r = int(15 * SCALE)
    eye_color = (58, 42, 74)
    eye_y = cy - int(20 * SCALE)
    for side in (-1, 1):
        ex = cx + side * int(50 * SCALE)
        draw.ellipse([ex - eye_r, eye_y - eye_r, ex + eye_r, eye_y + eye_r], fill=eye_color)
        # tiny highlight
        hl_r = int(5 * SCALE)
        draw.ellipse([ex - hl_r + int(5*SCALE), eye_y - hl_r - int(5*SCALE),
                      ex + hl_r + int(5*SCALE), eye_y + hl_r - int(5*SCALE)], fill=(255, 255, 255))

    # Smile (thick arc).
    smile_w = int(14 * SCALE)
    smile_bbox = [cx - int(65 * SCALE), cy - int(10 * SCALE), cx + int(65 * SCALE), cy + int(70 * SCALE)]
    draw.arc(smile_bbox, start=20, end=160, fill=eye_color, width=smile_w)
    for angle in (20, 160):
        rad = math.radians(angle)
        rx = (smile_bbox[2] - smile_bbox[0]) / 2
        ry = (smile_bbox[3] - smile_bbox[1]) / 2
        mx = (smile_bbox[0] + smile_bbox[2]) / 2
        my = (smile_bbox[1] + smile_bbox[3]) / 2
        ex = mx + rx * math.cos(rad)
        ey = my + ry * math.sin(rad)
        r = smile_w / 2
        draw.ellipse([ex - r, ey - r, ex + r, ey + r], fill=eye_color)

    return img.resize((512, 512), Image.LANCZOS)

if __name__ == '__main__':
    icon = draw_icon()
    icon.save('icons/icon-512.png')
    icon.resize((192, 192), Image.LANCZOS).save('icons/icon-192.png')
    # apple-touch-icon must be fully opaque (no alpha) — already RGB, fine.
    icon.resize((180, 180), Image.LANCZOS).save('icons/apple-touch-icon.png')
    print('done')

# Builds build/icon.ico from build/icon.png: 32-bit BMP frames for 16–128 px (what Explorer and the taskbar
# read reliably) and a PNG frame only for 256 px. An ICO of PNG-only frames shows Windows' generic program icon.
# Art: Gragas, Esq. splash from CommunityDragon (skin04, 1280px), cropped; build/icon-small.png is a close-up of
# the face for 16–48 px, where the whole scene turns to mush.
import io, struct, sys
from PIL import Image

src = Image.open(sys.argv[1] if len(sys.argv) > 1 else 'build/icon.png').convert('RGBA')
small = Image.open(sys.argv[3] if len(sys.argv) > 3 else 'build/icon-small.png').convert('RGBA')
sizes = [16, 24, 32, 48, 64, 128, 256]
frames = []
for s in sizes:
    im = (small if s <= 48 else src).resize((s, s), Image.LANCZOS)
    if s == 256:
        buf = io.BytesIO(); im.save(buf, 'PNG'); frames.append(buf.getvalue()); continue
    px = im.tobytes('raw', 'BGRA')
    rows = [px[y * s * 4:(y + 1) * s * 4] for y in range(s)][::-1]  # DIBs are stored bottom-up
    mask_row = ((s + 31) // 32) * 4  # 1-bit AND mask, rows padded to 4 bytes; alpha does the real masking
    header = struct.pack('<IiiHHIIiiII', 40, s, s * 2, 1, 32, 0, s * s * 4 + mask_row * s, 0, 0, 0, 0)
    frames.append(header + b''.join(rows) + b'\0' * (mask_row * s))
out = io.BytesIO()
out.write(struct.pack('<HHH', 0, 1, len(frames)))
offset = 6 + 16 * len(frames)
for s, data in zip(sizes, frames):
    out.write(struct.pack('<BBBBHHII', s % 256, s % 256, 0, 0, 1, 32, len(data), offset))
    offset += len(data)
for data in frames:
    out.write(data)
open(sys.argv[2] if len(sys.argv) > 2 else 'build/icon.ico', 'wb').write(out.getvalue())
print('wrote', len(frames), 'frames')

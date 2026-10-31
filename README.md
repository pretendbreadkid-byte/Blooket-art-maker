# Blooket-art-maker
A friendly, no-build art maker that runs in the browser. Open `index.html` (or run `python3 -m http.server`).

- Projects live in folders; new projects ask whether they are animated and for the frame size.
- Layers (show/hide, reorder, rename, delete), undo, SVG export (animated projects export SMIL keyframe animation).
- Tools: select, point editing (drag vertices, shift+click to add one), pencil, marker, eraser, bucket, text, shapes. The size slider affects all of them; corner rounding rounds shape corners.
- Shapes catalog: basic shapes plus SVGs uploaded in Admin mode (a client-side toggle, not real authentication).
- Data is saved in the browser's localStorage.

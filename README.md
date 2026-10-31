# Blook Maker

A friendly art and animation website. Draw with vector tools, organise projects in folders, and export SVG.

There is nothing to install except [Node.js](https://nodejs.org) 20 or newer.

## Preview it in VS Code

Press **Ctrl+Shift+B**. This starts the server and opens the app in a tab inside VS Code.

You can also run **Terminal > Run Task > Blook Maker: Preview in VS Code**.

## Run it in a normal browser

```
npm start
```

Then open <http://localhost:5180>.

## Tools

| Tool | Key | What it does |
| --- | --- | --- |
| Select | V | Move, resize and turn things. Double-click to edit text or points. |
| Vertices | A | Drag points, click a dot to add one, double-click to curve one, round the corners. |
| Pencil | P | Thin, sharp lines. |
| Marker | M | Thick, see-through lines. |
| Shapes | S | Basic shapes and the uploaded catalog. |
| Bucket | B | Fill a shape, a closed drawing, or the background. |
| Text | T | Click and type. |
| Eraser | E | Rubs out art on the current layer. |
| Move view | H | Drag around. Hold Space to do this from any tool. Scroll to zoom. |

Other keys: `[` and `]` change brush size, Ctrl+Z undo, Ctrl+Y redo, Ctrl+D duplicate, Delete remove.

In animations: Enter plays, `,` and `.` step one frame. Pick a later frame and move or change something, and a keyframe is added for you.

## Admins

The **Admin** link on the home screen opens the shapes catalog. Admins upload SVG files, and each file becomes one single-colour shape with editable points that everyone can use.

The password is printed in the terminal when the server starts, and saved in `data/admin-password.txt`. To choose your own, set `ADMIN_PASSWORD` before starting.

## Where things are saved

- **Projects and folders** are saved in the browser you use, so they stay private to that browser. VS Code's preview and Chrome each keep their own copy.
- **Catalog shapes** are saved in `catalog/shapes.json`, shared with everyone.

To keep a new shape for good, upload it in your VS Code preview, then commit and push `catalog/shapes.json`. Render redeploys and the shape goes live. Shapes uploaded on the live site vanish when it restarts, and its admin page says so.

## Putting it online

Set `HOST=0.0.0.0`, `PORT` and `ADMIN_PASSWORD`, and put it behind HTTPS. By default it only listens on your own computer.

## Tests

```
npm test
```

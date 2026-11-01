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
| Select | V | Move, resize and turn things. Ctrl+click picks more. Double-click to edit text or points. Right-click for more. |
| Lasso | L | Draw a loop around things to pick them. In the drop-down under Select. |
| Vertices | A | Drag points, click a dot to add one, choose Pointed or Rounded, round the corners. In the drop-down under Select. |
| Line | N | Click to add points. Click the first point to close it, or double-click or press Enter to finish. Lines that touch connect. |
| Pencil | P | Thin, sharp lines. |
| Marker | M | Thick, see-through lines. |
| Shapes | S | Basic shapes, Plus shapes and the uploaded catalog. Click one, or drag it onto the canvas. |
| Bucket | B | Fill a shape, a closed drawing, or the background, with a colour or a gradient. |
| Text | T | Click and type. |
| Eraser | E | Rubs out art on the current layer. |
| Move view | H | Drag around. Hold Space to do this from any tool. Scroll to zoom. In the drop-down under Select. |
| Blooks | | Search the Blook assets and drag one onto the canvas. |

Other keys: `[` and `]` change brush size, Ctrl+Z undo, Ctrl+Y redo, Ctrl+D duplicate, Delete remove.

To connect lines you already drew, pick them, right-click and choose **Connect lines**. One open line gets **Close the line** instead. Use the Bucket to fill a closed line, and Vertices to change where it goes.

Drag the edges between panels to resize them. Double-click an edge to reset it.

## Animations

A new animation can use **Keyframes** or **Pages**. Enter plays, and `,` and `.` step one frame or page.

- **Keyframes:** pick a later frame and move or change something, and a keyframe is added for you. Shapes warp smoothly between keyframes, even when you add or remove points.
- **Pages:** each page is its own drawing, and playing flips from one to the next. Turn on Ghost to see the page before. Drag pages to reorder them, and right-click one for more.

**Loop back to beginning** plays the animation in reverse so it ends where it began. Right-click something on the canvas or its row in the timeline, or use the **Loop back** button. In a page animation, 1 2 3 becomes 1 2 3 2 1.

## Blook assets

The Blook art is by [Blooket](https://www.blooket.com) and is used with permission.

The pictures are in `public/blooks`. Each one arrives as separate pieces held together, on its own layer. Right-click it and choose **Take apart** to use the pieces on their own. Six of the files are animated, and they arrive as a still picture.

To add more, copy SVGs into that folder, or run this to tidy the names and skip duplicates:

```
node scripts/import-blooks.js "C:\path\to\folder"
```

**Add picture** can keep a picture as it is, or turn it into a shape with its real outline. Pictures with a plain or see-through background work best.

If art goes past the edge, the app offers to expand the canvas: **Perfect fit** wraps tightly around your lines and **Basic fit** just makes it big enough.

## Plans

| | Guest | Basic | Plus |
| --- | --- | --- | --- |
| Make art | Yes | Yes | Yes |
| Saves your art | No | Yes | Yes |
| Export SVG and WEBP | Yes | Yes | Yes |
| Export PNG, JPG and PDF | No | No | Yes |
| Plus shapes | No | No | Yes |

Plus is free for now. Set `PLUS_IS_FREE=false` to turn off free sign-ups, then connect payment in `POST /api/plus/join` in `server.js`. Plus checks currently run in the browser, so move them to the server before charging money.

## Admins

The **Admin** link on the home screen opens the shapes catalog. Admins upload files, and each file becomes one single-colour shape with editable points that everyone can use.

The password is printed in the terminal when the server starts, and saved in `data/admin-password.txt`. To choose your own, set `ADMIN_PASSWORD` before starting.

Admins can upload SVGs or pictures, and tick **Plus** to make a shape Plus only.

## Where things are saved

- **Accounts** are saved in `data/users.json`, or in a private GitHub repo if you set that up (below). Passwords are stored as salted hashes.
- **Projects and folders** are saved to your account, so they follow you to any device. Saves reach the server a few seconds after you stop drawing. The browser keeps a copy too, so nothing is lost if the connection drops, and it catches up next time. If the same project changes on two devices, the newest save wins.
- **Guests** are kept in memory only, so their art is gone when the page closes.
- **Catalog shapes** are saved in `catalog/shapes.json`, shared with everyone.

To keep a new shape for good, upload it in your VS Code preview, then commit and push `catalog/shapes.json`. Render redeploys and the shape goes live. Shapes uploaded on the live site vanish when it restarts, and its admin page says so.

## Putting it online

Set `HOST=0.0.0.0`, `PORT` and `ADMIN_PASSWORD`, and put it behind HTTPS. By default it only listens on your own computer. `ADMIN_PASSWORD` also protects logins, so changing it signs everyone out.

### Keeping accounts on Render

Render's free disk is wiped on every restart, so accounts and art need somewhere else to live. No database is needed:

1. Make a new **private** GitHub repo, for example `blook-maker-data`.
2. Make a [fine-grained token](https://github.com/settings/personal-access-tokens/new) for only that repo, with **Contents: Read and write**.
3. In Render, add `GITHUB_TOKEN` (the token) and `DATA_REPO` (like `your-name/blook-maker-data`).

## Tests

```
npm test
```

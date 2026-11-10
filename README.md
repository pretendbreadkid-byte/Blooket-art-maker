# Blook Berry

A friendly art and animation website. Draw with vector tools, organise projects in folders, and export SVG.

There is nothing to install except [Node.js](https://nodejs.org) 20 or newer.

## Preview it in VS Code

Press **Ctrl+Shift+B**. This starts the server and opens the app in a tab inside VS Code.

You can also run **Terminal > Run Task > Blook Berry: Preview in VS Code**.

## Run it in a normal browser

```
npm start
```

Then open <http://localhost:5180>.

## Tools

| Tool | Key | What it does |
| --- | --- | --- |
| Select | V | Move, resize and turn things. Drag empty space to move around the canvas, scroll to zoom. Ctrl+click picks more, Shift+drag draws a box to pick. Double-click to edit text or points. Right-click for more. After a resize, Original size at the top puts it back. |
| Lasso | L | Draw a loop around things to pick them. In the drop-down under Select. |
| Vertices | A | Drag points, click anywhere on a line to add a point there, choose Pointed or Rounded, round the corners. In the drop-down under Select. |
| Line | N | Click to add points. Click the first point to close it, or double-click or press Enter to finish. Lines that touch connect. |
| Pencil | P | Thin, sharp lines. |
| Marker | M | Thick, see-through lines. |
| Shapes | S | Basic shapes, Plus shapes and the uploaded catalog. Click one, or drag it onto the canvas. |
| Flip | Shift+H, Shift+V | Pick something, then flip it sideways or up and down. Things picked together flip as one. |
| Bucket | B | Fill a shape, a closed drawing, or the background, with a colour or a gradient. |
| Text | T | Click and type. |
| Eraser | E | Rubs out art. |
| Assets | | Search the Blook art and drag one onto the canvas. |
| Uploads | | Upload your own pictures. They stay on your account, ready for any project. |
| Textures | | Dots, stripes, checks, grid, waves, sparkles, shine, bricks, planks, scales, zigzag, diamonds, hearts or your own picture, on some pieces, a whole Blook or the background. In an animation they can slide, and the shine sweeps across by itself. |
| Swap colours | | Change one colour everywhere in the picked art, including SVG and other pictures. |
| Blur | | Soften any picked art, from 0 to 60 px. In an animation it can blur in and out. |
| Shadow | | A solid, see-through drop shadow under picked art, with darkness, distance and direction. Softness blurs it if you want. A whole Blook casts one shadow together. |
| Underbelly | | A see-through band along the bottom of picked shapes, pictures or text, following their outline, with size, opacity and colour. |
| Auto shadow | | In the Canvas panel. A solid, see-through band below each piece, wherever it overlaps the one under it, with a strength and size. |

## Templates and packs

New projects can start as a Blook, a Banner, a Blook background, an Icon (Blook size with sharp corners, for the corner of a pack card) or Pack art, in Blooket's sizes. Blooks and Banners can add an underbelly shadow, and Pack art can add two strips of shine. These stay above the art. The Canvas panel turns them on or off, sizes them, and makes them darker or lighter.

The home screen sorts projects into groups by what they were made as: Blooks, Banners, Backgrounds, Icons, Pack art and Other art. Each group has its own New button for that kind.

The Test page looks like Blooket's Market. Your packs shows each pack on a card in the colour you picked, with its icon faint in the corner and its price. Click a pack to choose how many to open, or Show Drop Rates to see every Blook's chance. My Blooks keeps track of what you have pulled. Packs and pulls save to the account like projects do.

Community: in the pack maker, Send to Community shares a pack. It waits on the admin page until an admin approves it, then everyone can open it in the Community tab. Sending it again replaces it, and it waits again. Pulls from community packs are remembered in your browser.

Other keys: `[` and `]` change brush size, Ctrl+Z undo, Ctrl+Y redo, Ctrl+D duplicate, Delete remove.

To connect lines you already drew, pick them, right-click and choose **Connect lines**. One open line gets **Close the line** instead. Use the Bucket to fill a closed line, and Vertices to change where it goes.

There are no layers to manage. Every piece sits on its own step of the stack, so click it and use **Forward**, **Backward**, **Front** or **Back** to change what it sits on top of (Ctrl+], Ctrl+[, Ctrl+Shift+] and Ctrl+Shift+[). **Opacity** is at the top of the panel. Projects made with layers are flattened in the same order when you open them, and anything on a hidden layer shows again.

Drag the edges between panels to resize them. Double-click an edge to reset it.

## Animations

A new animation can use **Keyframes** or **Pages**. Enter plays, and `,` and `.` step one frame or page.

- **Keyframes:** pick a later frame and move or change something, and a keyframe is added for you. Shapes warp smoothly between keyframes, even when you add or remove points.
- **Pages:** each page is its own drawing, and playing flips from one to the next. Turn on Ghost to see the page before. Drag pages to reorder them, and right-click one for more.

**Loop back to beginning** plays the animation in reverse so it ends where it began. Right-click something on the canvas or its row in the timeline, or use the **Loop back** button. In a page animation, 1 2 3 becomes 1 2 3 2 1.

## Blook assets

The Blook art is by [Blooket](https://www.blooket.com) and is used with permission.

The pictures are in `public/blooks`. Each one arrives as separate pieces held together. Right-click it and choose **Take apart** to use the pieces on their own. Six of the files are animated, and they arrive as a still picture.

To add more, copy SVGs into that folder, or run this to tidy the names and skip duplicates:

```
node scripts/import-blooks.js "C:\path\to\folder"
```

**Add picture** can keep a picture as it is, turn it into a shape with its real outline, or take it apart. SVGs come apart along their real pieces, and other pictures split by colour. A picture already on the canvas can be taken apart too: right-click it and choose **Take apart**. Pictures with a plain or see-through background work best.

The text tool has the **Blooket** font, which is Titan One, with an optional chunky shadow. Titan One is by Rodrigo Fuenzalida under the SIL Open Font License, included in `public/fonts/OFL.txt`.

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

### Render's loading page

Render's free plan puts a site to sleep after 15 quiet minutes, then shows its own loading page to the next visitor. A paid Render plan never sleeps. On the free plan, add `KEEP_AWAKE` set to `true` and the site visits itself every 10 minutes to stay up. Free plans get 750 hours a month across every service on the account, and this one service uses about 744, so don't turn it on if you run other free services there.

## Tests

```
npm test
```

# Chart Builder

A static web app for building animated horizontal bar charts. No framework, no build step.

## Run

Open `index.html` directly in a browser, or serve it locally:

```
node server.js
```

Then visit `http://localhost:4173`.

## Features

- Add, remove, and edit series (legend entries) and categories (rows)
- Per-series bar color via hex input or native color picker
- Scores from 0 to 10,000 (bar fills to 100%, label shows actual value)
- Adjustable animation duration with play/pause, skip, and timeline scrubbing
- Optional fade-in animation toggle
- Background color, background image upload, or transparent mode
- Export 1920x1080 .webm video, .png, or .svg
- All state persisted in localStorage

## Export

Video export uses the browser's MediaRecorder, producing .webm. Convert to MP4 with FFmpeg:

```
ffmpeg -i chart-1920x1080.webm -c:v libx264 -pix_fmt yuv420p chart.mp4
```

## Files

- `index.html` - markup
- `styles.css` - styling
- `app.js` - editor, canvas rendering, export logic
- `server.js` - optional static file server

## Defaults

Default series, categories, scores, and colors are defined in `defaultState` inside `app.js`. Click Reset in the app or clear localStorage to restore them.

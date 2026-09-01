# Assimil Player

A small offline audio player for language courses. Load the MP3 files of a
course such as *Le Portugais*, *Le Japonais sans Peine* or *Le Luxembourgeois
Facile* onto a device, then listen with no internet connection at all.

The same app runs on **iPhone, iPad, Android, Windows and Mac**.

## Why a Progressive Web App

The app is plain HTML, CSS and JavaScript — no build step, no framework, no
dependencies. That choice covers every device you asked for from a single
codebase:

| Requirement | How it is met |
| --- | --- |
| Runs on phone, tablet and PC | One web app, installable to the home screen or desktop |
| MP3 files stored offline on the device | Files are copied into **IndexedDB**; playback never touches the network |
| The app itself works offline | A service worker caches the app shell |
| Track what has been played **per device** | IndexedDB is local to each device, so every device keeps its own history |
| No app store | Nothing to publish, sign or pay for |

## Features

**Welcome screen** — pick which language to listen to. Each course shows its
cover picture, a progress bar and how many lessons have been played on this
device.

**Cover pictures** — give each language its own picture (a book cover, a flag,
a photo). It appears on the library card, next to the course title and as the
full artwork on the player and the lock screen. Pictures are optional; without
one the app shows a coloured initial instead. Chosen images are automatically
downscaled to 640 px and re-encoded, so a multi-megabyte phone photo is stored
as a few tens of kilobytes and leaves the space for your audio.

**Player**

- Play, pause and stop
- Skip backward and forward, each with its own step (5 to 60 seconds) so you
  can jump back a long way to re-hear a phrase while nudging forward in
  smaller steps
- Previous and next lesson
- Drag the seek bar to any point
- Playback speed from 0.6× to 1.5× — useful when a dialogue is spoken quickly
- **Repeat** the current lesson 2, 3, 5 or 10 times, or endlessly, for
  reinforcement during a single daily study session. A badge on the player
  shows which pass is playing ("Play 2 of 3"). When the repeats are finished
  the player moves on to the next lesson if auto-advance is on.
- **Break** of up to 30 seconds between repeats, to give you a moment to think
  before the lesson starts again. The badge counts the break down, and pressing
  play skips the rest of it.
- Auto-advance to the next lesson, which can be switched off
- Resumes an unfinished lesson exactly where it was left
- Lock-screen and headphone controls via the Media Session API
- Keyboard shortcuts on a PC: `space` play/pause, `←`/`→` skip,
  `↑`/`↓` previous/next lesson, `Esc` back to the lesson list

**Listening history, per device**

- A lesson is marked as played automatically once 94% of it has been heard
- It can also be ticked or unticked by hand
- Play counts, resume positions and "last played" dates are recorded — a lesson
  repeated three times counts as three plays
- Each device is given a name (Settings) and keeps its own separate history
- The history can be exported as JSON from Settings

**Library management** — create, rename and delete courses; set or remove a
cover picture; add individual MP3 files or a whole folder; remove single
lessons; reset progress for a course.

## Running it

The app must be served over `http://` or `https://` — opening `index.html`
directly from the filesystem disables service workers and offline mode.

```powershell
cd "c:\source\Assimil - Player"
python -m http.server 8080
```

Then open <http://localhost:8080>.

While changing the code, prefer the bundled development server, which tells the
browser not to cache anything so edits show up on a plain reload:

```powershell
python tools\devserver.py . 8080
```

Any static host works too: GitHub Pages, Netlify, Cloudflare Pages, Azure
Static Web Apps, or a folder on your own web server. Copy the whole directory
as-is; there is nothing to compile.

> To install on a phone or tablet, the site must be served over **HTTPS**
> (`localhost` is the one exception). Free static hosts provide HTTPS
> automatically.

## Installing on a device

| Device | Steps |
| --- | --- |
| **iPhone / iPad** | Open the site in **Safari** → Share → *Add to Home Screen* |
| **Android** | Open in Chrome → menu → *Install app* / *Add to Home screen* |
| **Windows / Mac** | Open in Edge or Chrome → install icon in the address bar → *Install* |

Once installed it launches full screen like a normal app and works with the
device in airplane mode.

## Loading your MP3 files

1. Open the app and tap **+ Add a language**.
2. Give the course a title, for example `Le Japonais sans Peine`, and
   optionally a subtitle such as `Volume 1 — lessons 1 to 50`.
3. Optionally tap **Choose picture** to give the language a cover.
4. Tap **+ Add MP3 files** and select the lesson files, or **+ Add a folder**
   to import a whole directory at once (desktop and Android; iOS has no folder
   picker, so use the file picker there).
5. The files are copied into the app. From then on they play offline.

To add or change a cover later, open the course, tap the **⋮** menu and choose
**Edit name and picture**.

Lessons are sorted naturally by file name, so `Lecon 2` comes before
`Lecon 10`. Re-importing the same folder will not create duplicates.

In **Settings**, tap **Protect offline files** to ask the browser to keep the
audio when storage runs low. This is worth doing after a large import.

Supported formats are whatever the device can decode: `.mp3`, `.m4a`, `.m4b`,
`.aac`, `.wav`, `.ogg`, `.opus`, `.flac`.

## Storage limits

Audio is limited by the browser's storage quota, not by the app. Desktop
browsers typically allow several gigabytes. iOS is more restrictive, so on an
iPhone or iPad it is best to keep one or two courses on the device at a time.
The welcome screen always shows how much space is in use.

## Project layout

```
index.html               Welcome, course and player screens
manifest.webmanifest     Install metadata (name, icons, colours)
sw.js                    Service worker - caches the app shell for offline use
css/styles.css           Mobile-first dark theme
js/app.js                Screens, rendering and event wiring
js/db.js                 IndexedDB: courses, tracks, audio blobs, covers, progress
js/player.js             Audio engine and transport controls
js/import.js             File import, natural sort, duration probing
js/image.js              Cover pictures: decode, downscale, re-encode
icons/                   App icons
tools/generate-icons.js  Regenerates the icons (node tools/generate-icons.js)
tools/devserver.py       Local no-cache server for development
```

## Notes

- Nothing is uploaded anywhere. The audio and the listening history never leave
  the device.
- Imported audio is copied into the app's own storage, so moving or deleting
  the original files afterwards does not affect playback.
- Because history is per device by design, listening to a lesson on the iPad
  does not mark it played on the PC. Use *Export listening report* if you want
  to compare devices.
- Updating the app: bump `CACHE` in [sw.js](./sw.js) so devices pick up the new
  version on next launch.
- If the app is open in several tabs when a new version changes the database
  layout, the update can be held up by the older tab. The app then says so and
  offers a *Try again* button; close the other tabs and reload.

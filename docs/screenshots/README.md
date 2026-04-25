# Screenshots

The README references PNGs from this folder. They are not committed yet. To
generate a fresh set:

1. Open the app at `http://localhost:5173` in Chrome.
2. Resize the window to **1440 × 900** (`docs/screenshots/01-dashboard.png`)
   or **1680 × 1050** for the wider boards.
3. For each route below, take a window screenshot
   (`Cmd ⇧ 4`, then `Space`, then click the Chrome window):

| Filename | Route | What it shows |
|---|---|---|
| `01-dashboard.png` | `/dashboard` | Mission control: working agents, pending approvals, today's usage, on the board, running previews, recent activity |
| `02-board.png` | `/board` | Kanban with the 4 columns and a few cards in progress |
| `03-live.png` | `/live` | Per-agent swimlanes with messages flying between nodes |
| `04-agents.png` | `/agents` | Roster grid with avatars and role pills |
| `05-previews.png` | `/previews` | Sidebar with grouped runs + iframe of a running preview |
| `06-usage.png` | `/usage` | Token totals, daily trend bars, per-agent breakdown |
| `07-rules.png` | `/agents/<id>` (Rules tab) | The Rules editor with the bundled template loaded |

Drop the PNGs in this folder using the names above and the README image
references will resolve.

# NHL Producer Briefing App

A full-stack local/deployable app for NHL broadcast producers that:

1. Accepts away team, home team, and game date.
2. Scans NHL game-notes directory listing for the correct PDF file name (including variable 4-digit game number).
3. Downloads the PDF from NHL.
4. Sends the PDF to OpenAI and generates:
   - Producer briefing
   - GFX list
5. Displays output in a dark, mobile-friendly UI with tabs and print support for GFX.

## Requirements

- Node.js 18+
- `OPENAI_API_KEY`

## Run locally

```bash
OPENAI_API_KEY=your_key_here node server.js
```

Then open: `http://localhost:3000`

Optional env vars:

- `PORT` (default `3000`)
- `OPENAI_MODEL` (default `gpt-4.1`)

## Notes

- The app uses NHL directory path: `https://link.nhl.com/static/gamenotes/public/20252026/`.
- It strictly prompts the model to use only attached game notes content.
- CORS is handled server-side by keeping all external requests in backend endpoints.

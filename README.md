# IAM WhatsApp Bot Maker Pro (starter)

Dark/red multi-bot dashboard with login, bot creation, QR connection, custom text commands, and per-bot session folders.

## Requirements
- Node.js 20 or newer
- A server/host that supports long-running Node.js processes and persistent disk

## Run locally
1. Copy `.env.example` to `.env`.
2. Set `ADMIN_PASSWORD` to a long, unique password.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000`.

## Important deployment notes
- This is a starter project, not a hosted website. Deploy it to a Node.js host that supports persistent storage; use HTTPS and a strong password.
- Bot records are stored in `data/bots.json`; WhatsApp sessions are stored in `sessions/`. Persistent storage is required or QR pairing may need to be repeated.
- This sample is intentionally single-admin and is not designed for public multi-user registration. Add rate limiting, secure session expiry, CSRF protections, and production hardening before public use.
- It uses the unofficial Baileys WhatsApp Web protocol library. It may break, and automated use can lead to account restrictions. Use a test account and review WhatsApp's terms. The official WhatsApp Business Platform is a separate integration and does not use this QR-session flow.
- Do not expose the app publicly with the example password. Keep `.env`, `data/`, and `sessions/` private.

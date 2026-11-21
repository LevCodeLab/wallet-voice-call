# Contributing to wallet-voice-call

Thanks for checking out the repo. Pull requests, bug fixes, and clean tests are always welcome.

## Local Setup

1. Copy `.env.example` to `.env`.
2. Run `npm install`.
3. Create a local PostgreSQL database (`createdb wallet_voice_call`) and run `npm run db:migrate`.
4. Run `npm run typecheck` and `npm test` before opening a pull request.

## UI and Code Rules

1. Keep all UI buttons and badges strictly monochrome (`#0B0B0E`, `#141418`, `#26262E`, `#FFFFFF`).
2. Never commit `.env` files, real API keys, or private wallet keys.
3. Add a Vitest unit test whenever you change signature verification or WebRTC signaling logic.

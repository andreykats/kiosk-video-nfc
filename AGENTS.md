# Agent instructions: kiosk-video-nfc

## Keep it generic

The code, tests and docs describe a generic kiosk ("Kiosk" in local builds). Only the published app is branded: its name comes from the `APP_NAME` Actions variable and its domain from the Pages settings (README → Deployment). Don't write "Topps" into the source, and use `example.com` in test card IDs. Mentions of `topps.drey.dev` belong only where the text is about the live deployment. The NFC Browser Bridge (separate repo) never mentions it.

## Deploying

Every push to `main` deploys https://topps.drey.dev through `.github/workflows/deploy.yml`, and each deploy gets the next version number: v1.0.1, v1.0.2, and so on. The workflow picks the number from the highest `v1.0.N` git tag and pushes the new tag once the deploy succeeds (README → Deployment).

When you deploy:

1. Run the unit tests (`npm test`) and the e2e tests (`npm run test:e2e`). Don't push if either fails.
2. Stage only the files you changed (`git add <paths>`, never `git add -A` or `git add .`). Other agents edit this repo at the same time.
3. Commit and push to `main`.
4. Watch the run (`gh run list --workflow deploy.yml --limit 1`, then `gh run watch <id> --exit-status`). Then tell the user the version that went live, e.g. "Deployed v1.0.4". The new tag is in `git ls-remote --tags origin`.

Don't bump the version by hand:

- Don't edit `version` in `package.json` to release. It only sets the series (`1.0.0` → v1.0.N). Change it only when the user asks for a new series, e.g. `1.1.0` for v1.1.1.
- Don't create, move or delete `v*` tags. The workflow owns them.
- Don't hardcode a version in the source. The app shows `__APP_VERSION__`, which the workflow sets through `APP_VERSION`. Local builds show `1.0.0-dev`.

## Testing alongside other agents

`playwright.config.ts` reuses a server that is already on port 4173. Another agent's preview may be running there, serving its own, older `dist/`. If port 4173 is taken, build to a temporary directory instead (`npx vite build --outDir <tmp>/dist`), and run Playwright with a temporary config that previews that directory on another port.

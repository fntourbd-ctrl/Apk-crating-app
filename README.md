# WebToAPK Build Server

## Render setup
- Root directory: repository root
- Build command: `npm install`
- Start command: `npm start`
- Environment variables:
  - `GITHUB_TOKEN`: GitHub token with Actions write permission on the target repository
  - `GITHUB_REPO`: `owner/repository`
  - `GITHUB_BRANCH`: `main` (optional)
  - `PUBLIC_URL`: server URL (optional; use for uploaded icons)
  - `ALLOWED_ORIGIN`: frontend origin (optional; comma-separated)

Your target repository must contain `.github/workflows/build.yml` with a `workflow_dispatch` workflow accepting inputs named `id`, `config`, and `icon_url`, and publishing APK releases tagged `build-<id>`.

Health check: `/health`. Build API: `POST /api/build`. Status API: `GET /api/status/:id`.

# Git workflow

- `main` is protected: PR required, 1 approval from CODEOWNERS for the folder touched, CI must pass.
- Branches: `engine/<feature>`, `api/<feature>`, `web/<feature>`, `infra/<feature>`, `docs/<topic>`.
- Small PRs (under ~400 lines), merge at least daily. Rebase on `main` before opening.
- Commit messages: `engine: add ITA metric`, `web: capture guide screen`.
- `schemas/` and `docs/CONTRACT.md` need both approvals.
- Never commit images, RAW, `.env`, keys. Pre-commit check: `git diff --cached --name-only | grep -Ei '\.(dng|jpe?g|heic|png)$'` must be empty (except web assets/docs images).
- Tag `v0.1-m3` at integration, `v1.0-submission` at submit.
- Make the repo public before submitting; double-check history has no images or secrets.

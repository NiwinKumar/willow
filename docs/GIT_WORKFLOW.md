# Git workflow

- `main` is protected: PR required, 1 approval from CODEOWNERS for the folder touched, CI must pass.
- Branches: `engine/<feature>`, `api/<feature>`, `web/<feature>`, `infra/<feature>`, `docs/<topic>`.
- Small PRs (under ~400 lines), merge at least daily. Rebase on `main` before opening.
- Commit messages: `engine: add ITA metric`, `web: capture guide screen`.
- `schemas/` and `docs/CONTRACT.md` need both approvals.
- Never commit images, RAW, `.env`, keys. Pre-commit check: `git diff --cached --name-only | grep -Ei '\.(dng|jpe?g|heic|png)$'` must be empty (except web assets/docs images).
- Tag `v0.1-m3` at integration, `v1.0-submission` at submit.
- Make the repo public before submitting; double-check history has no images or secrets.

## First-time setup (Niwin, once)
```bash
unzip willow-repo.zip && cd willow
git log --oneline                 # scaffold commits already there
gh auth login                     # once, if not logged in
gh repo create willow --private --source=. --remote=origin --push
gh api -X PUT repos/{owner}/willow/collaborators/<harshini-github> -f permission=push
```
Without the GitHub CLI: create an empty private repo `willow` on github.com (no README/license), then
`git remote add origin git@github.com:<you>/willow.git && git push -u origin main`.

Then: replace `@NIWIN_GITHUB` / `@HARSHINI_GITHUB` in `.github/CODEOWNERS` (via PR); Settings -> Branches -> protect `main` (require PR + CODEOWNERS review).

## Harshini
```bash
git clone git@github.com:<niwin>/willow.git && cd willow
git switch -c engine/smoke-test
```

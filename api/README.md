# api (owner: Niwin)

FastAPI service `willow-api` on Cloud Run. Contract: `docs/CONTRACT.md` section 3. Env vars: `docs/LOCAL_DEV.md`.

```bash
cd api && uv sync && uv run pytest && uv run ruff check .
AUTH_MODE=dev ENGINE_MODE=fixture uv run uvicorn app.main:app --reload --port 8080
curl -s localhost:8080/v1/health
```

`AUTH_MODE=dev` trusts an `X-Dev-Uid` header for local work; the deployed service verifies Firebase ID tokens.
Signed upload URLs are signed with IAM signBlob as `sa-api` (locally your user impersonates it; no key files).

Deploy: see `infra/README.md`.

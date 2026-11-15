# Security

What the platform does (read from the code), what Phase 12 added, and what must be done on the VPS. Tags: **[REPO]** = verified in the code; **[PHASE 12]** = added by Phase 12 and **now present in the repo** (read from the code; not verified on a VPS).

> **Honest summary of current gaps**
> 1. Roles (`ADMIN`, `EDITOR`, `VIEWER`) are stored and put in the JWT payload, but **only `/api/ops/*` enforces one** (`@Roles(ADMIN)` via `RolesGuard`, **[PHASE 12]**). Every other route ignores the role, so `VIEWER` can do everything `EDITOR` can.
> 2. Registration defaults to open locally; production example sets `REGISTRATION_ENABLED=false` **[PHASE 12.1]**.
> 3. Redis has **no password** in the dev `docker-compose.yml`. `docker-compose.prod.yml` sets `--requirepass`, and `validateProductionConfig` refuses to start the API in production without `REDIS_PASSWORD`.
> 4. The dev compose file and `.env.example` are development settings (public ports, default passwords, placeholder secrets). Use `docker-compose.prod.yml` and `.env.production.example` for a VPS.
> 5. Swagger is mounted unless `SWAGGER_ENABLED=false` (the production example sets it; `.env.example` ships `true`). Caddy still proxies `/docs*`.
> 6. No third-party security review or penetration test has been done, and **none of the Phase 12 hardening has been tested on a VPS**.

## 1. Authentication

| Item | Implementation | Source |
| --- | --- | --- |
| Password hashing | **bcrypt, 12 rounds** | **[REPO]** `auth.service.ts` (`BCRYPT_ROUNDS = 12`) |
| Access token | JWT signed with `JWT_ACCESS_SECRET`, TTL `JWT_ACCESS_EXPIRES_IN` (default `15m`). The strategy rejects non-`access` token types and re-checks that the user exists and is active on every request. | **[REPO]** `jwt.strategy.ts` |
| Refresh token | JWT signed with `JWT_REFRESH_SECRET`, TTL `JWT_REFRESH_EXPIRES_IN` (default `7d`). Delivered as an **httpOnly** cookie named `refresh_token`, `Path=COOKIE_PATH` (default `/api/auth`), `Secure` and `SameSite` per config. | **[REPO]** `auth.cookies.ts` |
| Refresh rotation | Each refresh revokes the current `RefreshSession` and issues a new one. Only the **SHA-256 hash** of the refresh token is stored. | **[REPO]** `auth.service.ts` |
| Reuse detection | Presenting a revoked refresh token, or one whose hash does not match, **revokes all of the user's sessions**. | **[REPO]** |
| Logout | `logout` revokes the session. `logout-all` revokes all sessions. Changing the password revokes all sessions. | **[REPO]** |
| Inactive users | `isActive=false` blocks access at the JWT strategy. | **[REPO]** |
| Global guard | `JwtAuthGuard` is global; routes opt out with `@Public()` (auth endpoints, health, OAuth callbacks). | **[REPO]** `app.module.ts` |
| Web token storage | The access token is kept in `localStorage` (`accessToken`). It is short-lived (15m), but readable by any XSS. | **[REPO]** `apps/web/src/lib/api.ts` |

Operational notes:

- Changing `JWT_ACCESS_SECRET` invalidates all access tokens; changing `JWT_REFRESH_SECRET` forces all users to log in again. Use this for emergency session invalidation.
- Secrets must be unique random values ≥32 characters. The `change-me-…` values in `.env.example` must never reach production.
- Set `COOKIE_SECURE=true`. The example file sets `false`, which **overrides** the secure production default.

## 2. Roles and authorization

| Item | State |
| --- | --- |
| Roles in schema | `UserRole { ADMIN, EDITOR, VIEWER }`, default `EDITOR` **[REPO]** |
| Role in JWT/user object | Yes **[REPO]** |
| Role enforcement (guards/decorators) | **Partial [PHASE 12].** `RolesGuard` is global and `OpsController` is decorated `@Roles(UserRole.ADMIN)` (`/api/ops/*`; the `production-readiness` e2e spec checks editor 403 / admin OK, not re-run). No other controller uses `@Roles`, so `VIEWER` can do everything `EDITOR` can outside ops. |
| Admin designation | `ADMIN_EMAIL` is **only the alert-email recipient**; it does not promote anyone. **[PHASE 12.1]** First admin: register the user, then `POST /api/ops/bootstrap-admin` with `{ email, token }` matching `ADMIN_BOOTSTRAP_TOKEN` (only when zero ADMIN users exist). After success, bootstrap is permanently disabled (`system:adminBootstrap:completed`). Later admins: existing ADMIN calls `POST /api/ops/promote-admin`. |
| Data scoping | User-owned resources are scoped by `userId` in the API ("All user-owned resources are scoped to the authenticated user", per README). This is the real isolation mechanism today. |

Until RBAC is enforced:

- Do not rely on `VIEWER` as a restriction.
- Treat every registered user as trusted with respect to **spending provider budget** and **publishing to connected channels they own**.
- Close or gate registration before exposing the site (see section 9).
- The Phase 12 ops endpoints do have a role check (ADMIN). Note that admins can trigger backups, cleanup, queue pause/resume, retry jobs, change `ROLLOUT_STAGE`, emergency stop, pause all automation and promote other users, so treat ADMIN accounts as highly privileged. Set `REGISTRATION_ENABLED=false` after bootstrap; every new account still starts as `EDITOR`.

## 3. Credential encryption (social tokens)

- OAuth access/refresh tokens for connected channels are encrypted at rest with **AES-256-GCM** (`EncryptionService`): random 12-byte IV, 16-byte auth tag, payload `base64url(iv | tag | ciphertext)`. **[REPO]**
- The key is derived as `SHA-256(CREDENTIALS_ENCRYPTION_KEY)`. The API refuses to start if the secret is missing or shorter than 32 characters. **[REPO]** The worker has its own decrypt implementation (`apps/worker/src/lib/crypto.ts`) using the same key.
- **No key versioning or rotation.** Changing the key makes existing tokens undecryptable (users must reconnect channels). Plan rotation as "re-encrypt everything with a script", which does not exist.
- The key must exist in `.env.production` on the VPS (necessarily) and in a **separate** offline backup. Do not store it with database dumps.
- Provider API keys (`GEMINI_API_KEY`, `FAL_API_KEY`, `KLING_API_KEY`, …) are plain environment variables, not encrypted at rest. Protect `.env.production` and the `releases/*.env.bak` copies that `deploy.sh`/`update.sh` write (`chmod 600`, owned by the deploy user).

## 4. Rate limiting

| Scope | Limit | Source |
| --- | --- | --- |
| Global (per client IP) | **100 requests / 60 s** | **[REPO]** `ThrottlerModule` in `app.module.ts` (skipped when `NODE_ENV=test`) |
| `POST /api/auth/register` | 5 / 60 s | **[REPO]** `auth.controller.ts` |
| `POST /api/auth/login` | 10 / 60 s | **[REPO]** |
| `POST /api/auth/refresh` | 20 / 60 s | **[REPO]** |

Caveats:

- The throttler keys on client IP. Behind Caddy `TRUST_PROXY` **[PHASE 12]** must be on so the real IP is used; otherwise all users share one bucket (and an attacker can lock everyone out). The API sets Express `trust proxy` to `1` when `TRUST_PROXY=true` or `NODE_ENV=production`, and the prod compose forces `TRUST_PROXY=true`. Unverified behind a real Caddy.
- Throttler storage is in-memory by default, so limits reset on restart and are per-process.
- There is no per-account lockout or CAPTCHA. 10 logins/min/IP still allows slow credential stuffing from many IPs.
- Rate limiting does not bound **provider spend**; use `KLING_MAX_MONTHLY_SPEND_USD`, `GEMINI_TTS_MAX_MONTHLY_SPEND_USD`, and per-scene attempt caps.

## 5. HTTP hardening

| Control | State |
| --- | --- |
| `helmet()` with defaults on the API | **[REPO]** `main.ts` |
| CORS | **[REPO]** Allow-list from `CORS_ORIGIN` (comma-separated), `credentials: true`, methods `GET POST PUT PATCH DELETE OPTIONS`, headers `Content-Type, Authorization`. Never set `CORS_ORIGIN=*` with credentials. |
| Input validation | **[REPO]** Global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`. |
| Log redaction | **[REPO]** `req.headers.authorization` and `req.headers.cookie` redacted in pino logs. |
| Upload limit | **[REPO]** 100 MB hard-coded constant in `media.constants.ts`. The `MAX_UPLOAD_BYTES` env var exists (config only) but is **not wired** to enforcement **[GAP]**. |
| Web security headers (CSP, HSTS, etc.) | **[PHASE 12]** Caddy sets `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` and strips `Server`; `nginx.web.conf` also sets nosniff, frame-deny, referrer-policy and permissions-policy. **No CSP** is set anywhere for the SPA **[GAP]**. Helmet's headers apply only to API responses. |
| Swagger | **[PHASE 12]** `SWAGGER_ENABLED=false` disables `/docs` in the API (`.env.production.example` sets it). Caddy still proxies `/docs*`; it returns 404 when disabled. |
| Proxy trust | **[PHASE 12]** `TRUST_PROXY` (see section 4) |
| Production config validation | **[PHASE 12]** `validateProductionConfig()` aborts API start in production on missing/placeholder secrets, `minioadmin`, default Postgres password or empty Redis password (unit-tested; the worker does not run it). |

## 6. Network, firewall and HTTPS

- **Public ports: 80 and 443 only** (Caddy). SSH (22) restricted to your IP if possible, key-only auth, root login disabled.
- **PostgreSQL, Redis, MinIO (API `9000` and console `9001`), the API (`3000`), the worker health port and the web container must not be reachable from the internet.** The dev compose publishes all of them; `docker-compose.prod.yml` publishes only Caddy (not verified from outside a VPS).
- **Docker bypasses UFW** for published ports (it writes its own iptables rules). `ufw deny 5432` does **not** protect a port published with `ports: "5432:5432"`. The reliable control is **not publishing the port**, or binding it to `127.0.0.1:`. Also consider the provider-level (cloud) firewall as a second layer.
- Verify from outside: `nc -zv <vps-ip> 5432 6379 9000 9001 3000 5173 5433` should fail for all.
- **HTTPS everywhere.** Caddy is configured to obtain and renew certificates automatically **[PHASE 12]** (`infrastructure/caddy/Caddyfile`; never run, no certificate issued yet). Redirect HTTP→HTTPS. OAuth redirect URIs must be HTTPS and exact-match what is registered with each provider.
- Internal service traffic (api→postgres, api→redis, api→minio) is plaintext on the private Docker network; acceptable for single-host, not for multi-host.

## 7. Secrets management

- Local dev: `.env` at the repo root. Production: `.env.production` (from `.env.production.example`), `chmod 600`, never committed (`.gitignore` covers it; verify `git status` before every commit).
- Generate with `openssl rand -base64 48` (see `DEPLOYMENT.md`).
- Rotate on suspicion of leak: JWT secrets (users re-login), `POSTGRES_PASSWORD` (also change it inside Postgres with `ALTER USER`), `MINIO_*` keys (change the server env **and** clients), `REDIS_PASSWORD`, provider API keys at the provider console. `CREDENTIALS_ENCRYPTION_KEY` rotation requires re-encryption (not implemented).
- Never put secrets in `VITE_*` variables or in the web image build args; they become public JS.
- A local `.env` file exists in this workspace (and `releases/` / `backups/` directories may hold secret-bearing copies). Make sure real keys that were ever used in development are **not** reused in production.
- **Secrets in backups:** DB dumps contain bcrypt hashes and encrypted tokens. Encrypt off-site copies (`BACKUP_AND_RESTORE.md`).

## 8. Container and host hygiene

- **[PHASE 12]** `Dockerfile.api`, `Dockerfile.worker` and `Dockerfile.web` run as a non-root `aivideo` user and define `HEALTHCHECK`s (not verified at runtime; check volume ownership, e.g. `worker_tmp`).
- Images are not scanned. MinIO is pinned in `docker-compose.prod.yml` (`RELEASE.2024-12-18T13-15-44Z`) but dev uses `latest`; Dockerfiles use `pnpm install --frozen-lockfile=false`. Rebuild regularly for base-image security updates.
- Redis (prod) disables `FLUSHALL`, `FLUSHDB`, `DEBUG` and uses `noeviction`.
- Docker socket must never be mounted into app containers.
- Keep the OS patched (`unattended-upgrades`), SSH key-only, `fail2ban` optional.
- Restrict who has shell/`docker` group access on the VPS; `docker` group is effectively root.

## 9. Pre-launch hardening checklist

- [ ] `NODE_ENV=production`, `COOKIE_SECURE=true`, strict `CORS_ORIGIN`
- [ ] All secrets replaced; `grep -nE 'change-me|minioadmin' .env.production` is empty
- [ ] Redis password set on the server and in `.env.production` (compose + `validateProductionConfig` enforce it)
- [ ] No ports published except 80/443; external port scan clean
- [ ] `TRUST_PROXY` on and per-IP limiting verified behind Caddy (implemented; not yet verified)
- [ ] `/docs` disabled (`SWAGGER_ENABLED=false`) and confirmed 404 through Caddy
- [ ] Registration closed (`REGISTRATION_ENABLED=false`) after bootstrap, or additionally blocked at Caddy
- [ ] RBAC beyond `/api/ops/*` added, or accepted as a risk in writing
- [ ] CSP added (Caddy has other security headers, but no CSP)
- [ ] Provider monthly spend guards set (`KLING_MAX_MONTHLY_SPEND_USD`, `GEMINI_TTS_MAX_MONTHLY_SPEND_USD`)
- [ ] Docker log rotation confirmed on the VPS (configured in `docker-compose.prod.yml`)
- [ ] Backups encrypted off-site and restore tested

## 10. Reporting and response

If you suspect compromise: follow `INCIDENT_RESPONSE.md` (emergency stop, rotate secrets, revoke sessions via `logout-all`/secret rotation, review `AutomationAuditLog` and publication history).

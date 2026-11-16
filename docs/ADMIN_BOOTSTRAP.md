# Initial administrator bootstrap (Phase 12.1)

## When to use

Use this once on a fresh deployment when **no** `ADMIN` user exists yet.

Do **not** use `ADMIN_EMAIL` — that variable is only the alert recipient.

## Procedure

Public registration is **disabled**. Create the first operator in the database (or an internal seed script), then promote them.

1. Set a strong one-time secret in `.env.production`:

```bash
ADMIN_BOOTSTRAP_TOKEN="$(openssl rand -base64 48)"
```

2. Recreate the API (and scheduler) so the env is loaded.

3. Create the first operator account in Postgres (example via `psql` / Prisma Studio / a one-off seed). The account must already exist before bootstrap.

4. Promote that account via bootstrap (unauthenticated; token-gated):

```bash
curl -sS -X POST "https://$DOMAIN/api/ops/bootstrap-admin" \
  -H 'Content-Type: application/json' \
  -d '{"email":"ops@example.com","token":"'"$ADMIN_BOOTSTRAP_TOKEN"'"}'
```

5. Clear or rotate the bootstrap token:

```bash
# Remove or rotate ADMIN_BOOTSTRAP_TOKEN — endpoint stays closed via setting system:adminBootstrap:completed
```

6. Confirm an `AutomationAuditLog` row with action `ops.bootstrap_admin` exists.

## Afterwards

- Additional admins: authenticated ADMIN → `POST /api/ops/promote-admin` `{ "email": "..." }`.
- Bootstrap returns an error if an ADMIN already exists or the setting `system:adminBootstrap:completed` is present.

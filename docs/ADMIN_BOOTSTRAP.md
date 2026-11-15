# Initial administrator bootstrap (Phase 12.1)

## When to use

Use this once on a fresh deployment when **no** `ADMIN` user exists yet.

Do **not** use `ADMIN_EMAIL` — that variable is only the alert recipient.

## Procedure

1. Set a strong one-time secret in `.env.production`:

```bash
ADMIN_BOOTSTRAP_TOKEN="$(openssl rand -base64 48)"
REGISTRATION_ENABLED=true   # temporarily, only for the first account
```

2. Recreate the API (and scheduler) so the env is loaded.

3. Register the first operator account (normal register endpoint):

```bash
curl -sS -X POST "https://$DOMAIN/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ops","email":"ops@example.com","password":"REPLACE_STRONG_PASSWORD"}'
```

4. Promote that account via bootstrap (unauthenticated; token-gated):

```bash
curl -sS -X POST "https://$DOMAIN/api/ops/bootstrap-admin" \
  -H 'Content-Type: application/json' \
  -d '{"email":"ops@example.com","token":"'"$ADMIN_BOOTSTRAP_TOKEN"'"}'
```

5. Immediately disable registration and clear/rotate the bootstrap token:

```bash
REGISTRATION_ENABLED=false
# Remove or rotate ADMIN_BOOTSTRAP_TOKEN — endpoint stays closed via setting system:adminBootstrap:completed
```

6. Confirm an `AutomationAuditLog` row with action `ops.bootstrap_admin` exists.

## Afterwards

- Additional admins: authenticated ADMIN → `POST /api/ops/promote-admin` `{ "email": "..." }`.
- Bootstrap returns an error if an ADMIN already exists or the setting `system:adminBootstrap:completed` is present.

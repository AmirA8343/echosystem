# fit-ecosystem-core

Minimal shared backend for linking `fitmacro` and `fitface-ai`.

## What it does

- links app users into one `ecosystemUserId`
- stores shared goal/profile data
- stores merged daily summary data
- returns combined coach context

## Before first run

1. Create a Postgres database.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL` in `.env`.
4. Apply `src/db/schema.sql` to the database.

## Start locally

```bash
npm install
npm run dev
```

## Validate build

```bash
npx tsc --noEmit
npm run build
```

## First endpoints

- `GET /health`
- `POST /v1/ecosystem/link`
- `GET /v1/ecosystem/user`
- `PUT /v1/ecosystem/profile`
- `POST /v1/ecosystem/daily-summary`
- `GET /v1/ecosystem/daily-summary`
- `GET /v1/ecosystem/coach-context`

## Example local flow

```bash
cp .env.example .env
npm install
npm run dev
```

Once Postgres is available and the schema is applied, the service can boot against real data.

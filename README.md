# ReachInbox Scheduler

A full-stack email scheduling assignment implementation. The frontend is a React/Vite dashboard and the backend is an Express API with BullMQ, Redis, PostgreSQL, and Ethereal SMTP.

## Current implementation

- Responsive ReachInbox-style dashboard with scheduled and sent tabs.
- Compose drawer with subject, body, CSV/TXT upload, lead count, start time, delay, and hourly limit controls.
- Express API: `GET /api/health`, `GET /api/emails`, and `POST /api/emails/schedule`.
- BullMQ delayed jobs. There are no cron jobs or polling schedulers.
- Configurable worker concurrency through `WORKER_CONCURRENCY`.
- Redis-backed hourly counters and a per-sender minimum-send delay through `MAX_EMAILS_PER_HOUR` and `MIN_DELAY_MS`.
- PostgreSQL schema in `backend/schema.sql`.
- Ethereal preview SMTP transport. Set explicit credentials for a stable demo account, or the worker creates a temporary test account.

## Run locally

1. Start infrastructure:

```bash
docker compose up -d
```

This uses the root `docker-compose.yml` to start PostgreSQL, Redis, and Elasticsearch.

2. Create `backend/.env`:

```env
PORT=3001
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgres://postgres:postgres@localhost:5432/reachinbox
WORKER_CONCURRENCY=5
MAX_EMAILS_PER_HOUR=200
MIN_DELAY_MS=2000
ETHEREAL_FROM=demo@reachinbox.test
ELASTICSEARCH_URL=http://localhost:9200
SESSION_SECRET=change-this-for-a-real-deployment
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3001/api/auth/google/callback
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_REDIRECT_URI=http://localhost:3001/api/slack/callback
SLACK_CHANNEL_ID=
```

3. Install and initialize the backend:

```bash
cd backend
npm install
psql "$DATABASE_URL" -f schema.sql
npm run dev
```

4. Start the dashboard in another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The dashboard ships with demo rows so the UI can be reviewed before infrastructure is started.

## Scheduling contract

`POST /api/emails/schedule` accepts:

```json
{
	"subject": "A useful introduction",
	"body": "Hello from ReachInbox",
	"recipients": ["person@example.com"],
	"scheduledAt": "2026-09-11T09:00:00.000Z",
	"sender": "demo@reachinbox.test"
}
```

Each recipient gets an idempotent BullMQ `jobId`. A delayed job survives API process restarts because its state is held by Redis. PostgreSQL stores the email lifecycle so the dashboard can read scheduled, sent, and failed records.

The worker uses configurable concurrency. BullMQ's limiter provides a shared hourly ceiling, while Redis keys track the sender's current hour and last send time across worker instances. When a sender reaches the ceiling, the job is moved to the next hour rather than discarded and a Slack message is sent if that sender has connected Slack. The worker also waits for `MIN_DELAY_MS` between sends. Under a large burst, Redis retains all jobs and BullMQ releases them as the limiter allows. No cron job or polling scheduler is used.

## Integrations

- Google OAuth: configure the three Google variables and use `/api/auth/google`.
- Slack OAuth: configure Slack credentials and use the dashboard connection link or `/api/slack/connect`. Tokens are persisted in PostgreSQL when available and held in memory for local development.
- Elasticsearch: new emails are indexed in `emails`; use `/api/emails/search?q=keyword`. Without Elasticsearch, the API uses a local text-search fallback.
- Bull Board: when Redis is configured, open `/admin/queues` to inspect delayed, active, completed, and failed jobs.

## Demo checklist

1. Start Docker, apply `schema.sql`, and start the backend and frontend.
2. Upload a CSV with two or more addresses and schedule a campaign from the dashboard.
3. Open `/admin/queues` and show the delayed jobs.
4. Stop and restart the backend while a future job remains in Redis.
5. Reopen the dashboard and show the job completing through Ethereal.
6. Set `MAX_EMAILS_PER_HOUR=1`, connect Slack, schedule two emails, and show the live rate-limit notification plus the rescheduled job.

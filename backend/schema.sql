CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'sent', 'failed')),
  provider_id TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS emails_status_scheduled_at_idx ON emails(status, scheduled_at);

CREATE TABLE IF NOT EXISTS slack_connections (
  user_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");
const axios = require("axios");
const session = require("express-session");
const passport = require("passport");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");
const { createBullBoard } = require("@bull-board/api");
const { BullMQAdapter } = require("@bull-board/api/bullMQAdapter");
const { ExpressAdapter } = require("@bull-board/express");
const { Client: ElasticsearchClient } = require("@elastic/elasticsearch");

const app = express();
const port = Number(process.env.PORT || 3001);
const queueName = process.env.QUEUE_NAME || "email-sends";
const redisUrl = process.env.REDIS_URL;
const concurrency = Number(process.env.WORKER_CONCURRENCY || 5);
const hourlyLimit = Number(process.env.MAX_EMAILS_PER_HOUR || 200);
const minDelayMs = Number(process.env.MIN_DELAY_MS || 2000);
const redisConnection = redisUrl
  ? new IORedis(redisUrl, { maxRetriesPerRequest: null })
  : null;
const queue = redisConnection
  ? new Queue(queueName, { connection: redisConnection })
  : null;
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
const elasticsearch = process.env.ELASTICSEARCH_URL
  ? new ElasticsearchClient({ node: process.env.ELASTICSEARCH_URL })
  : null;
const memoryEmails = [];
const memorySlackConnections = new Map();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "local-development-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  }),
);
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL:
          process.env.GOOGLE_CALLBACK_URL ||
          `http://localhost:${port}/api/auth/google/callback`,
      },
      (_accessToken, _refreshToken, profile, done) =>
        done(null, {
          id: profile.id,
          name: profile.displayName,
          email: profile.emails?.[0]?.value,
          avatar: profile.photos?.[0]?.value,
        }),
    ),
  );
}

const boardAdapter = new ExpressAdapter();
boardAdapter.setBasePath("/admin/queues");
if (queue) {
  createBullBoard({
    queues: [new BullMQAdapter(queue)],
    serverAdapter: boardAdapter,
  });
  app.use("/admin/queues", boardAdapter.getRouter());
}

function normalizeEmail(input) {
  return String(input || "")
    .trim()
    .toLowerCase();
}

async function indexEmail(email) {
  if (!elasticsearch) return;
  await elasticsearch.index({
    index: "emails",
    id: email.id,
    document: {
      ...email,
      scheduledAt: new Date(email.scheduledAt).toISOString(),
    },
  });
}

async function saveEmail(email) {
  if (!pool) {
    memoryEmails.push(email);
    await indexEmail(email);
    return email;
  }
  const result = await pool.query(
    `INSERT INTO emails (id, recipient, subject, body, scheduled_at, status, sender)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      email.id,
      email.recipient,
      email.subject,
      email.body,
      email.scheduledAt,
      email.status,
      email.sender,
    ],
  );
  await indexEmail(result.rows[0]);
  return result.rows[0];
}

async function updateIndexedEmail(email) {
  if (!elasticsearch) return;
  await elasticsearch.update({ index: "emails", id: email.id, doc: email });
}

async function notifySlack(sender, message) {
  const connection =
    memorySlackConnections.get(sender) ||
    (pool
      ? (
          await pool.query(
            "SELECT access_token FROM slack_connections WHERE user_id = $1",
            [sender],
          )
        ).rows[0]
      : null);
  if (!connection?.access_token) return false;
  await axios.post(
    "https://slack.com/api/chat.postMessage",
    { channel: process.env.SLACK_CHANNEL_ID || sender, text: message },
    {
      headers: {
        Authorization: `Bearer ${connection.access_token}`,
        "Content-Type": "application/json",
      },
    },
  );
  return true;
}

app.get("/api/auth/google", (request, response, next) => {
  if (!process.env.GOOGLE_CLIENT_ID)
    return response
      .status(503)
      .json({ error: "Google OAuth is not configured" });
  passport.authenticate("google", { scope: ["profile", "email"] })(
    request,
    response,
    next,
  );
});
app.get("/api/auth/google/callback", (request, response, next) =>
  passport.authenticate("google", {
    failureRedirect: `${process.env.FRONTEND_URL || "http://localhost:5173"}/login?error=oauth`,
  })(request, response, () =>
    response.redirect(
      `${process.env.FRONTEND_URL || "http://localhost:5173"}/`,
    ),
  ),
);
app.get("/api/auth/me", (request, response) =>
  response.json({ user: request.user || null }),
);
app.post("/api/auth/logout", (request, response) =>
  request.logout(() => response.json({ ok: true })),
);

app.get("/api/slack/connect", (request, response) => {
  if (!process.env.SLACK_CLIENT_ID)
    return response
      .status(503)
      .json({ error: "Slack OAuth is not configured" });
  const redirect = encodeURIComponent(
    process.env.SLACK_REDIRECT_URI ||
      `http://localhost:${port}/api/slack/callback`,
  );
  response.redirect(
    `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID}&scope=chat:write&redirect_uri=${redirect}&state=local-user`,
  );
});
app.get("/api/slack/callback", async (request, response, next) => {
  try {
    const params = new URLSearchParams({
      code: request.query.code,
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      redirect_uri:
        process.env.SLACK_REDIRECT_URI ||
        `http://localhost:${port}/api/slack/callback`,
    });
    const result = await axios.post(
      "https://slack.com/api/oauth.v2.access",
      params,
    );
    if (!result.data.ok)
      return response.status(400).json({ error: result.data.error });
    const userId = request.query.state || request.user?.id || "local-user";
    memorySlackConnections.set(userId, {
      access_token: result.data.access_token,
    });
    if (pool)
      await pool.query(
        "INSERT INTO slack_connections (user_id, access_token) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET access_token = EXCLUDED.access_token",
        [userId, result.data.access_token],
      );
    response.redirect(
      `${process.env.FRONTEND_URL || "http://localhost:5173"}/?slack=connected`,
    );
  } catch (error) {
    next(error);
  }
});
app.delete("/api/slack/disconnect", async (request, response, next) => {
  try {
    const userId = request.user?.id || "local-user";
    memorySlackConnections.delete(userId);
    if (pool)
      await pool.query("DELETE FROM slack_connections WHERE user_id = $1", [
        userId,
      ]);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

async function listEmails(status) {
  if (!pool)
    return memoryEmails
      .filter((email) => !status || email.status === status)
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  const result = await pool.query(
    "SELECT * FROM emails WHERE ($1::text IS NULL OR status = $1) ORDER BY scheduled_at ASC",
    [status || null],
  );
  return result.rows;
}

app.get("/api/health", async (_request, response) => {
  response.json({
    ok: true,
    queue: Boolean(queue),
    database: Boolean(pool),
    workerConcurrency: concurrency,
  });
});

app.get("/api/emails", async (request, response, next) => {
  try {
    response.json({ data: await listEmails(request.query.status) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/emails/search", async (request, response, next) => {
  try {
    const query = String(request.query.q || "").trim();
    if (!query) return response.json({ data: [] });
    if (!elasticsearch)
      return response.json({
        data: (await listEmails()).filter((email) =>
          `${email.recipient} ${email.subject} ${email.body}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        ),
      });
    const result = await elasticsearch.search({
      index: "emails",
      query: {
        multi_match: { query, fields: ["recipient", "subject", "body"] },
      },
    });
    response.json({ data: result.hits.hits.map((hit) => hit._source) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/emails/schedule", async (request, response, next) => {
  try {
    const {
      subject,
      body,
      recipients,
      scheduledAt,
      sender = process.env.ETHEREAL_FROM,
    } = request.body;
    const normalizedRecipients = [
      ...new Set(
        (recipients || [])
          .map(normalizeEmail)
          .filter((email) => email.includes("@")),
      ),
    ];
    if (!subject || !body || !normalizedRecipients.length || !scheduledAt)
      return response
        .status(400)
        .json({
          error: "subject, body, recipients, and scheduledAt are required",
        });
    if (!queue)
      return response
        .status(503)
        .json({
          error:
            "Redis is not configured. Set REDIS_URL before scheduling jobs.",
        });
    const emails = await Promise.all(
      normalizedRecipients.map(async (recipient, index) => {
        const id = `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
        const email = {
          id,
          recipient,
          subject,
          body,
          scheduledAt,
          sender,
          status: "scheduled",
        };
        await saveEmail(email);
        await queue.add(
          "send-email",
          { emailId: id, recipient, subject, body, sender },
          {
            jobId: id,
            delay: Math.max(0, new Date(scheduledAt).getTime() - Date.now()),
            removeOnComplete: false,
            removeOnFail: false,
          },
        );
        return email;
      }),
    );
    response.status(202).json({ data: emails });
  } catch (error) {
    next(error);
  }
});

async function createTransporter() {
  if (process.env.ETHEREAL_HOST)
    return nodemailer.createTransport({
      host: process.env.ETHEREAL_HOST,
      port: Number(process.env.ETHEREAL_PORT || 587),
      secure: process.env.ETHEREAL_SECURE === "true",
      auth: {
        user: process.env.ETHEREAL_USER,
        pass: process.env.ETHEREAL_PASS,
      },
    });
  const account = await nodemailer.createTestAccount();
  return nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass },
  });
}

async function startWorker() {
  if (!redisConnection) return;
  const transporter = await createTransporter();
  const worker = new Worker(
    queueName,
    async (job) => {
      const sender = job.data.sender || "default";
      const hourKey = `email-rate:${sender}:${new Date().toISOString().slice(0, 13)}`;
      const count = await redisConnection.incr(hourKey);
      await redisConnection.expire(hourKey, 7200);
      if (count > hourlyLimit) {
        await notifySlack(
          sender,
          `Rate limit reached for ${sender}. ${hourlyLimit} emails/hour were allowed; this email has been rescheduled to the next available window.`,
        );
        const nextHour = new Date(Date.now() + 60 * 60 * 1000);
        await job.moveToDelayed(nextHour.getTime(), worker.token);
        return;
      }
      const lastSentKey = `email-last-sent:${sender}`;
      const lastSent = Number((await redisConnection.get(lastSentKey)) || 0);
      const wait = minDelayMs - (Date.now() - lastSent);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const info = await transporter.sendMail({
        from: sender,
        to: job.data.recipient,
        subject: job.data.subject,
        text: job.data.body,
      });
      await redisConnection.set(lastSentKey, Date.now());
      if (pool)
        await pool.query(
          "UPDATE emails SET status = $1, sent_at = NOW(), provider_id = $2 WHERE id = $3",
          ["sent", info.messageId, job.data.emailId],
        );
      else {
        const match = memoryEmails.find(
          (email) => email.id === job.data.emailId,
        );
        if (match) {
          match.status = "sent";
          match.sentAt = new Date().toISOString();
          await updateIndexedEmail(match);
        }
      }
      return { previewUrl: nodemailer.getTestMessageUrl(info) };
    },
    {
      connection: redisConnection,
      concurrency,
      limiter: { max: hourlyLimit, duration: 60 * 60 * 1000 },
    },
  );
  worker.on("failed", async (job, error) => {
    if (pool && job)
      await pool.query(
        "UPDATE emails SET status = $1, error = $2 WHERE id = $3",
        ["failed", error.message, job.data.emailId],
      );
  });
  console.log(`BullMQ worker ready: ${queueName} (concurrency ${concurrency})`);
}

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "Internal server error" });
});
app.listen(port, async () => {
  console.log(`API listening on http://localhost:${port}`);
  await startWorker();
});

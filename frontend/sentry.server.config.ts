import * as Sentry from "@sentry/nextjs";

// No DSN locally (see .env.example) — the SDK stays disabled there.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
});

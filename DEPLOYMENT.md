# No Under 40 — Deployment Guide

## Environment Variables (Vercel)
| Variable | Description |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Supabase project URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase anon key |
| SUPABASE_SERVICE_ROLE_KEY | Supabase service role (server only) |
| NEXT_PUBLIC_APP_URL | Production URL |
| ZEPTO_MAIL_TOKEN | ZeptoMail API key |
| ZEPTO_MAIL_FROM | Sender email address |
| ZEPTO_MAIL_FROM_NAME | Sender name |
| STRIPE_SECRET_KEY | Stripe secret key |
| STRIPE_WEBHOOK_SECRET | Stripe webhook signing secret |
| NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY | Stripe publishable key |

## Database Setup
1. Run all migrations in order from supabase/migrations/
2. Enable RLS on all tables (included in migrations)
3. Create storage buckets: documents, chat-attachments, metodo-library, school-assets

## Vercel Setup
- Build Command: npm run build
- Output Directory: (Next.js default)
- Install Command: npm install
- Root Directory: (repo root)

## Post-Deploy Checklist
- [ ] Test all 4 role logins
- [ ] Verify Stripe webhook endpoint
- [ ] Send test email via ZeptoMail
- [ ] Check Supabase RLS policies
- [ ] Verify storage bucket permissions

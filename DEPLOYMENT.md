# No Under 40 — Deployment Guide

## Production secrets on EC2

The EC2 deployment reads the complete `.env.prod` file from AWS Secrets Manager
before every deployment. The secret name is `nounder40/prod-config` and its value
must be the raw dotenv file (not a JSON object).

Create the secret the first time from a trusted machine with AWS CLI access:

```bash
aws secretsmanager create-secret \
  --region eu-west-1 \
  --name nounder40/prod-config \
  --secret-string file://.env.prod
```

For later configuration changes, create a new secret version:

```bash
aws secretsmanager put-secret-value \
  --region eu-west-1 \
  --secret-id nounder40/prod-config \
  --secret-string file://.env.prod
```

The IAM role attached to the EC2 instance must allow `secretsmanager:GetSecretValue`
for this secret. Replace the account ID in this policy and attach it to that role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:eu-west-1:ACCOUNT_ID:secret:nounder40/prod-config-*"
    }
  ]
}
```

If the secret uses a customer-managed KMS key, also grant the EC2 role
`kms:Decrypt` on that key. The deployment writes `.env.prod` atomically in
`/home/ubuntu/nounder40`, owned by `ubuntu` with permissions `600`, and then runs
`docker compose config --quiet` before changing any containers.

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

# Locully CRM — instructions for Claude Code

This is the local CRM for Locully (Bangkok AI optimization & SEO agency). Single-user, no auth, runs on **port 3712**.

## When the user mentions adding an enquiry or client

Persist it to the local CRM by POSTing to the import endpoints. **Do not** edit `locully-crm.db` directly — always go through the API so activities get logged automatically.

### Add an enquiry

```bash
curl -sS -X POST http://localhost:3712/api/import/enquiry \
  -H "Content-Type: application/json" \
  -d '{
    "lead_name": "Sukhumvit Dental Studio",
    "contact_name": "Dr. Anong",
    "vertical": "clinic",
    "phone": "+66 2 123 4567",
    "email": "hello@example.com",
    "source": "linkedin",
    "stage": "new",
    "estimated_value_thb": 18000,
    "services_interested": ["AIO","SEO"],
    "follow_up_date": "2026-04-15",
    "notes": "Interested in AI visibility audit."
  }'
```

### Add a client

```bash
curl -sS -X POST http://localhost:3712/api/import/client \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Client Co.",
    "contact_name": "Khun Somchai",
    "vertical": "restaurant",
    "phone": "+66 ...",
    "email": "...",
    "source": "referral",
    "status": "active",
    "retainer_thb": 15000,
    "services": ["SEO","Google Ads"],
    "notes": "..."
  }'
```

## Field reference (use exactly these values)

- **vertical:** `clinic` · `restaurant` · `hospitality` · `professional_services` · `other`
- **source:** `linkedin` · `referral` · `cold_outreach` · `inbound` · `chatgpt` · `other`
- **stage** (enquiries): `new` · `contacted` · `audit_sent` · `proposal_sent` · `negotiating` · `closed_won` · `closed_lost`
- **status** (clients): `active` · `paused` · `churned`
- **services / services_interested:** any of `AIO`, `SEO`, `Google Ads`, `Meta Ads`, `Local SEO`
- **All monetary values are integers in THB** — no decimals, no commas, no currency symbol
- **Dates** are ISO `YYYY-MM-DD`
- Required fields: `lead_name` for enquiries, `name` for clients. Everything else is optional — omit fields you don't have rather than guessing

## Operating rules

1. **Ask the user before guessing.** If they say "add an enquiry from a clinic in Phuket", ask for the lead name, estimated value, and stage before submitting. Don't fabricate phone numbers, emails, or follow-up dates.
2. **Confirm after submission.** After a successful POST the API returns the created record with its `id`. Tell the user the id and which stage/status it landed in.
3. **If the server isn't running**, the curl will fail with connection refused. In that case tell the user and offer to start it: `node server.js` from this directory (or `node server.js &` to background it).
4. **Don't delete or mutate existing records via curl** unless the user explicitly asks. The web UI is the safer place for edits and deletes.
5. **Never commit `locully-crm.db`** — it's already in `.gitignore`. It's the user's live data.

## Other useful endpoints (read-only — fine to call any time)

- `GET /api/dashboard` — KPIs + recent activity (great for "what's my pipeline looking like?")
- `GET /api/enquiries` — full list (supports `?stage=negotiating` etc.)
- `GET /api/clients` — full list (supports `?status=active`)
- `GET /api/activities` — chronological activity log

## Running the CRM

```bash
npm install   # first time only
node server.js
# open http://localhost:3712
```

The SQLite file `locully-crm.db` is auto-created and seeded with Locully's existing active clients on first run.

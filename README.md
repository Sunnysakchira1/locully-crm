# Locully CRM & Dashboard

Internal CRM and dashboard for **Locully** — a Bangkok-based AI optimization and SEO agency. Single-user local tool, no auth.

## Stack

- Node.js + Express
- SQLite via `better-sqlite3` (file: `locully-crm.db`)
- Vanilla JS + TailwindCSS (CDN) + Chart.js (CDN)
- No build step

## Run

```bash
npm install
node server.js
```

Open http://localhost:3712

The database file `locully-crm.db` is auto-created on first run and seeded with Locully's existing active clients.

## Port

`3712`

## Features

- **Dashboard** — MRR, active clients, open enquiries, pipeline value, stage/vertical charts, recent activity
- **Pipeline** — kanban with HTML5 drag-and-drop between stages; stage changes auto-log activities
- **Enquiries** — filterable table with convert-to-client action
- **Clients** — CRUD with activity timeline and quick activity logging
- **Activity Log** — chronological log across all entities, filterable

## Adding records via Claude Code / CLI

Import an enquiry without opening the browser:

```bash
curl -X POST http://localhost:3712/api/import/enquiry \
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

Import a client:

```bash
curl -X POST http://localhost:3712/api/import/client \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Client Co.",
    "vertical": "restaurant",
    "retainer_thb": 15000,
    "services": ["SEO","Google Ads"],
    "status": "active",
    "source": "referral"
  }'
```

## API Routes

All routes prefixed with `/api`.

### Clients
- `GET /api/clients` (optional `?status=`)
- `GET /api/clients/:id`
- `POST /api/clients`
- `PUT /api/clients/:id`
- `DELETE /api/clients/:id`

### Enquiries
- `GET /api/enquiries` (optional `?stage=`)
- `GET /api/enquiries/:id`
- `POST /api/enquiries`
- `PUT /api/enquiries/:id`
- `DELETE /api/enquiries/:id`
- `PATCH /api/enquiries/:id/stage` — body: `{ "stage": "contacted" }`
- `POST /api/enquiries/:id/convert` — convert to client, marks as `closed_won`

### Activities
- `GET /api/activities?entity_type=&entity_id=`
- `POST /api/activities`

### Dashboard
- `GET /api/dashboard`

### CLI Import
- `POST /api/import/enquiry`
- `POST /api/import/client`

## Vertical / Source / Stage values

- **vertical:** `clinic` · `restaurant` · `hospitality` · `professional_services` · `other`
- **source:** `linkedin` · `referral` · `cold_outreach` · `inbound` · `chatgpt` · `other`
- **stage:** `new` · `contacted` · `audit_sent` · `proposal_sent` · `negotiating` · `closed_won` · `closed_lost`
- **client status:** `active` · `paused` · `churned`

All monetary values are stored as integers (THB, no decimals).

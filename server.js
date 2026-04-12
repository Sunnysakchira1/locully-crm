require('dotenv').config();
const path = require('path');
const express = require('express');
const db = require('./db');
const metaAds = require('./meta-ads-slack');

const app = express();
const PORT = 3712;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// -------- helpers --------
const OPEN_STAGES = ['new', 'contacted', 'audit_sent', 'proposal_sent', 'negotiating'];

function logActivity(entity_type, entity_id, type, description) {
  db.prepare(`
    INSERT INTO activities (entity_type, entity_id, type, description)
    VALUES (?, ?, ?, ?)
  `).run(entity_type, entity_id, type, description);
}

function pickClient(body) {
  return {
    name: body.name ?? null,
    contact_name: body.contact_name ?? null,
    vertical: body.vertical ?? null,
    phone: body.phone ?? null,
    email: body.email ?? null,
    website: body.website ?? null,
    source: body.source ?? null,
    status: body.status ?? 'active',
    retainer_thb: Number.isFinite(+body.retainer_thb) ? +body.retainer_thb : 0,
    services: typeof body.services === 'string' ? body.services : JSON.stringify(body.services || []),
    notes: body.notes ?? null,
  };
}

function pickEnquiry(body) {
  return {
    lead_name: body.lead_name ?? null,
    contact_name: body.contact_name ?? null,
    vertical: body.vertical ?? null,
    phone: body.phone ?? null,
    email: body.email ?? null,
    source: body.source ?? null,
    stage: body.stage ?? 'new',
    estimated_value_thb: Number.isFinite(+body.estimated_value_thb) ? +body.estimated_value_thb : 0,
    services_interested: typeof body.services_interested === 'string' ? body.services_interested : JSON.stringify(body.services_interested || []),
    notes: body.notes ?? null,
    follow_up_date: body.follow_up_date ?? null,
  };
}

// =================== CLIENTS ===================
app.get('/api/clients', (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare('SELECT * FROM clients WHERE status = ? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all();
  res.json(rows);
});

app.get('/api/clients/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const activities = db.prepare(`
    SELECT * FROM activities WHERE entity_type='client' AND entity_id=? ORDER BY created_at DESC
  `).all(req.params.id);
  res.json({ ...client, activities });
});

app.post('/api/clients', (req, res) => {
  const body = req.body || {};
  if (!body.name) return res.status(400).json({ error: 'name required' });
  const c = pickClient(body);
  const info = db.prepare(`
    INSERT INTO clients (name, contact_name, vertical, phone, email, website, source, status, retainer_thb, services, notes)
    VALUES (@name, @contact_name, @vertical, @phone, @email, @website, @source, @status, @retainer_thb, @services, @notes)
  `).run(c);
  logActivity('client', info.lastInsertRowid, 'note', `Client "${c.name}" created`);
  res.json({ id: info.lastInsertRowid, ...c });
});

app.put('/api/clients/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const merged = pickClient({ ...existing, ...req.body });
  db.prepare(`
    UPDATE clients SET
      name=@name, contact_name=@contact_name, vertical=@vertical, phone=@phone, email=@email,
      website=@website, source=@source, status=@status, retainer_thb=@retainer_thb,
      services=@services, notes=@notes
    WHERE id=@id
  `).run({ ...merged, id: +req.params.id });
  res.json({ id: +req.params.id, ...merged });
});

app.delete('/api/clients/:id', (req, res) => {
  db.prepare('DELETE FROM clients WHERE id=?').run(req.params.id);
  db.prepare("DELETE FROM activities WHERE entity_type='client' AND entity_id=?").run(req.params.id);
  res.json({ ok: true });
});

// =================== ENQUIRIES ===================
app.get('/api/enquiries', (req, res) => {
  const { stage } = req.query;
  const rows = stage
    ? db.prepare('SELECT * FROM enquiries WHERE stage = ? ORDER BY created_at DESC').all(stage)
    : db.prepare('SELECT * FROM enquiries ORDER BY created_at DESC').all();
  res.json(rows);
});

app.get('/api/enquiries/:id', (req, res) => {
  const enq = db.prepare('SELECT * FROM enquiries WHERE id=?').get(req.params.id);
  if (!enq) return res.status(404).json({ error: 'Not found' });
  const activities = db.prepare(`
    SELECT * FROM activities WHERE entity_type='enquiry' AND entity_id=? ORDER BY created_at DESC
  `).all(req.params.id);
  res.json({ ...enq, activities });
});

app.post('/api/enquiries', (req, res) => {
  const body = req.body || {};
  if (!body.lead_name) return res.status(400).json({ error: 'lead_name required' });
  const e = pickEnquiry(body);
  const info = db.prepare(`
    INSERT INTO enquiries (lead_name, contact_name, vertical, phone, email, source, stage, estimated_value_thb, services_interested, notes, follow_up_date)
    VALUES (@lead_name, @contact_name, @vertical, @phone, @email, @source, @stage, @estimated_value_thb, @services_interested, @notes, @follow_up_date)
  `).run(e);
  logActivity('enquiry', info.lastInsertRowid, 'note', `Enquiry "${e.lead_name}" created (stage: ${e.stage})`);
  res.json({ id: info.lastInsertRowid, ...e });
});

app.put('/api/enquiries/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM enquiries WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const merged = pickEnquiry({ ...existing, ...req.body });
  db.prepare(`
    UPDATE enquiries SET
      lead_name=@lead_name, contact_name=@contact_name, vertical=@vertical, phone=@phone, email=@email,
      source=@source, stage=@stage, estimated_value_thb=@estimated_value_thb,
      services_interested=@services_interested, notes=@notes, follow_up_date=@follow_up_date
    WHERE id=@id
  `).run({ ...merged, id: +req.params.id });

  if (existing.stage !== merged.stage) {
    logActivity('enquiry', +req.params.id, 'stage_change', `Stage: ${existing.stage} → ${merged.stage}`);
  }
  res.json({ id: +req.params.id, ...merged });
});

app.delete('/api/enquiries/:id', (req, res) => {
  db.prepare('DELETE FROM enquiries WHERE id=?').run(req.params.id);
  db.prepare("DELETE FROM activities WHERE entity_type='enquiry' AND entity_id=?").run(req.params.id);
  res.json({ ok: true });
});

app.patch('/api/enquiries/:id/stage', (req, res) => {
  const { stage } = req.body || {};
  if (!stage) return res.status(400).json({ error: 'stage required' });
  const existing = db.prepare('SELECT * FROM enquiries WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE enquiries SET stage=? WHERE id=?').run(stage, req.params.id);
  if (existing.stage !== stage) {
    logActivity('enquiry', +req.params.id, 'stage_change', `Stage: ${existing.stage} → ${stage}`);
  }
  res.json({ id: +req.params.id, stage });
});

// Convert enquiry -> client
app.post('/api/enquiries/:id/convert', (req, res) => {
  const enq = db.prepare('SELECT * FROM enquiries WHERE id=?').get(req.params.id);
  if (!enq) return res.status(404).json({ error: 'Not found' });

  const client = {
    name: enq.lead_name,
    contact_name: enq.contact_name,
    vertical: enq.vertical,
    phone: enq.phone,
    email: enq.email,
    website: null,
    source: enq.source,
    status: 'active',
    retainer_thb: enq.estimated_value_thb || 0,
    services: enq.services_interested || '[]',
    notes: enq.notes,
  };

  const info = db.prepare(`
    INSERT INTO clients (name, contact_name, vertical, phone, email, website, source, status, retainer_thb, services, notes)
    VALUES (@name, @contact_name, @vertical, @phone, @email, @website, @source, @status, @retainer_thb, @services, @notes)
  `).run(client);

  db.prepare("UPDATE enquiries SET stage='closed_won' WHERE id=?").run(req.params.id);

  logActivity('enquiry', +req.params.id, 'stage_change', `Converted to client #${info.lastInsertRowid}`);
  logActivity('client', info.lastInsertRowid, 'note', `Converted from enquiry #${req.params.id} "${enq.lead_name}"`);

  res.json({ client_id: info.lastInsertRowid });
});

// =================== ACTIVITIES ===================
app.get('/api/activities', (req, res) => {
  const { entity_type, entity_id } = req.query;
  let rows;
  if (entity_type && entity_id) {
    rows = db.prepare('SELECT * FROM activities WHERE entity_type=? AND entity_id=? ORDER BY created_at DESC').all(entity_type, entity_id);
  } else {
    rows = db.prepare('SELECT * FROM activities ORDER BY created_at DESC LIMIT 500').all();
  }
  // attach entity name
  rows = rows.map(a => {
    let entity_name = null;
    if (a.entity_type === 'client') {
      const r = db.prepare('SELECT name FROM clients WHERE id=?').get(a.entity_id);
      entity_name = r?.name ?? `Client #${a.entity_id}`;
    } else if (a.entity_type === 'enquiry') {
      const r = db.prepare('SELECT lead_name FROM enquiries WHERE id=?').get(a.entity_id);
      entity_name = r?.lead_name ?? `Enquiry #${a.entity_id}`;
    }
    return { ...a, entity_name };
  });
  res.json(rows);
});

app.post('/api/activities', (req, res) => {
  const { entity_type, entity_id, type, description } = req.body || {};
  if (!entity_type || !entity_id || !type || !description) {
    return res.status(400).json({ error: 'entity_type, entity_id, type, description required' });
  }
  const info = db.prepare(`
    INSERT INTO activities (entity_type, entity_id, type, description)
    VALUES (?, ?, ?, ?)
  `).run(entity_type, entity_id, type, description);
  res.json({ id: info.lastInsertRowid });
});

// =================== DASHBOARD ===================
app.get('/api/dashboard', (req, res) => {
  const mrr_row = db.prepare("SELECT COALESCE(SUM(retainer_thb),0) AS s FROM clients WHERE status='active'").get();
  const active_clients = db.prepare("SELECT COUNT(*) AS c FROM clients WHERE status='active'").get().c;

  const placeholders = OPEN_STAGES.map(() => '?').join(',');
  const open_enquiries = db.prepare(`SELECT COUNT(*) AS c FROM enquiries WHERE stage IN (${placeholders})`).get(...OPEN_STAGES).c;
  const pipeline_value = db.prepare(`SELECT COALESCE(SUM(estimated_value_thb),0) AS s FROM enquiries WHERE stage IN (${placeholders})`).get(...OPEN_STAGES).s;

  const stageRows = db.prepare('SELECT stage, COUNT(*) AS c FROM enquiries GROUP BY stage').all();
  const enquiries_by_stage = {};
  for (const r of stageRows) enquiries_by_stage[r.stage] = r.c;

  const vertRows = db.prepare("SELECT vertical, COUNT(*) AS c FROM clients WHERE status='active' GROUP BY vertical").all();
  const clients_by_vertical = {};
  for (const r of vertRows) clients_by_vertical[r.vertical || 'other'] = r.c;

  let recent = db.prepare('SELECT * FROM activities ORDER BY created_at DESC LIMIT 10').all();
  recent = recent.map(a => {
    let entity_name = null;
    if (a.entity_type === 'client') {
      entity_name = db.prepare('SELECT name FROM clients WHERE id=?').get(a.entity_id)?.name ?? null;
    } else {
      entity_name = db.prepare('SELECT lead_name FROM enquiries WHERE id=?').get(a.entity_id)?.lead_name ?? null;
    }
    return { ...a, entity_name };
  });

  res.json({
    mrr_thb: mrr_row.s,
    active_clients,
    open_enquiries,
    pipeline_value_thb: pipeline_value,
    enquiries_by_stage,
    clients_by_vertical,
    recent_activity: recent,
  });
});

// =================== CLI IMPORT ===================
app.post('/api/import/enquiry', (req, res) => {
  const body = req.body || {};
  if (!body.lead_name) return res.status(400).json({ error: 'lead_name required' });
  const e = pickEnquiry(body);
  const info = db.prepare(`
    INSERT INTO enquiries (lead_name, contact_name, vertical, phone, email, source, stage, estimated_value_thb, services_interested, notes, follow_up_date)
    VALUES (@lead_name, @contact_name, @vertical, @phone, @email, @source, @stage, @estimated_value_thb, @services_interested, @notes, @follow_up_date)
  `).run(e);
  logActivity('enquiry', info.lastInsertRowid, 'note', `Imported via CLI: "${e.lead_name}"`);
  res.json({ id: info.lastInsertRowid, ...e });
});

app.post('/api/import/client', (req, res) => {
  const body = req.body || {};
  if (!body.name) return res.status(400).json({ error: 'name required' });
  const c = pickClient(body);
  const info = db.prepare(`
    INSERT INTO clients (name, contact_name, vertical, phone, email, website, source, status, retainer_thb, services, notes)
    VALUES (@name, @contact_name, @vertical, @phone, @email, @website, @source, @status, @retainer_thb, @services, @notes)
  `).run(c);
  logActivity('client', info.lastInsertRowid, 'note', `Imported via CLI: "${c.name}"`);
  res.json({ id: info.lastInsertRowid, ...c });
});

// =================== META ADS WORKFLOW ===================
app.get('/api/meta-ads/summary', async (req, res) => {
  try {
    const result = await metaAds.runDailySummary();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------- start --------
app.listen(PORT, () => {
  console.log(`Locully CRM running on http://localhost:${PORT}`);
  metaAds.scheduleDailySummary();
});

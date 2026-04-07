const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'locully-crm.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_name TEXT,
    vertical TEXT,
    phone TEXT,
    email TEXT,
    website TEXT,
    source TEXT,
    status TEXT DEFAULT 'active',
    retainer_thb INTEGER DEFAULT 0,
    services TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS enquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_name TEXT NOT NULL,
    contact_name TEXT,
    vertical TEXT,
    phone TEXT,
    email TEXT,
    source TEXT,
    stage TEXT DEFAULT 'new',
    estimated_value_thb INTEGER DEFAULT 0,
    services_interested TEXT,
    notes TEXT,
    follow_up_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TRIGGER IF NOT EXISTS clients_updated_at
    AFTER UPDATE ON clients
    FOR EACH ROW
    BEGIN
      UPDATE clients SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;

  CREATE TRIGGER IF NOT EXISTS enquiries_updated_at
    AFTER UPDATE ON enquiries
    FOR EACH ROW
    BEGIN
      UPDATE enquiries SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;

  CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS idx_enquiries_stage ON enquiries(stage);
  CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
`);

function seedIfEmpty() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM clients').get();
  if (row.c > 0) return;

  const seedClients = [
    { name: "Form Recovery & Wellness", vertical: "clinic", retainer_thb: 25000, services: JSON.stringify(["AIO","SEO"]), status: "active", source: "referral" },
    { name: "Cosmo Beauty Clinic", vertical: "clinic", retainer_thb: 15000, services: JSON.stringify(["AIO","SEO"]), status: "active", source: "cold_outreach" },
    { name: "Achyut Bhavan", vertical: "restaurant", retainer_thb: 12000, services: JSON.stringify(["Google Ads","Meta Ads"]), status: "active", source: "referral" },
    { name: "Opera Italian Restaurant", vertical: "restaurant", retainer_thb: 20000, services: JSON.stringify(["Google Ads"]), status: "active", source: "referral" },
    { name: "Iron Fairies", vertical: "hospitality", retainer_thb: 12000, services: JSON.stringify(["Google Ads","SEO"]), status: "active", source: "referral" },
    { name: "JaiDeeClear", vertical: "other", retainer_thb: 0, services: JSON.stringify(["Meta Ads"]), status: "active", source: "referral" },
    { name: "Valuation Masterclass", vertical: "professional_services", retainer_thb: 7000, services: JSON.stringify(["SEO"]), status: "active", source: "inbound" }
  ];

  const insert = db.prepare(`
    INSERT INTO clients (name, vertical, retainer_thb, services, status, source)
    VALUES (@name, @vertical, @retainer_thb, @services, @status, @source)
  `);
  const tx = db.transaction((rows) => { for (const r of rows) insert.run(r); });
  tx(seedClients);
  console.log(`Seeded ${seedClients.length} clients.`);
}

seedIfEmpty();

module.exports = db;

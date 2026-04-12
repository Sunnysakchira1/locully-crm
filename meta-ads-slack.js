/**
 * Meta Ads Daily Summary Workflow
 *
 * Fetches Meta Ads data from Windsor.ai, generates an expert-level
 * summary with per-account breakdowns and actionable insights, then
 * delivers it to Slack and email every morning at 08:00 Bangkok time.
 */

const cron = require('node-cron');
const nodemailer = require('nodemailer');

// ─── Windsor.ai fetch ───────────────────────────────────

const WINDSOR_BASE = 'https://connectors.windsor.ai/facebook';
const FIELDS = [
  'date', 'account_name', 'campaign', 'spend', 'impressions',
  'clicks', 'ctr', 'cpc', 'cpm', 'conversions'
].join(',');

async function fetchMetaAdsData(dateFrom, dateTo) {
  const key = process.env.WINDSOR_API_KEY;
  if (!key) throw new Error('WINDSOR_API_KEY not set in .env');

  const url = `${WINDSOR_BASE}?api_key=${encodeURIComponent(key)}&fields=${FIELDS}&date_from=${dateFrom}&date_to=${dateTo}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Windsor API ${res.status}: ${body}`);
  }
  const json = await res.json();
  return json.data || [];
}

// ─── Analysis helpers ───────────────────────────────────

function num(v) { return Number(v) || 0; }
function fmt(n) { return n.toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function pct(n) { return (n * 100).toFixed(2) + '%'; }
function thb(n) { return '฿' + fmt(n); }

function analyseData(rows) {
  // Group by account
  const accounts = {};
  for (const r of rows) {
    const acct = r.account_name || 'Unknown Account';
    if (!accounts[acct]) accounts[acct] = { campaigns: {}, totals: { spend: 0, impressions: 0, clicks: 0, conversions: 0 } };
    const a = accounts[acct];

    a.totals.spend += num(r.spend);
    a.totals.impressions += num(r.impressions);
    a.totals.clicks += num(r.clicks);
    a.totals.conversions += num(r.conversions);

    const camp = r.campaign || 'Unnamed';
    if (!a.campaigns[camp]) a.campaigns[camp] = { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
    const c = a.campaigns[camp];
    c.spend += num(r.spend);
    c.impressions += num(r.impressions);
    c.clicks += num(r.clicks);
    c.conversions += num(r.conversions);
  }

  // Compute derived metrics per campaign
  for (const acct of Object.values(accounts)) {
    for (const c of Object.values(acct.campaigns)) {
      c.ctr = c.impressions > 0 ? c.clicks / c.impressions : 0;
      c.cpc = c.clicks > 0 ? c.spend / c.clicks : 0;
      c.cpa = c.conversions > 0 ? c.spend / c.conversions : 0;
    }
    const t = acct.totals;
    t.ctr = t.impressions > 0 ? t.clicks / t.impressions : 0;
    t.cpc = t.clicks > 0 ? t.spend / t.clicks : 0;
    t.cpa = t.conversions > 0 ? t.spend / t.conversions : 0;
  }

  return accounts;
}

function generateInsights(accounts) {
  const insights = [];

  for (const [name, acct] of Object.entries(accounts)) {
    const campaigns = Object.entries(acct.campaigns);

    // Flag high-spend, zero-conversion campaigns
    for (const [camp, m] of campaigns) {
      if (m.spend > 0 && m.conversions === 0) {
        insights.push(`*${camp}* (${name}) spent ${thb(m.spend)} with zero conversions — consider pausing or revising the creative/audience.`);
      }
    }

    // Flag low CTR (below 1%)
    for (const [camp, m] of campaigns) {
      if (m.impressions > 500 && m.ctr < 0.01) {
        insights.push(`*${camp}* (${name}) CTR is only ${pct(m.ctr)} — ad creative may need refreshing or audience targeting may be too broad.`);
      }
    }

    // Flag high CPC (above 50 THB)
    for (const [camp, m] of campaigns) {
      if (m.clicks > 10 && m.cpc > 50) {
        insights.push(`*${camp}* (${name}) CPC is ${thb(m.cpc)} — unusually high. Check auction overlap, audience saturation, or bid strategy.`);
      }
    }

    // Highlight best performer
    if (campaigns.length > 1) {
      const best = campaigns.reduce((a, b) => (a[1].conversions > b[1].conversions ? a : b));
      if (best[1].conversions > 0) {
        insights.push(`Top performer in *${name}*: *${best[0]}* with ${best[1].conversions} conversions at ${thb(best[1].cpa)} CPA.`);
      }
    }
  }

  if (insights.length === 0) {
    insights.push('No notable anomalies detected. Performance looks steady.');
  }

  return insights;
}

// ─── Format for Slack (Block Kit) ───────────────────────

function buildSlackPayload(accounts, insights, dateLabel) {
  const blocks = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `Meta Ads Daily Report — ${dateLabel}` }
  });
  blocks.push({ type: 'divider' });

  // Per-account sections
  for (const [name, acct] of Object.entries(accounts)) {
    const t = acct.totals;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*${name}*`,
          `> Spend: *${thb(t.spend)}*  |  Impressions: *${fmt(t.impressions)}*  |  Clicks: *${fmt(t.clicks)}*`,
          `> Conversions: *${fmt(t.conversions)}*  |  CTR: *${pct(t.ctr)}*  |  CPC: *${thb(t.cpc)}*  |  CPA: *${t.conversions > 0 ? thb(t.cpa) : 'N/A'}*`
        ].join('\n')
      }
    });

    // Campaign breakdown
    const campLines = Object.entries(acct.campaigns).map(([camp, c]) =>
      `  *${camp}*  —  ${thb(c.spend)} spend | ${fmt(c.clicks)} clicks | ${c.conversions} conv | CTR ${pct(c.ctr)}`
    );
    if (campLines.length > 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: campLines.join('\n') }
      });
    }
    blocks.push({ type: 'divider' });
  }

  // Insights
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*Insights & Action Items*\n' + insights.map(i => `• ${i}`).join('\n')
    }
  });

  return { blocks };
}

// ─── Format for Email (HTML) ────────────────────────────

function buildEmailHtml(accounts, insights, dateLabel) {
  const css = `
    body { font-family: -apple-system, Arial, sans-serif; color: #1a1a1a; max-width: 640px; margin: 0 auto; padding: 20px; }
    h1 { color: #E07B39; font-size: 20px; }
    h2 { color: #333; font-size: 16px; margin-top: 24px; border-bottom: 1px solid #E5E0D8; padding-bottom: 4px; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eee; font-size: 13px; }
    th { background: #F8F5F0; font-weight: 600; }
    .metric { font-size: 14px; margin: 4px 0; }
    .metric b { color: #E07B39; }
    .insights li { margin: 6px 0; font-size: 13px; }
    .footer { margin-top: 24px; font-size: 11px; color: #999; }
  `;

  let html = `<html><head><style>${css}</style></head><body>`;
  html += `<h1>Meta Ads Daily Report — ${dateLabel}</h1>`;

  for (const [name, acct] of Object.entries(accounts)) {
    const t = acct.totals;
    html += `<h2>${name}</h2>`;
    html += `<p class="metric">Spend: <b>${thb(t.spend)}</b> &nbsp;|&nbsp; Impressions: <b>${fmt(t.impressions)}</b> &nbsp;|&nbsp; Clicks: <b>${fmt(t.clicks)}</b> &nbsp;|&nbsp; Conversions: <b>${fmt(t.conversions)}</b></p>`;
    html += `<p class="metric">CTR: <b>${pct(t.ctr)}</b> &nbsp;|&nbsp; CPC: <b>${thb(t.cpc)}</b> &nbsp;|&nbsp; CPA: <b>${t.conversions > 0 ? thb(t.cpa) : 'N/A'}</b></p>`;

    html += `<table><tr><th>Campaign</th><th>Spend</th><th>Clicks</th><th>Conv</th><th>CTR</th><th>CPC</th></tr>`;
    for (const [camp, c] of Object.entries(acct.campaigns)) {
      html += `<tr><td>${camp}</td><td>${thb(c.spend)}</td><td>${fmt(c.clicks)}</td><td>${c.conversions}</td><td>${pct(c.ctr)}</td><td>${thb(c.cpc)}</td></tr>`;
    }
    html += `</table>`;
  }

  html += `<h2>Insights & Action Items</h2><ul class="insights">`;
  for (const i of insights) {
    html += `<li>${i.replace(/\*/g, '')}</li>`;
  }
  html += `</ul>`;
  html += `<p class="footer">Sent by Locully CRM • ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' })}</p>`;
  html += `</body></html>`;
  return html;
}

// ─── Delivery ───────────────────────────────────────────

async function sendToSlack(payload) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url || url.includes('YOUR/WEBHOOK/URL')) {
    console.log('[meta-ads] Slack webhook not configured — skipping Slack delivery.');
    return false;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('[meta-ads] Slack error:', res.status, body);
    return false;
  }
  console.log('[meta-ads] Slack message sent.');
  return true;
}

async function sendEmail(subject, html) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass || user === 'your-email@gmail.com') {
    console.log('[meta-ads] SMTP not configured — skipping email delivery.');
    return false;
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || user,
    to: process.env.EMAIL_TO || 'sunny@locully.org',
    subject,
    html,
  });
  console.log('[meta-ads] Email sent to', process.env.EMAIL_TO || 'sunny@locully.org');
  return true;
}

// ─── Orchestrator ───────────────────────────────────────

async function runDailySummary() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().slice(0, 10);
  const dateLabel = yesterday.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'short', year: 'numeric',
    timeZone: 'Asia/Bangkok'
  });

  console.log(`[meta-ads] Fetching Meta Ads data for ${dateStr}…`);
  const rows = await fetchMetaAdsData(dateStr, dateStr);

  if (rows.length === 0) {
    console.log('[meta-ads] No data returned for', dateStr);
    return { ok: true, date: dateStr, message: 'No ad data for this date.' };
  }

  const accounts = analyseData(rows);
  const insights = generateInsights(accounts);

  // Build payloads
  const slackPayload = buildSlackPayload(accounts, insights, dateLabel);
  const emailSubject = `Meta Ads Report — ${dateLabel}`;
  const emailHtml = buildEmailHtml(accounts, insights, dateLabel);

  // Deliver (both run in parallel, neither blocks the other)
  const [slackOk, emailOk] = await Promise.allSettled([
    sendToSlack(slackPayload),
    sendEmail(emailSubject, emailHtml),
  ]);

  const summary = {
    ok: true,
    date: dateStr,
    accounts: Object.keys(accounts).length,
    totalCampaigns: Object.values(accounts).reduce((s, a) => s + Object.keys(a.campaigns).length, 0),
    insights: insights.length,
    slackSent: slackOk.status === 'fulfilled' && slackOk.value,
    emailSent: emailOk.status === 'fulfilled' && emailOk.value,
  };
  console.log('[meta-ads] Summary delivered:', summary);
  return summary;
}

// ─── Scheduler ──────────────────────────────────────────

function scheduleDailySummary() {
  // Every day at 08:00 Bangkok time
  cron.schedule('0 8 * * *', () => {
    runDailySummary().catch(err => console.error('[meta-ads] Scheduled run failed:', err.message));
  }, { timezone: 'Asia/Bangkok' });

  console.log('[meta-ads] Daily summary scheduled for 08:00 Asia/Bangkok.');
}

module.exports = { runDailySummary, scheduleDailySummary, fetchMetaAdsData };

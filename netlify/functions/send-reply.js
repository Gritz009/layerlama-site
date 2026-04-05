// netlify/functions/send-reply.js
// Sends Gmail email to commission customer + updates Notion record

const nodemailer = require('nodemailer');

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Shared-secret auth
  const providedSecret = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'];
  if (!process.env.ADMIN_SECRET || providedSecret !== process.env.ADMIN_SECRET) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const { GMAIL_USER, GMAIL_APP_PASSWORD, NOTION_TOKEN } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !NOTION_TOKEN) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { recordId, to, subject, body, quotedPrice, newStatus, appendNotes } = payload;
  if (!recordId || !to || !subject || !body) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing recordId, to, subject, or body' }) };
  }

  // 1. Send email via Gmail SMTP
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });

    await transporter.sendMail({
      from: `"Layer Lama" <${GMAIL_USER}>`,
      to,
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>'),
    });
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Email send failed', details: err.message }) };
  }

  // 2. Update Notion record with reply log, optional status, optional quoted price
  try {
    const propertiesUpdate = {};

    if (newStatus) {
      propertiesUpdate['Status'] = { status: { name: newStatus } };
    }

    if (typeof quotedPrice === 'number' && !isNaN(quotedPrice)) {
      propertiesUpdate['Quoted Price'] = { number: quotedPrice };
    }

    if (appendNotes) {
      // Append timestamped reply to existing Notes
      const timestamp = new Date().toISOString().split('T')[0];
      const logEntry = `\n\n[${timestamp}] Replied:\n${body}`;
      propertiesUpdate['Notes'] = {
        rich_text: [{ type: 'text', text: { content: (appendNotes + logEntry).slice(0, 2000) } }],
      };
    }

    if (Object.keys(propertiesUpdate).length > 0) {
      const res = await fetch(`${NOTION_API}/pages/${recordId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties: propertiesUpdate }),
      });

      if (!res.ok) {
        const errText = await res.text();
        // Email sent but Notion update failed — report partial success
        return {
          statusCode: 207,
          headers: corsHeaders,
          body: JSON.stringify({ emailSent: true, notionUpdated: false, notionError: errText }),
        };
      }
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailSent: true, notionUpdated: true }),
    };
  } catch (err) {
    return {
      statusCode: 207,
      headers: corsHeaders,
      body: JSON.stringify({ emailSent: true, notionUpdated: false, error: err.message }),
    };
  }
};

// netlify/functions/list-commissions.js
// Returns all commission request records from Notion

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Shared-secret auth — admin.html sends X-Admin-Secret header
  const providedSecret = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'];
  if (!process.env.ADMIN_SECRET || providedSecret !== process.env.ADMIN_SECRET) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const token = process.env.NOTION_TOKEN;
  const dbId = process.env.NOTION_DB_ID;
  if (!token || !dbId) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  try {
    // Query the database — sorted by Submitted date, newest first
    const res = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sorts: [{ property: 'Submitted', direction: 'descending' }],
        page_size: 100,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Notion query failed', details: errText }) };
    }

    const data = await res.json();

    // Flatten Notion's verbose property structure into clean objects
    const records = data.results.map((page) => {
      const p = page.properties;
      return {
        id: page.id,
        url: page.url,
        created: page.created_time,
        projectName: extractTitle(p['Project Name']),
        clientName: extractText(p['Client Name']),
        email: p['Email']?.email || '',
        details: extractText(p['Details']),
        notes: extractText(p['Notes']),
        requestId: extractText(p['Request ID']),
        projectType: p['Project Type']?.select?.name || '',
        priority: p['Priority']?.select?.name || '',
        status: p['Status']?.status?.name || '',
        quotedPrice: p['Quoted Price']?.number ?? null,
        submitted: p['Submitted']?.date?.start || null,
      };
    });

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: records.length, records }),
    };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};

function extractTitle(prop) {
  if (!prop?.title?.length) return '';
  return prop.title.map((t) => t.plain_text).join('');
}

function extractText(prop) {
  if (!prop?.rich_text?.length) return '';
  return prop.rich_text.map((t) => t.plain_text).join('');
}

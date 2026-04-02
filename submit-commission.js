exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const data = JSON.parse(event.body);
    const NOTION_TOKEN = process.env.NOTION_TOKEN;
    const NOTION_DB_ID = process.env.NOTION_DB_ID;

    if (!NOTION_TOKEN || !NOTION_DB_ID) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server config missing' }) };
    }

    // Map project type from form to Notion select options
    const projectTypeMap = {
      'Custom Print (I have a file)': 'Custom Print',
      'Design + Print (from scratch)': 'Design + Print',
      'Rapid Prototyping': 'Prototype',
      'Art & Décor': 'Art & Decor',
      'Miniatures & Gaming': 'Miniatures & Gaming',
      'Workshops & Education': 'Workshop / Education',
      'Other / Not Sure': 'Other'
    };

    const projectType = projectTypeMap[data['project-type']] || projectTypeMap[data.project_type] || 'Other';
    const clientName = data.name || 'Unknown';
    const email = data.email || '';
    const details = data.details || '';
    const now = new Date();
    const requestId = now.toISOString().replace(/[-:T]/g, '').substring(0, 15);
    const submitted = now.toISOString().split('T')[0];

    // Create Notion page
    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parent: { database_id: NOTION_DB_ID },
        properties: {
          'Project Name': { title: [{ text: { content: `${clientName} - ${projectType}` } }] },
          'Client Name': { rich_text: [{ text: { content: clientName } }] },
          'Email': { email: email },
          'Project Type': { select: { name: projectType } },
          'Details': { rich_text: [{ text: { content: details.substring(0, 2000) } }] },
          'Status': { status: { name: 'Not started' } },
          'Request ID': { rich_text: [{ text: { content: requestId } }] },
          'Submitted': { date: { start: submitted } }
        }
      })
    });

    const notionData = await notionRes.json();

    if (!notionRes.ok) {
      console.error('Notion API error:', JSON.stringify(notionData));
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to save to Notion', detail: notionData.message })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, id: notionData.id })
    };

  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};

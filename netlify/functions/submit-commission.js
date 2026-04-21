// RFC-5322-lite check. Catches blank/malformed emails that would otherwise
// fail the Make.com Gmail module with BundleValidationError (see the
// 2026-04-14 silent-stop incident in docs/11-TROUBLESHOOTING.md).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // Guard against oversized payloads (Netlify Functions hard-limit is ~6 MB
    // but we keep the form JSON well under that — uploadedFiles are URLs only).
    if (event.body && event.body.length > 200000) {
      return { statusCode: 413, headers, body: JSON.stringify({ error: 'Payload too large' }) };
    }

    const data = JSON.parse(event.body);

    // Honeypot — if a bot filled the hidden "bot-field", silently accept
    // (return 200 so the bot thinks it worked, but do nothing).
    if (data['bot-field']) {
      console.log('Honeypot triggered, ignoring submission');
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // GDPR consent — required. The form checkbox enforces client-side,
    // this enforces server-side so direct-to-API submissions can't bypass.
    if (data.consent !== 'yes' && data.consent !== true && data.consent !== 'on') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Consent required' }) };
    }

    const NOTION_TOKEN = process.env.NOTION_TOKEN;
    const NOTION_DB_ID = process.env.NOTION_DB_ID;

    if (!NOTION_TOKEN || !NOTION_DB_ID) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server config missing' }) };
    }

    const projectTypeMap = {
      'Custom Print (I have a file)': 'Custom Print',
      'Design + Print (from scratch)': 'Design + Print',
      'Prototype / Iteration': 'Prototype',
      'Rapid Prototyping': 'Prototype',
      'Art & Décor': 'Art & Decor',
      'Miniatures & Gaming': 'Miniatures & Gaming',
      'Workshop / Education': 'Workshop / Education',
      'Workshops & Education': 'Workshop / Education',
      'Other / Not Sure': 'Other',
      'Other': 'Other'
    };

    const projectType = projectTypeMap[data['project-type']] || projectTypeMap[data.project_type] || 'Other';
    const clientName = (data.name || 'Unknown').toString().trim().slice(0, 100);
    const email = (data.email || '').toString().trim().slice(0, 254);
    const details = (data.details || '').toString().slice(0, 2000);
    const referenceLinks = (data['reference-links'] || '').toString().slice(0, 4000);
    const uploadedFiles = Array.isArray(data.uploadedFiles) ? data.uploadedFiles : [];
    const attachmentNames = (data.attachment_names || '').toString().slice(0, 1000);
    const attachmentCount = Number(data.attachment_count) || 0;

    // Validate email. If invalid, reject before touching Notion/Make — both
    // would fail downstream anyway (Make Gmail module returns BundleValidationError
    // on blank/malformed addresses, which silently auto-pauses the scenario).
    const emailValid = EMAIL_RE.test(email);
    if (!emailValid) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email address' }) };
    }

    // Basic length validation for required fields
    if (!clientName || clientName === 'Unknown') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name required' }) };
    }
    const now = new Date();
    const requestId = 'LL-' + now.toISOString().replace(/[-:T]/g, '').substring(0, 8) + '-' + now.toISOString().replace(/[-:T]/g, '').substring(8, 12);
    const submitted = now.toISOString().split('T')[0];

    // Build notes summary
    const notesParts = [];
    if (referenceLinks.trim()) notesParts.push('Reference Links:\n' + referenceLinks.trim());
    if (uploadedFiles.length > 0) {
      notesParts.push('Uploaded Files (' + uploadedFiles.length + '):\n' + uploadedFiles.map(f => f.name + ': ' + f.url).join('\n'));
    } else if (attachmentNames) {
      notesParts.push('Attachments: ' + attachmentNames);
    }
    const notes = notesParts.join('\n\n');

    // Build Notion page content blocks
    const children = [];

    if (details) {
      children.push({
        object: 'block', type: 'callout',
        callout: { icon: { type: 'emoji', emoji: '📋' }, rich_text: [{ type: 'text', text: { content: details.substring(0, 2000) } }] }
      });
    }

    // Reference links as bookmarks
    if (referenceLinks.trim()) {
      children.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '📎 Reference Links' } }] } });
      const links = referenceLinks.trim().split('\n').filter(l => l.trim());
      for (const link of links) {
        const trimmed = link.trim();
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          children.push({ object: 'block', type: 'bookmark', bookmark: { url: trimmed } });
        } else {
          children.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: trimmed } }] } });
        }
      }
    }

    // Uploaded files as links and images in Notion
    if (uploadedFiles.length > 0) {
      children.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '📁 Uploaded Files' } }] } });

      for (const file of uploadedFiles) {
        const isImage = (file.type && file.type.startsWith('image/')) || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.name);

        if (isImage) {
          children.push({
            object: 'block', type: 'image',
            image: { type: 'external', external: { url: file.url } }
          });
          children.push({
            object: 'block', type: 'paragraph',
            paragraph: { rich_text: [{ type: 'text', text: { content: file.name }, annotations: { italic: true, color: 'gray' } }] }
          });
        } else {
          // Non-image files as download links
          children.push({
            object: 'block', type: 'paragraph',
            paragraph: { rich_text: [
              { type: 'text', text: { content: '📄 ' } },
              { type: 'text', text: { content: file.name, link: { url: file.url } }, annotations: { bold: true } },
              { type: 'text', text: { content: ' — Click to download' }, annotations: { color: 'gray' } }
            ] }
          });
        }
      }
    }

    // Create Notion page
    const pageBody = {
      parent: { database_id: NOTION_DB_ID },
      properties: {
        'Project Name': { title: [{ text: { content: clientName + ' - ' + projectType } }] },
        'Client Name': { rich_text: [{ text: { content: clientName } }] },
        'Email': { email: email },
        'Project Type': { select: { name: projectType } },
        'Details': { rich_text: [{ text: { content: details.substring(0, 2000) } }] },
        'Status': { status: { name: 'Not started' } },
        'Request ID': { rich_text: [{ text: { content: requestId } }] },
        'Submitted': { date: { start: submitted } },
        'Notes': { rich_text: [{ text: { content: notes.substring(0, 2000) } }] }
      }
    };

    if (children.length > 0) pageBody.children = children;

    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + NOTION_TOKEN,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(pageBody)
    });

    const notionData = await notionRes.json();

    if (!notionRes.ok) {
      console.error('Notion API error:', JSON.stringify(notionData));
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to save to Notion', detail: notionData.message }) };
    }

    // Trigger auto-reply email via Make.com webhook — only if email looks valid.
    // Logs response body on non-2xx so silent Make failures surface in Netlify
    // function logs (previously only the status code was visible).
    if (emailValid) {
      try {
        const makeRes = await fetch('https://hook.eu1.make.com/5nbqf7mxih1fks67u1jqusz78596y4hj', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: clientName,
            email: email,
            projectType: projectType,
            requestId: requestId,
            submitted: submitted
          })
        });
        if (!makeRes.ok) {
          const makeBody = await makeRes.text().catch(() => '<unreadable>');
          console.error('Auto-reply webhook non-2xx:', makeRes.status, makeBody.slice(0, 500));
        }
      } catch (emailErr) {
        console.error('Auto-reply webhook error:', emailErr.message);
      }
    } else {
      console.log('Skipping auto-reply webhook: email invalid');
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, id: notionData.id, uploaded: uploadedFiles.length })
    };

  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

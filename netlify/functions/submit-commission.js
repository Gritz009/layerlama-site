exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

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
    const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
    const CLOUD_KEY = process.env.CLOUDINARY_API_KEY;
    const CLOUD_SECRET = process.env.CLOUDINARY_API_SECRET;

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
    const clientName = data.name || 'Unknown';
    const email = data.email || '';
    const details = data.details || '';
    const referenceLinks = data['reference-links'] || '';
    const now = new Date();
    const requestId = now.toISOString().replace(/[-:T]/g, '').substring(0, 15);
    const submitted = now.toISOString().split('T')[0];

    // Upload files to Cloudinary if credentials exist and files are provided
    const uploadedFiles = [];
    const files = data.files || [];

    if (CLOUD_NAME && CLOUD_KEY && CLOUD_SECRET && files.length > 0) {
      for (const file of files) {
        try {
          // file.data is a base64 data URL like "data:image/png;base64,..."
          const timestamp = Math.floor(Date.now() / 1000);
          const folder = 'layerlama/commissions/' + requestId;

          // Generate signature for Cloudinary upload
          const crypto = require('crypto');
          const signStr = 'folder=' + folder + '&timestamp=' + timestamp + CLOUD_SECRET;
          const signature = crypto.createHash('sha1').update(signStr).digest('hex');

          const formBody = new URLSearchParams();
          formBody.append('file', file.data);
          formBody.append('api_key', CLOUD_KEY);
          formBody.append('timestamp', timestamp.toString());
          formBody.append('folder', folder);
          formBody.append('signature', signature);
          formBody.append('resource_type', 'auto');

          const uploadRes = await fetch(
            'https://api.cloudinary.com/v1_1/' + CLOUD_NAME + '/auto/upload',
            { method: 'POST', body: formBody }
          );

          const uploadData = await uploadRes.json();

          if (uploadData.secure_url) {
            uploadedFiles.push({
              name: file.name,
              url: uploadData.secure_url,
              size: file.size,
              type: file.type || 'file'
            });
          }
        } catch (uploadErr) {
          console.error('Cloudinary upload error for', file.name, ':', uploadErr.message);
        }
      }
    }

    // Build notes
    const notesParts = [];
    if (referenceLinks.trim()) notesParts.push('Reference Links:\n' + referenceLinks.trim());
    if (uploadedFiles.length > 0) {
      notesParts.push('Uploaded Files (' + uploadedFiles.length + '):\n' + uploadedFiles.map(f => f.name + ': ' + f.url).join('\n'));
    } else if (data.attachment_names) {
      notesParts.push('Attachments: ' + data.attachment_names);
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
        const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.name);

        if (isImage) {
          // Show images directly in Notion
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

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, id: notionData.id, uploaded: uploadedFiles.length })
    };

  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

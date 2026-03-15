const JSON_HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
};

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const PRESET_PREFIX = 'presets';
const COVER_PREFIX = 'covers';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/api/health') {
      return jsonResponse({
        ok: true,
        hasD1: !!env.ngnl_build,
        hasR2: !!env.ngnl,
        project: 'creative-workshop',
        d1Binding: 'ngnl_build',
        r2Binding: 'ngnl',
      });
    }

    if (url.pathname === '/api/db-test') {
      return handleDbTest(env);
    }

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (!env.ngnl_build) {
      return jsonResponse({ ok: false, error: 'D1 binding `ngnl_build` is not configured.' }, 500);
    }
    if (!env.ngnl) {
      return jsonResponse({ ok: false, error: 'R2 binding `ngnl` is not configured.' }, 500);
    }

    try {
      if (url.pathname === '/api/users/sync' && request.method === 'POST') {
        return handleUserSync(request, env);
      }

      if (url.pathname === '/api/presets' && request.method === 'GET') {
        return handlePresetList(request, env);
      }

      if (url.pathname === '/api/presets' && request.method === 'POST') {
        return handlePresetCreate(request, env, url);
      }

      const presetRouteMatch = url.pathname.match(/^\/api\/presets\/([^/]+)(?:\/(download|like|file|cover))?$/);
      if (presetRouteMatch) {
        const presetId = decodeURIComponent(presetRouteMatch[1]);
        const action = presetRouteMatch[2] || '';

        if (!action && request.method === 'GET') {
          return handlePresetGet(presetId, env, url);
        }
        if (!action && request.method === 'PUT') {
          return handlePresetUpdate(presetId, request, env, url);
        }
        if (!action && request.method === 'DELETE') {
          return handlePresetDelete(presetId, request, env);
        }
        if (action === 'download' && request.method === 'POST') {
          return handlePresetDownload(presetId, request, env, url);
        }
        if (action === 'like' && request.method === 'POST') {
          return handlePresetLikeToggle(presetId, request, env, url);
        }
        if (action === 'file' && request.method === 'GET') {
          return handlePresetFile(presetId, env);
        }
        if (action === 'cover' && request.method === 'GET') {
          return handlePresetCover(presetId, env);
        }
      }

      return jsonResponse({ ok: false, error: 'Not found.' }, 404);
    } catch (error) {
      console.error('Worker API error:', error);
      return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },
};

async function handleDbTest(env) {
  try {
    const row = await env.ngnl_build.prepare('SELECT 1 AS ok').first();
    return jsonResponse({ ok: true, row, hasR2: !!env.ngnl });
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

async function handleUserSync(request, env) {
  const body = await readJsonBody(request);
  const discordId = readString(body.discord_id || body.discordId || body.id);
  const username = readString(body.username);
  const avatarUrl = readString(body.avatar_url || body.avatarUrl);

  if (!discordId || !username) {
    return jsonResponse({ ok: false, error: 'discord_id and username are required.' }, 400);
  }

  await upsertUser(env.ngnl_build, { discordId, username, avatarUrl });
  return jsonResponse({ ok: true, user: { discord_id: discordId, username, avatar_url: avatarUrl } });
}

async function handlePresetList(request, env, baseUrl = null) {
  const url = baseUrl || new URL(request.url);
  const ownerDiscordId = readString(url.searchParams.get('owner_discord_id'));
  const viewerDiscordId = readString(url.searchParams.get('viewer_discord_id') || url.searchParams.get('user_discord_id'));
  const search = readString(url.searchParams.get('search'));
  const status = readString(url.searchParams.get('status')) || 'published';

  const whereClauses = ['p.status = ?'];
  const params = [status];

  if (ownerDiscordId) {
    whereClauses.push('p.owner_discord_id = ?');
    params.push(ownerDiscordId);
  }

  if (search) {
    whereClauses.push('(LOWER(p.title) LIKE ? OR LOWER(p.class_name) LIKE ? OR LOWER(p.race) LIKE ? OR LOWER(COALESCE(u.username, p.owner_discord_id)) LIKE ?)');
    const keyword = `%${search.toLowerCase()}%`;
    params.push(keyword, keyword, keyword, keyword);
  }

  const { results } = await env.ngnl_build
    .prepare(`
      SELECT
        p.id,
        p.owner_discord_id,
        p.title,
        p.intro,
        p.cover_url,
        p.cover_object_key,
        p.object_key,
        p.class_name,
        p.race,
        p.tags_json,
        p.preset_json,
        p.like_count,
        p.download_count,
        p.status,
        p.created_at,
        p.updated_at,
        CASE
          WHEN ? != '' AND EXISTS(
            SELECT 1 FROM preset_likes pl
            WHERE pl.preset_id = p.id AND pl.user_discord_id = ?
          ) THEN 1
          ELSE 0
        END AS liked,
        u.username,
        u.avatar_url
      FROM presets p
      LEFT JOIN users u ON u.discord_id = p.owner_discord_id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY datetime(p.updated_at) DESC, datetime(p.created_at) DESC
    `)
    .bind(viewerDiscordId, viewerDiscordId, ...params)
    .all();

  return jsonResponse({ ok: true, presets: (results || []).map((row) => mapPresetRow(row)) });
}

async function handlePresetGet(presetId, env, url = null) {
  const viewerDiscordId = readString(url?.searchParams.get('viewer_discord_id') || url?.searchParams.get('user_discord_id'));
  const row = await getPresetRow(env.ngnl_build, presetId, viewerDiscordId);
  if (!row) {
    return jsonResponse({ ok: false, error: 'Preset not found.' }, 404);
  }
  return jsonResponse({ ok: true, preset: mapPresetRow(row) });
}

async function handlePresetCreate(request, env) {
  const body = await readJsonBody(request);
  const payload = normalizePresetPayload(body);

  if (!payload.ownerDiscordId) {
    return jsonResponse({ ok: false, error: 'owner_discord_id is required.' }, 400);
  }
  if (!payload.title) {
    return jsonResponse({ ok: false, error: 'title is required.' }, 400);
  }
  if (!payload.presetData) {
    return jsonResponse({ ok: false, error: 'preset_json is required.' }, 400);
  }

  const presetId = payload.id || crypto.randomUUID();
  const rawPresetJson = payload.rawPresetJson || stringifyJson(payload.presetData);
  ensureSizeLimit(byteSize(rawPresetJson), 'Preset JSON');
  const previewPresetData = buildPreviewPresetData(payload.presetData);
  const objectKey = `${PRESET_PREFIX}/${presetId}.json`;

  await env.ngnl.put(objectKey, rawPresetJson, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });

  const coverResult = await syncCoverAsset({
    bucket: env.ngnl,
    coverUrl: payload.coverUrl,
    presetId,
    existingCoverObjectKey: '',
    allowReuseApiPath: false,
  });

  await upsertUser(env.ngnl_build, {
    discordId: payload.ownerDiscordId,
    username: payload.username || payload.author || payload.ownerDiscordId,
    avatarUrl: payload.avatarUrl,
  });

  await env.ngnl_build
    .prepare(`
      INSERT INTO presets (
        id,
        owner_discord_id,
        title,
        intro,
        cover_url,
        cover_object_key,
        object_key,
        class_name,
        race,
        tags_json,
        preset_json,
        like_count,
        download_count,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
    .bind(
      presetId,
      payload.ownerDiscordId,
      payload.title,
      payload.intro,
      coverResult.sourceUrl,
      coverResult.objectKey,
      objectKey,
      payload.className,
      payload.race,
      JSON.stringify(payload.tags),
      JSON.stringify(previewPresetData),
      payload.status,
    )
    .run();

  const row = await getPresetRow(env.ngnl_build, presetId);
  return jsonResponse({ ok: true, preset: mapPresetRow(row) }, 201);
}

async function handlePresetUpdate(presetId, request, env) {
  const body = await readJsonBody(request);
  const payload = normalizePresetPayload(body);
  const existingRow = await getPresetRow(env.ngnl_build, presetId);

  if (!existingRow) {
    return jsonResponse({ ok: false, error: 'Preset not found.' }, 404);
  }

  const ownerDiscordId = payload.ownerDiscordId || readString(body.owner_discord_id || body.ownerId);
  if (!ownerDiscordId || ownerDiscordId !== existingRow.owner_discord_id) {
    return jsonResponse({ ok: false, error: 'Only the owner can update this preset.' }, 403);
  }

  await upsertUser(env.ngnl_build, {
    discordId: ownerDiscordId,
    username: payload.username || payload.author || existingRow.username || ownerDiscordId,
    avatarUrl: payload.avatarUrl || existingRow.avatar_url || '',
  });

  const objectKey = readString(existingRow.object_key) || `${PRESET_PREFIX}/${presetId}.json`;
  let previewPresetData = safeJsonParse(existingRow.preset_json, null);
  if (payload.presetData) {
    previewPresetData = buildPreviewPresetData(payload.presetData);
  }
  if (payload.rawPresetJson) {
    ensureSizeLimit(byteSize(payload.rawPresetJson), 'Preset JSON');
    await env.ngnl.put(objectKey, payload.rawPresetJson, {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    });
  }

  const coverResult = await syncCoverAsset({
    bucket: env.ngnl,
    coverUrl: payload.coverUrl,
    presetId,
    existingCoverObjectKey: readString(existingRow.cover_object_key),
    allowReuseApiPath: true,
  });

  const mergedTags = payload.tags.length ? payload.tags : safeJsonParse(existingRow.tags_json, []);

  await env.ngnl_build
    .prepare(`
      UPDATE presets
      SET
        title = ?,
        intro = ?,
        cover_url = ?,
        cover_object_key = ?,
        object_key = ?,
        class_name = ?,
        race = ?,
        tags_json = ?,
        preset_json = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND owner_discord_id = ?
    `)
    .bind(
      payload.title || existingRow.title,
      payload.intro || '',
      coverResult.sourceUrl,
      coverResult.objectKey,
      objectKey,
      payload.className || existingRow.class_name || '',
      payload.race || existingRow.race || '',
      JSON.stringify(mergedTags),
      JSON.stringify(previewPresetData),
      payload.status || existingRow.status || 'published',
      presetId,
      ownerDiscordId,
    )
    .run();

  const row = await getPresetRow(env.ngnl_build, presetId);
  return jsonResponse({ ok: true, preset: mapPresetRow(row) });
}

async function handlePresetDelete(presetId, request, env) {
  const body = request.method === 'DELETE' ? await readJsonBody(request) : {};
  const url = new URL(request.url);
  const ownerDiscordId = readString(body.owner_discord_id || body.ownerId || url.searchParams.get('owner_discord_id') || url.searchParams.get('ownerId'));

  const existingRow = await getPresetRow(env.ngnl_build, presetId);
  if (!existingRow) {
    return jsonResponse({ ok: false, error: 'Preset not found.' }, 404);
  }
  if (!ownerDiscordId || ownerDiscordId !== existingRow.owner_discord_id) {
    return jsonResponse({ ok: false, error: 'Only the owner can delete this preset.' }, 403);
  }

  await deleteIfPresent(env.ngnl, readString(existingRow.object_key));
  await deleteIfPresent(env.ngnl, readString(existingRow.cover_object_key));

  await env.ngnl_build.batch([
    env.ngnl_build.prepare('DELETE FROM preset_likes WHERE preset_id = ?').bind(presetId),
    env.ngnl_build.prepare('DELETE FROM preset_download_events WHERE preset_id = ?').bind(presetId),
    env.ngnl_build.prepare('DELETE FROM presets WHERE id = ? AND owner_discord_id = ?').bind(presetId, ownerDiscordId),
  ]);

  return jsonResponse({ ok: true, deleted_id: presetId });
}

async function handlePresetDownload(presetId, request, env) {
  const existingRow = await getPresetRow(env.ngnl_build, presetId);
  if (!existingRow) {
    return jsonResponse({ ok: false, error: 'Preset not found.' }, 404);
  }

  const body = await readJsonBody(request);
  const userDiscordId = readString(body.user_discord_id || body.userId);
  const ipHash = await sha256Hex(request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || '');

  await env.ngnl_build.batch([
    env.ngnl_build.prepare('INSERT INTO preset_download_events (preset_id, user_discord_id, ip_hash) VALUES (?, ?, ?)').bind(presetId, userDiscordId || null, ipHash || null),
    env.ngnl_build.prepare('UPDATE presets SET download_count = download_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(presetId),
  ]);

  const row = await getPresetRow(env.ngnl_build, presetId);
  return jsonResponse({ ok: true, download_count: Number(row?.download_count || 0), preset: row ? mapPresetRow(row) : null });
}

async function handlePresetLikeToggle(presetId, request, env) {
  const body = await readJsonBody(request);
  const userDiscordId = readString(body.user_discord_id || body.userId);
  const username = readString(body.username);
  const avatarUrl = readString(body.avatar_url || body.avatarUrl);

  const existingRow = await getPresetRow(env.ngnl_build, presetId, userDiscordId);
  if (!existingRow) {
    return jsonResponse({ ok: false, error: 'Preset not found.' }, 404);
  }

  if (!userDiscordId) {
    return jsonResponse({ ok: false, error: 'user_discord_id is required.' }, 400);
  }

  if (username) {
    await upsertUser(env.ngnl_build, { discordId: userDiscordId, username, avatarUrl });
  }

  const likeRow = await env.ngnl_build.prepare('SELECT 1 AS liked FROM preset_likes WHERE preset_id = ? AND user_discord_id = ?').bind(presetId, userDiscordId).first();

  if (likeRow?.liked) {
    await env.ngnl_build.batch([
      env.ngnl_build.prepare('DELETE FROM preset_likes WHERE preset_id = ? AND user_discord_id = ?').bind(presetId, userDiscordId),
      env.ngnl_build.prepare('UPDATE presets SET like_count = MAX(like_count - 1, 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(presetId),
    ]);
  } else {
    await env.ngnl_build.batch([
      env.ngnl_build.prepare('INSERT INTO preset_likes (preset_id, user_discord_id) VALUES (?, ?)').bind(presetId, userDiscordId),
      env.ngnl_build.prepare('UPDATE presets SET like_count = like_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(presetId),
    ]);
  }

  const row = await getPresetRow(env.ngnl_build, presetId, userDiscordId);
  return jsonResponse({ ok: true, liked: !likeRow?.liked, like_count: Number(row?.like_count || 0), preset: row ? mapPresetRow(row) : null });
}

async function handlePresetFile(presetId, env) {
  const row = await getPresetRow(env.ngnl_build, presetId);
  if (!row) {
    return jsonResponse({ ok: false, error: 'Preset not found.' }, 404);
  }

  const objectKey = readString(row.object_key);
  if (!objectKey) {
    return jsonResponse({ ok: false, error: 'Preset file is missing.' }, 404);
  }

  const object = await env.ngnl.get(objectKey);
  if (!object) {
    return jsonResponse({ ok: false, error: 'Preset file not found in R2.' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', headers.get('content-type') || 'application/json; charset=utf-8');
  headers.set('content-disposition', buildAttachmentDisposition(`${sanitizeFilename(row.title || 'preset')}.json`));
  return new Response(object.body, { headers });
}

async function handlePresetCover(presetId, env) {
  const row = await getPresetRow(env.ngnl_build, presetId);
  if (!row) {
    return jsonResponse({ ok: false, error: 'Preset not found.' }, 404);
  }

  const objectKey = readString(row.cover_object_key);
  if (!objectKey) {
    if (readString(row.cover_url)) {
      return Response.redirect(readString(row.cover_url), 302);
    }
    return jsonResponse({ ok: false, error: 'Cover not found.' }, 404);
  }

  const object = await env.ngnl.get(objectKey);
  if (!object) {
    return jsonResponse({ ok: false, error: 'Cover file not found in R2.' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('cache-control', 'public, max-age=3600');
  return new Response(object.body, { headers });
}

async function getPresetRow(db, presetId, viewerDiscordId = '') {
  return db
    .prepare(`
      SELECT
        p.id,
        p.owner_discord_id,
        p.title,
        p.intro,
        p.cover_url,
        p.cover_object_key,
        p.object_key,
        p.class_name,
        p.race,
        p.tags_json,
        p.preset_json,
        p.like_count,
        p.download_count,
        p.status,
        p.created_at,
        p.updated_at,
        CASE
          WHEN ? != '' AND EXISTS(
            SELECT 1 FROM preset_likes pl
            WHERE pl.preset_id = p.id AND pl.user_discord_id = ?
          ) THEN 1
          ELSE 0
        END AS liked,
        u.username,
        u.avatar_url
      FROM presets p
      LEFT JOIN users u ON u.discord_id = p.owner_discord_id
      WHERE p.id = ?
      LIMIT 1
    `)
    .bind(viewerDiscordId, viewerDiscordId, presetId)
    .first();
}

function normalizePresetPayload(body) {
  const presetData = body.presetData ?? body.preset_json ?? null;
  const tags = Array.isArray(body.tags)
    ? body.tags.map((item) => readString(typeof item === 'string' ? item : item?.text)).filter(Boolean)
    : [];

  return {
    id: readString(body.id),
    ownerDiscordId: readString(body.owner_discord_id || body.ownerDiscordId || body.ownerId),
    username: readString(body.username || body.owner_name || body.ownerName || body.author),
    avatarUrl: readString(body.avatar_url || body.avatarUrl || body.authorAvatar),
    author: readString(body.author),
    title: readString(body.title || body.name || presetData?.name),
    intro: readString(body.intro || body.summary),
    coverUrl: readString(body.cover_url || body.coverUrl || presetData?.avatar),
    className: readString(body.class_name || body.className || presetData?.class || presetData?.customClassName),
    race: readString(body.race || presetData?.race || presetData?.customRace?.name || presetData?.customRace),
    status: readString(body.status) || 'published',
    tags,
    presetData,
    rawPresetJson: typeof body.preset_raw_json === 'string' ? body.preset_raw_json : '',
  };
}

function buildPreviewPresetData(presetData) {
  if (!presetData || typeof presetData !== 'object') {
    return null;
  }

  const customRace = presetData.customRace && typeof presetData.customRace === 'object'
    ? { name: presetData.customRace.name }
    : presetData.customRace;

  return compactObject({
    name: presetData.name,
    class: presetData.class,
    customClassName: presetData.customClassName,
    race: presetData.race,
    customRace,
    customClassStyle: presetData.customClassStyle,
    backstory: presetData.backstory,
    selectedCustomLevel: presetData.selectedCustomLevel,
  });
}
function mapPresetRow(row) {
  return {
    id: row.id,
    ownerId: row.owner_discord_id,
    ownerName: row.username || row.owner_discord_id,
    author: row.username || row.owner_discord_id,
    authorAvatar: row.avatar_url || '',
    name: row.title,
    title: row.title,
    intro: row.intro || '',
    coverUrl: readString(row.cover_object_key) ? `/api/presets/${encodeURIComponent(row.id)}/cover` : (row.cover_url || ''),
    className: row.class_name || '',
    race: row.race || '',
    tags: safeJsonParse(row.tags_json, []),
    likes: Number(row.like_count || 0),
    liked: Boolean(Number(row.liked || 0)),
    downloads: Number(row.download_count || 0),
    status: row.status || 'published',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    presetData: safeJsonParse(row.preset_json, null),
    downloadUrl: `/api/presets/${encodeURIComponent(row.id)}/file`,
  };
}

async function syncCoverAsset({ bucket, coverUrl, presetId, existingCoverObjectKey, allowReuseApiPath }) {
  const cleanedUrl = readString(coverUrl);
  if (!cleanedUrl) {
    if (existingCoverObjectKey) {
      await deleteIfPresent(bucket, existingCoverObjectKey);
    }
    return { sourceUrl: '', objectKey: '' };
  }

  if (allowReuseApiPath && cleanedUrl === `/api/presets/${encodeURIComponent(presetId)}/cover`) {
    return { sourceUrl: '', objectKey: existingCoverObjectKey || '' };
  }

  let contentType = '';
  let bytes = null;
  let ext = '';

  if (cleanedUrl.startsWith('data:image/')) {
    const parsedDataUrl = parseDataImageUrl(cleanedUrl);
    if (!parsedDataUrl) {
      throw new Error('Cover data URL is invalid.');
    }
    contentType = parsedDataUrl.contentType;
    bytes = parsedDataUrl.bytes;
    ext = inferFileExtension(contentType, '') || 'bin';
  } else {
    const parsedUrl = tryParseUrl(cleanedUrl);
    if (!parsedUrl || !['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Cover must be an http(s) URL or data:image/* URL.');
    }

    const response = await fetch(parsedUrl.toString());
    if (!response.ok) {
      throw new Error(`Cover fetch failed (${response.status}).`);
    }

    contentType = response.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.toLowerCase().startsWith('image/')) {
      throw new Error('Cover file must be an image.');
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_UPLOAD_BYTES) {
      throw new Error('Cover image exceeds 5 MB limit.');
    }

    bytes = new Uint8Array(await response.arrayBuffer());
    ext = inferFileExtension(contentType, parsedUrl.pathname) || 'bin';
  }

  ensureSizeLimit(bytes.byteLength, 'Cover image');

  const objectKey = `${COVER_PREFIX}/${presetId}.${ext}`;
  await bucket.put(objectKey, bytes, { httpMetadata: { contentType } });

  if (existingCoverObjectKey && existingCoverObjectKey !== objectKey) {
    await deleteIfPresent(bucket, existingCoverObjectKey);
  }

  const persistedSourceUrl = cleanedUrl.startsWith('data:image/') ? '' : cleanedUrl;
  return { sourceUrl: persistedSourceUrl, objectKey };
}

async function deleteIfPresent(bucket, objectKey) {
  const key = readString(objectKey);
  if (!key) {
    return;
  }
  await bucket.delete(key);
}

function ensureSizeLimit(size, label) {
  if (Number(size) > MAX_UPLOAD_BYTES) {
    throw new Error(`${label} exceeds 5 MB limit.`);
  }
}

function stringifyJson(value) {
  return JSON.stringify(value);
}

function byteSize(value) {
  return new TextEncoder().encode(String(value || '')).byteLength;
}

function compactObject(value) {
  if (Array.isArray(value)) {
    return value.map(compactObject);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      continue;
    }
    output[key] = compactObject(entry);
  }
  return output;
}

function tryParseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function parseDataImageUrl(value) {
  const match = String(value || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return null;
  }
  const contentType = match[1].toLowerCase();
  const base64 = match[2];
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return { contentType, bytes };
  } catch {
    return null;
  }
}

function inferFileExtension(contentType, pathname) {
  const lowerType = String(contentType || '').toLowerCase();
  if (lowerType.includes('png')) return 'png';
  if (lowerType.includes('jpeg') || lowerType.includes('jpg')) return 'jpg';
  if (lowerType.includes('webp')) return 'webp';
  if (lowerType.includes('gif')) return 'gif';
  if (lowerType.includes('svg')) return 'svg';
  if (lowerType.includes('avif')) return 'avif';
  const match = String(pathname || '').match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function sanitizeFilename(value) {
  return String(value || 'preset').replace(/[\\/:*?"<>|]+/g, '_');
}

function buildAttachmentDisposition(filename) {
  const safeName = sanitizeFilename(filename);
  return `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

async function upsertUser(db, user) {
  if (!user?.discordId || !user?.username) {
    return;
  }

  await db
    .prepare(`
      INSERT INTO users (discord_id, username, avatar_url)
      VALUES (?, ?, ?)
      ON CONFLICT(discord_id) DO UPDATE SET
        username = excluded.username,
        avatar_url = excluded.avatar_url
    `)
    .bind(user.discordId, user.username, user.avatarUrl || null)
    .run();
}

async function readJsonBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return {};
  }
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeJsonParse(value, fallback) {
  if (value == null || value === '') {
    return fallback;
  }
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function sha256Hex(value) {
  const text = readString(value);
  if (!text) {
    return '';
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

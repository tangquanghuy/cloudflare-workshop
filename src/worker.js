const JSON_HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
};

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const PRESET_PREFIX = 'presets';
const COVER_PREFIX = 'covers';
const CONTENT_COVER_PREFIX = 'content-covers';
const WORKSHOP_ENTRY_TYPES = new Set(['character', 'extension']);

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
        return await handleUserSync(request, env);
      }

      if (url.pathname === '/api/presets' && request.method === 'GET') {
        return await handlePresetList(request, env);
      }

      if (url.pathname === '/api/presets' && request.method === 'POST') {
        return await handlePresetCreate(request, env, url);
      }

      if (url.pathname === '/api/content' && request.method === 'GET') {
        return await handleWorkshopContentList(request, env, url);
      }

      if (url.pathname === '/api/content' && request.method === 'POST') {
        return await handleWorkshopContentCreate(request, env);
      }

      const presetRouteMatch = url.pathname.match(/^\/api\/presets\/([^/]+)(?:\/(download|like|file|cover))?$/);
      if (presetRouteMatch) {
        const presetId = decodeURIComponent(presetRouteMatch[1]);
        const action = presetRouteMatch[2] || '';

        if (!action && request.method === 'GET') {
          return await handlePresetGet(presetId, env, url);
        }
        if (!action && request.method === 'PUT') {
          return await handlePresetUpdate(presetId, request, env, url);
        }
        if (!action && request.method === 'DELETE') {
          return await handlePresetDelete(presetId, request, env);
        }
        if (action === 'download' && request.method === 'POST') {
          return await handlePresetDownload(presetId, request, env, url);
        }
        if (action === 'like' && request.method === 'POST') {
          return await handlePresetLikeToggle(presetId, request, env, url);
        }
        if (action === 'file' && request.method === 'GET') {
          return await handlePresetFile(presetId, env);
        }
        if (action === 'cover' && request.method === 'GET') {
          return await handlePresetCover(presetId, env);
        }
      }

      const contentRouteMatch = url.pathname.match(/^\/api\/content\/([^/]+)(?:\/(cover|like))?$/);
      if (contentRouteMatch) {
        const entryId = decodeURIComponent(contentRouteMatch[1]);
        const action = contentRouteMatch[2] || '';

        if (!action && request.method === 'GET') {
          return await handleWorkshopContentGet(entryId, env, url);
        }
        if (!action && request.method === 'PUT') {
          return await handleWorkshopContentUpdate(entryId, request, env);
        }
        if (!action && request.method === 'DELETE') {
          return await handleWorkshopContentDelete(entryId, request, env);
        }
        if (action === 'like' && request.method === 'POST') {
          return await handleWorkshopContentLikeToggle(entryId, request, env);
        }
        if (action === 'cover' && request.method === 'GET') {
          return await handleWorkshopContentCover(entryId, env);
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
  const duplicatePreset = await findPresetByOwnerAndTitle(env.ngnl_build, payload.ownerDiscordId, payload.title);
  if (duplicatePreset) {
    return jsonResponse({ ok: false, error: '你已经发布过同名预设，请修改名称后再试。' }, 409);
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
    assetId: presetId,
    existingCoverObjectKey: '',
    allowReuseApiPath: false,
    coverApiPath: `/api/presets/${encodeURIComponent(presetId)}/cover`,
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

  const nextTitle = payload.title || existingRow.title;
  const duplicatePreset = await findPresetByOwnerAndTitle(env.ngnl_build, ownerDiscordId, nextTitle, presetId);
  if (duplicatePreset) {
    return jsonResponse({ ok: false, error: '你已经发布过同名预设，请修改名称后再试。' }, 409);
  }

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
    assetId: presetId,
    existingCoverObjectKey: readString(existingRow.cover_object_key),
    allowReuseApiPath: true,
    coverApiPath: `/api/presets/${encodeURIComponent(presetId)}/cover`,
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

async function handleWorkshopContentList(request, env, baseUrl = null) {
  const url = baseUrl || new URL(request.url);
  const entryType = readString(url.searchParams.get('type'));
  const viewerDiscordId = readString(url.searchParams.get('viewer_discord_id') || url.searchParams.get('user_discord_id'));
  const ownerDiscordId = readString(url.searchParams.get('owner_discord_id'));
  const search = readString(url.searchParams.get('search'));
  const status = readString(url.searchParams.get('status')) || 'published';

  if (entryType && !isValidWorkshopEntryType(entryType)) {
    return jsonResponse({ ok: false, error: 'Invalid content type.' }, 400);
  }

  const whereClauses = ['e.status = ?'];
  const params = [status];

  if (entryType) {
    whereClauses.push('e.entry_type = ?');
    params.push(entryType);
  }

  if (ownerDiscordId) {
    whereClauses.push('e.owner_discord_id = ?');
    params.push(ownerDiscordId);
  }

  if (search) {
    const keyword = `%${search.toLowerCase()}%`;
    whereClauses.push('(LOWER(e.title) LIKE ? OR LOWER(e.intro) LIKE ? OR LOWER(COALESCE(u.username, e.owner_discord_id)) LIKE ? OR LOWER(e.tags_json) LIKE ?)');
    params.push(keyword, keyword, keyword, keyword);
  }

  const { results } = await env.ngnl_build
    .prepare(`
      SELECT
        e.id,
        e.entry_type,
        e.owner_discord_id,
        e.title,
        e.intro,
        e.overview_text,
        e.trigger_words,
        e.worldbook_position_type,
        e.worldbook_depth,
        e.cover_url,
        e.cover_object_key,
        e.tags_json,
        e.like_count,
        e.status,
        e.created_at,
        e.updated_at,
        CASE
          WHEN ? != '' AND EXISTS(
            SELECT 1 FROM workshop_entry_likes wl
            WHERE wl.entry_id = e.id AND wl.user_discord_id = ?
          ) THEN 1
          ELSE 0
        END AS liked,
        u.username,
        u.avatar_url
      FROM workshop_entries e
      LEFT JOIN users u ON u.discord_id = e.owner_discord_id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY datetime(e.updated_at) DESC, datetime(e.created_at) DESC
    `)
    .bind(viewerDiscordId, viewerDiscordId, ...params)
    .all();

  return jsonResponse({
    ok: true,
    items: (results || []).map((row) => mapWorkshopEntryRow(row)),
  });
}

async function handleWorkshopContentGet(entryId, env, url = null) {
  const viewerDiscordId = readString(url?.searchParams.get('viewer_discord_id') || url?.searchParams.get('user_discord_id'));
  const row = await getWorkshopEntryRow(env.ngnl_build, entryId, viewerDiscordId);
  if (!row) {
    return jsonResponse({ ok: false, error: 'Content not found.' }, 404);
  }
  return jsonResponse({ ok: true, item: mapWorkshopEntryRow(row, { includeContentText: true }) });
}

async function handleWorkshopContentCreate(request, env) {
  const body = await readJsonBody(request);
  const payload = normalizeWorkshopEntryPayload(body);

  if (!isValidWorkshopEntryType(payload.entryType)) {
    return jsonResponse({ ok: false, error: 'entry_type is required.' }, 400);
  }
  if (!payload.ownerDiscordId) {
    return jsonResponse({ ok: false, error: 'owner_discord_id is required.' }, 400);
  }
  if (!payload.title) {
    return jsonResponse({ ok: false, error: 'title is required.' }, 400);
  }
  if (!payload.contentText) {
    return jsonResponse({ ok: false, error: 'content_text is required.' }, 400);
  }
  if (payload.overviewText.length > 500) {
    return jsonResponse({ ok: false, error: '总览区不能超过 500 字。' }, 400);
  }
  if (payload.entryType === 'extension' && !payload.triggerWords.length) {
    return jsonResponse({ ok: false, error: '请至少填写 1 个拓展触发词。' }, 400);
  }

  const duplicateEntry = await findWorkshopEntryByOwnerAndTitle(env.ngnl_build, payload.entryType, payload.ownerDiscordId, payload.title);
  if (duplicateEntry) {
    return jsonResponse({ ok: false, error: '你已经发布过同名内容，请修改名称后再试。' }, 409);
  }

  const entryId = payload.id || crypto.randomUUID();
  const coverApiPath = `/api/content/${encodeURIComponent(entryId)}/cover`;
  const coverResult = await syncCoverAsset({
    bucket: env.ngnl,
    coverUrl: payload.coverUrl,
    assetId: entryId,
    existingCoverObjectKey: '',
    allowReuseApiPath: false,
    coverApiPath,
    objectKeyPrefix: `${CONTENT_COVER_PREFIX}/${payload.entryType}`,
  });

  await upsertUser(env.ngnl_build, {
    discordId: payload.ownerDiscordId,
    username: payload.username || payload.author || payload.ownerDiscordId,
    avatarUrl: payload.avatarUrl,
  });

  await env.ngnl_build
    .prepare(`
      INSERT INTO workshop_entries (
        id,
        entry_type,
        owner_discord_id,
        title,
        intro,
        overview_text,
        trigger_words,
        worldbook_position_type,
        worldbook_depth,
        cover_url,
        cover_object_key,
        tags_json,
        content_text,
        like_count,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
    .bind(
      entryId,
      payload.entryType,
      payload.ownerDiscordId,
      payload.title,
      payload.intro || '',
      payload.overviewText,
      payload.triggerWordsText,
      payload.worldbookPositionType,
      payload.worldbookDepth,
      coverResult.sourceUrl,
      coverResult.objectKey,
      stringifyJson(payload.tags),
      payload.contentText,
      payload.status || 'published',
    )
    .run();

  const row = await getWorkshopEntryRow(env.ngnl_build, entryId);
  return jsonResponse({ ok: true, item: mapWorkshopEntryRow(row, { includeContentText: true }) }, 201);
}

async function handleWorkshopContentUpdate(entryId, request, env) {
  const body = await readJsonBody(request);
  const payload = normalizeWorkshopEntryPayload(body);
  const existingRow = await getWorkshopEntryRow(env.ngnl_build, entryId);

  if (!existingRow) {
    return jsonResponse({ ok: false, error: 'Content not found.' }, 404);
  }

  const ownerDiscordId = payload.ownerDiscordId || readString(body.owner_discord_id || body.ownerId);
  if (!ownerDiscordId || ownerDiscordId !== existingRow.owner_discord_id) {
    return jsonResponse({ ok: false, error: 'Only the owner can update this content.' }, 403);
  }

  const nextEntryType = payload.entryType || existingRow.entry_type;
  if (!isValidWorkshopEntryType(nextEntryType)) {
    return jsonResponse({ ok: false, error: 'Invalid content type.' }, 400);
  }

  const nextTitle = payload.title || existingRow.title;
  const nextTriggerWords = payload.triggerWords.length ? payload.triggerWords : parseCommaList(existingRow.trigger_words);
  const nextOverviewText = Object.prototype.hasOwnProperty.call(body, 'overview_text') || Object.prototype.hasOwnProperty.call(body, 'overviewText')
    ? payload.overviewText
    : (existingRow.overview_text || '');
  const hasWorldbookPositionInput = Object.prototype.hasOwnProperty.call(body, 'worldbook_position_type')
    || Object.prototype.hasOwnProperty.call(body, 'worldbookPositionType')
    || Object.prototype.hasOwnProperty.call(body, 'worldbook_settings');
  const hasWorldbookDepthInput = Object.prototype.hasOwnProperty.call(body, 'worldbook_depth')
    || Object.prototype.hasOwnProperty.call(body, 'worldbookDepth')
    || Object.prototype.hasOwnProperty.call(body, 'worldbook_settings');
  if (nextOverviewText.length > 500) {
    return jsonResponse({ ok: false, error: '总览区不能超过 500 字。' }, 400);
  }
  if (nextEntryType === 'extension' && !nextTriggerWords.length) {
    return jsonResponse({ ok: false, error: '请至少填写 1 个拓展触发词。' }, 400);
  }
  const duplicateEntry = await findWorkshopEntryByOwnerAndTitle(env.ngnl_build, nextEntryType, ownerDiscordId, nextTitle, entryId);
  if (duplicateEntry) {
    return jsonResponse({ ok: false, error: '你已经发布过同名内容，请修改名称后再试。' }, 409);
  }

  await upsertUser(env.ngnl_build, {
    discordId: ownerDiscordId,
    username: payload.username || payload.author || existingRow.username || ownerDiscordId,
    avatarUrl: payload.avatarUrl || existingRow.avatar_url || '',
  });

  const coverApiPath = `/api/content/${encodeURIComponent(entryId)}/cover`;
  const hasCoverInput = Object.prototype.hasOwnProperty.call(body, 'cover_url') || Object.prototype.hasOwnProperty.call(body, 'coverUrl');
  const hasTagsInput = Array.isArray(body.tags);
  const coverResult = await syncCoverAsset({
    bucket: env.ngnl,
    coverUrl: hasCoverInput ? payload.coverUrl : (readString(existingRow.cover_object_key) ? coverApiPath : existingRow.cover_url || ''),
    assetId: entryId,
    existingCoverObjectKey: readString(existingRow.cover_object_key),
    allowReuseApiPath: true,
    coverApiPath,
    objectKeyPrefix: `${CONTENT_COVER_PREFIX}/${nextEntryType}`,
  });

  await env.ngnl_build
    .prepare(`
      UPDATE workshop_entries
      SET
        entry_type = ?,
        title = ?,
        intro = ?,
        overview_text = ?,
        trigger_words = ?,
        worldbook_position_type = ?,
        worldbook_depth = ?,
        cover_url = ?,
        cover_object_key = ?,
        tags_json = ?,
        content_text = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND owner_discord_id = ?
    `)
    .bind(
      nextEntryType,
      nextTitle,
      payload.intro || '',
      nextOverviewText,
      joinCommaList(nextTriggerWords),
      hasWorldbookPositionInput
        ? payload.worldbookPositionType
        : normalizeWorldbookPositionType(existingRow.worldbook_position_type),
      hasWorldbookDepthInput
        ? payload.worldbookDepth
        : normalizeWorldbookDepthValue(existingRow.worldbook_depth),
      coverResult.sourceUrl,
      coverResult.objectKey,
      stringifyJson(hasTagsInput ? payload.tags : safeJsonParse(existingRow.tags_json, [])),
      payload.contentText || existingRow.content_text || '',
      payload.status || existingRow.status || 'published',
      entryId,
      ownerDiscordId,
    )
    .run();

  const row = await getWorkshopEntryRow(env.ngnl_build, entryId);
  return jsonResponse({ ok: true, item: mapWorkshopEntryRow(row, { includeContentText: true }) });
}

async function handleWorkshopContentDelete(entryId, request, env) {
  const body = request.method === 'DELETE' ? await readJsonBody(request) : {};
  const url = new URL(request.url);
  const ownerDiscordId = readString(body.owner_discord_id || body.ownerId || url.searchParams.get('owner_discord_id') || url.searchParams.get('ownerId'));

  const existingRow = await getWorkshopEntryRow(env.ngnl_build, entryId);
  if (!existingRow) {
    return jsonResponse({ ok: false, error: 'Content not found.' }, 404);
  }
  if (!ownerDiscordId || ownerDiscordId !== existingRow.owner_discord_id) {
    return jsonResponse({ ok: false, error: 'Only the owner can delete this content.' }, 403);
  }

  await deleteIfPresent(env.ngnl, readString(existingRow.cover_object_key));
  await env.ngnl_build.batch([
    env.ngnl_build.prepare('DELETE FROM workshop_entry_likes WHERE entry_id = ?').bind(entryId),
    env.ngnl_build.prepare('DELETE FROM workshop_entries WHERE id = ? AND owner_discord_id = ?').bind(entryId, ownerDiscordId),
  ]);

  return jsonResponse({ ok: true, deleted_id: entryId });
}

async function handleWorkshopContentLikeToggle(entryId, request, env) {
  const body = await readJsonBody(request);
  const userDiscordId = readString(body.user_discord_id || body.userId);
  const username = readString(body.username);
  const avatarUrl = readString(body.avatar_url || body.avatarUrl);

  const existingRow = await getWorkshopEntryRow(env.ngnl_build, entryId, userDiscordId);
  if (!existingRow) {
    return jsonResponse({ ok: false, error: 'Content not found.' }, 404);
  }
  if (!userDiscordId) {
    return jsonResponse({ ok: false, error: 'user_discord_id is required.' }, 400);
  }

  if (username) {
    await upsertUser(env.ngnl_build, { discordId: userDiscordId, username, avatarUrl });
  }

  const likeRow = await env.ngnl_build
    .prepare('SELECT 1 AS liked FROM workshop_entry_likes WHERE entry_id = ? AND user_discord_id = ?')
    .bind(entryId, userDiscordId)
    .first();

  if (likeRow?.liked) {
    await env.ngnl_build.batch([
      env.ngnl_build.prepare('DELETE FROM workshop_entry_likes WHERE entry_id = ? AND user_discord_id = ?').bind(entryId, userDiscordId),
      env.ngnl_build.prepare('UPDATE workshop_entries SET like_count = MAX(like_count - 1, 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(entryId),
    ]);
  } else {
    await env.ngnl_build.batch([
      env.ngnl_build.prepare('INSERT INTO workshop_entry_likes (entry_id, user_discord_id) VALUES (?, ?)').bind(entryId, userDiscordId),
      env.ngnl_build.prepare('UPDATE workshop_entries SET like_count = like_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(entryId),
    ]);
  }

  const row = await getWorkshopEntryRow(env.ngnl_build, entryId, userDiscordId);
  return jsonResponse({ ok: true, liked: !likeRow?.liked, like_count: Number(row?.like_count || 0), item: row ? mapWorkshopEntryRow(row, { includeContentText: true }) : null });
}

async function handleWorkshopContentCover(entryId, env) {
  const row = await getWorkshopEntryRow(env.ngnl_build, entryId);
  if (!row) {
    return jsonResponse({ ok: false, error: 'Content not found.' }, 404);
  }

  const objectKey = readString(row.cover_object_key);
  if (!objectKey) {
    return jsonResponse({ ok: false, error: 'Cover not found.' }, 404);
  }

  const object = await env.ngnl.get(objectKey);
  if (!object) {
    return jsonResponse({ ok: false, error: 'Cover file not found in R2.' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=86400');

  return new Response(object.body, { headers });
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

async function getWorkshopEntryRow(db, entryId, viewerDiscordId = '') {
  return db
    .prepare(`
      SELECT
        e.id,
        e.entry_type,
        e.owner_discord_id,
        e.title,
        e.intro,
        e.overview_text,
        e.trigger_words,
        e.worldbook_position_type,
        e.worldbook_depth,
        e.cover_url,
        e.cover_object_key,
        e.tags_json,
        e.content_text,
        e.like_count,
        e.status,
        e.created_at,
        e.updated_at,
        CASE
          WHEN ? != '' AND EXISTS(
            SELECT 1 FROM workshop_entry_likes wl
            WHERE wl.entry_id = e.id AND wl.user_discord_id = ?
          ) THEN 1
          ELSE 0
        END AS liked,
        u.username,
        u.avatar_url
      FROM workshop_entries e
      LEFT JOIN users u ON u.discord_id = e.owner_discord_id
      WHERE e.id = ?
      LIMIT 1
    `)
    .bind(viewerDiscordId, viewerDiscordId, entryId)
    .first();
}

async function findPresetByOwnerAndTitle(db, ownerDiscordId, title, excludePresetId = '') {
  const normalizedTitle = readString(title);
  if (!ownerDiscordId || !normalizedTitle) {
    return null;
  }

  if (excludePresetId) {
    return db
      .prepare(`
        SELECT id, title
        FROM presets
        WHERE owner_discord_id = ?
          AND LOWER(title) = LOWER(?)
          AND id != ?
        LIMIT 1
      `)
      .bind(ownerDiscordId, normalizedTitle, excludePresetId)
      .first();
  }

  return db
    .prepare(`
      SELECT id, title
      FROM presets
      WHERE owner_discord_id = ?
        AND LOWER(title) = LOWER(?)
      LIMIT 1
    `)
    .bind(ownerDiscordId, normalizedTitle)
    .first();
}

async function findWorkshopEntryByOwnerAndTitle(db, entryType, ownerDiscordId, title, excludeEntryId = '') {
  const normalizedTitle = readString(title);
  if (!isValidWorkshopEntryType(entryType) || !ownerDiscordId || !normalizedTitle) {
    return null;
  }

  if (excludeEntryId) {
    return db
      .prepare(`
        SELECT id, title
        FROM workshop_entries
        WHERE entry_type = ?
          AND owner_discord_id = ?
          AND LOWER(title) = LOWER(?)
          AND id != ?
        LIMIT 1
      `)
      .bind(entryType, ownerDiscordId, normalizedTitle, excludeEntryId)
      .first();
  }

  return db
    .prepare(`
      SELECT id, title
      FROM workshop_entries
      WHERE entry_type = ?
        AND owner_discord_id = ?
        AND LOWER(title) = LOWER(?)
      LIMIT 1
    `)
    .bind(entryType, ownerDiscordId, normalizedTitle)
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

function normalizeWorkshopEntryPayload(body) {
  const tags = Array.isArray(body.tags)
    ? body.tags.map((item) => readString(typeof item === 'string' ? item : item?.text)).filter(Boolean)
    : [];
  const triggerWords = normalizeCommaList(body.trigger_words ?? body.triggerWords);
  const worldbookSettings = body.worldbook_settings && typeof body.worldbook_settings === 'object' ? body.worldbook_settings : {};

  return {
    id: readString(body.id),
    entryType: readString(body.entry_type || body.entryType || body.type),
    ownerDiscordId: readString(body.owner_discord_id || body.ownerDiscordId || body.ownerId),
    username: readString(body.username || body.owner_name || body.ownerName || body.author),
    avatarUrl: readString(body.avatar_url || body.avatarUrl || body.authorAvatar),
    author: readString(body.author),
    title: readString(body.title || body.name),
    intro: readString(body.intro || body.summary),
    overviewText: readString(body.overview_text || body.overviewText),
    coverUrl: readString(body.cover_url || body.coverUrl),
    contentText: typeof body.content_text === 'string'
      ? body.content_text.trim()
      : readString(body.contentText || body.content),
    worldbookPositionType: normalizeWorldbookPositionType(
      body.worldbook_position_type
      ?? body.worldbookPositionType
      ?? worldbookSettings.position_type
      ?? worldbookSettings.positionType
    ),
    worldbookDepth: normalizeWorldbookDepthValue(
      body.worldbook_depth
      ?? body.worldbookDepth
      ?? worldbookSettings.depth
    ),
    status: readString(body.status) || 'published',
    tags,
    triggerWords,
    triggerWordsText: joinCommaList(triggerWords),
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

function mapWorkshopEntryRow(row, options = {}) {
  const tags = safeJsonParse(row.tags_json, []);
  return {
    id: row.id,
    type: row.entry_type,
    ownerId: row.owner_discord_id,
    ownerName: row.username || row.owner_discord_id,
    author: row.username || row.owner_discord_id,
    authorAvatar: row.avatar_url || '',
    name: row.title,
    title: row.title,
    intro: row.intro || '',
    overviewText: row.overview_text || '',
    coverUrl: readString(row.cover_object_key) ? `/api/content/${encodeURIComponent(row.id)}/cover` : (row.cover_url || ''),
    tags: Array.isArray(tags) ? tags : [],
    triggerWords: parseCommaList(row.trigger_words),
    worldbookPositionType: normalizeWorldbookPositionType(row.worldbook_position_type),
    worldbookDepth: normalizeWorldbookDepthValue(row.worldbook_depth),
    likes: Number(row.like_count || 0),
    liked: Boolean(Number(row.liked || 0)),
    contentText: options.includeContentText ? (row.content_text || '') : '',
    status: row.status || 'published',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

async function syncCoverAsset({ bucket, coverUrl, assetId, existingCoverObjectKey, allowReuseApiPath, coverApiPath = '', objectKeyPrefix = COVER_PREFIX }) {
  const cleanedUrl = readString(coverUrl);
  if (!cleanedUrl) {
    if (existingCoverObjectKey) {
      await deleteIfPresent(bucket, existingCoverObjectKey);
    }
    return { sourceUrl: '', objectKey: '' };
  }

  if (allowReuseApiPath && coverApiPath && cleanedUrl === coverApiPath) {
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

  const objectKey = `${objectKeyPrefix}/${assetId}.${ext}`;
  await bucket.put(objectKey, bytes, { httpMetadata: { contentType } });

  if (existingCoverObjectKey && existingCoverObjectKey !== objectKey) {
    await deleteIfPresent(bucket, existingCoverObjectKey);
  }

  const persistedSourceUrl = cleanedUrl.startsWith('data:image/') ? '' : cleanedUrl;
  return { sourceUrl: persistedSourceUrl, objectKey };
}

function normalizeWorldbookPositionType(value) {
  const normalized = readString(value);
  if (normalized === 'before_character_definition' || normalized === 'after_character_definition' || normalized === 'at_depth') {
    return normalized;
  }
  return 'after_character_definition';
}

function normalizeWorldbookDepthValue(value) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) {
    return 0;
  }
  return Math.max(0, Math.floor(nextValue));
}

function isValidWorkshopEntryType(value) {
  return WORKSHOP_ENTRY_TYPES.has(readString(value));
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

function normalizeCommaList(value) {
  if (Array.isArray(value)) {
    return dedupeList(value.map((item) => readString(item)));
  }
  return dedupeList(readString(value).split(/[，,]/));
}

function joinCommaList(items) {
  return normalizeCommaList(items).join(',');
}

function parseCommaList(value) {
  return normalizeCommaList(value);
}

function dedupeList(items) {
  const seen = new Set();
  const output = [];
  for (const item of items || []) {
    const normalized = readString(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
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

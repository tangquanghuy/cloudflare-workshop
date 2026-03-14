const JSON_HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
};

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
        project: 'creative-workshop',
        binding: 'ngnl_build',
      });
    }

    if (url.pathname === '/api/db-test') {
      return handleDbTest(env);
    }

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (!env.ngnl_build) {
      return jsonResponse(
        {
          ok: false,
          error: 'D1 binding `ngnl_build` is not configured.',
        },
        500,
      );
    }

    try {
      if (url.pathname === '/api/users/sync' && request.method === 'POST') {
        return handleUserSync(request, env);
      }

      if (url.pathname === '/api/presets' && request.method === 'GET') {
        return handlePresetList(request, env);
      }

      if (url.pathname === '/api/presets' && request.method === 'POST') {
        return handlePresetCreate(request, env);
      }

      const presetRouteMatch = url.pathname.match(/^\/api\/presets\/([^/]+)(?:\/(download|like))?$/);
      if (presetRouteMatch) {
        const presetId = decodeURIComponent(presetRouteMatch[1]);
        const action = presetRouteMatch[2] || '';

        if (!action && request.method === 'GET') {
          return handlePresetGet(presetId, env);
        }
        if (!action && request.method === 'PUT') {
          return handlePresetUpdate(presetId, request, env);
        }
        if (!action && request.method === 'DELETE') {
          return handlePresetDelete(presetId, request, env);
        }
        if (action === 'download' && request.method === 'POST') {
          return handlePresetDownload(presetId, request, env);
        }
        if (action === 'like' && request.method === 'POST') {
          return handlePresetLikeToggle(presetId, request, env);
        }
      }

      return jsonResponse({ ok: false, error: 'Not found.' }, 404);
    } catch (error) {
      console.error('Worker API error:', error);
      return jsonResponse(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  },
};

async function handleDbTest(env) {
  if (!env.ngnl_build) {
    return jsonResponse(
      {
        ok: false,
        error: 'D1 binding `ngnl_build` is not configured.',
      },
      500,
    );
  }

  try {
    const row = await env.ngnl_build.prepare('SELECT 1 AS ok').first();
    return jsonResponse({ ok: true, row });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
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

  await upsertUser(env.ngnl_build, {
    discordId,
    username,
    avatarUrl,
  });

  return jsonResponse({
    ok: true,
    user: {
      discord_id: discordId,
      username,
      avatar_url: avatarUrl,
    },
  });
}

async function handlePresetList(request, env) {
  const url = new URL(request.url);
  const ownerDiscordId = readString(url.searchParams.get('owner_discord_id'));
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

  const statement = env.ngnl_build
    .prepare(`
      SELECT
        p.id,
        p.owner_discord_id,
        p.title,
        p.intro,
        p.cover_url,
        p.class_name,
        p.race,
        p.tags_json,
        p.preset_json,
        p.like_count,
        p.download_count,
        p.status,
        p.created_at,
        p.updated_at,
        u.username,
        u.avatar_url
      FROM presets p
      LEFT JOIN users u ON u.discord_id = p.owner_discord_id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY datetime(p.updated_at) DESC, datetime(p.created_at) DESC
    `)
    .bind(...params);

  const { results } = await statement.all();
  return jsonResponse({
    ok: true,
    presets: (results || []).map(mapPresetRow),
  });
}

async function handlePresetGet(presetId, env) {
  const row = await getPresetRow(env.ngnl_build, presetId);
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
        class_name,
        race,
        tags_json,
        preset_json,
        like_count,
        download_count,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
    .bind(
      presetId,
      payload.ownerDiscordId,
      payload.title,
      payload.intro,
      payload.coverUrl,
      payload.className,
      payload.race,
      JSON.stringify(payload.tags),
      JSON.stringify(payload.presetData),
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

  const mergedPresetData = payload.presetData ?? safeJsonParse(existingRow.preset_json, null);
  const mergedTags = payload.tags.length ? payload.tags : safeJsonParse(existingRow.tags_json, []);

  await env.ngnl_build
    .prepare(`
      UPDATE presets
      SET
        title = ?,
        intro = ?,
        cover_url = ?,
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
      payload.coverUrl || '',
      payload.className || '',
      payload.race || '',
      JSON.stringify(mergedTags),
      JSON.stringify(mergedPresetData),
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
  const ownerDiscordId = readString(
    body.owner_discord_id || body.ownerId || url.searchParams.get('owner_discord_id') || url.searchParams.get('ownerId'),
  );

  const existingRow = await getPresetRow(env.ngnl_build, presetId);
  if (!existingRow) {
    return jsonResponse({ ok: false, error: 'Preset not found.' }, 404);
  }
  if (!ownerDiscordId || ownerDiscordId !== existingRow.owner_discord_id) {
    return jsonResponse({ ok: false, error: 'Only the owner can delete this preset.' }, 403);
  }

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
    env.ngnl_build
      .prepare('INSERT INTO preset_download_events (preset_id, user_discord_id, ip_hash) VALUES (?, ?, ?)')
      .bind(presetId, userDiscordId || null, ipHash || null),
    env.ngnl_build.prepare('UPDATE presets SET download_count = download_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(presetId),
  ]);

  const row = await getPresetRow(env.ngnl_build, presetId);
  return jsonResponse({
    ok: true,
    download_count: Number(row?.download_count || 0),
    preset: row ? mapPresetRow(row) : null,
  });
}

async function handlePresetLikeToggle(presetId, request, env) {
  const existingRow = await getPresetRow(env.ngnl_build, presetId);
  if (!existingRow) {
    return jsonResponse({ ok: false, error: 'Preset not found.' }, 404);
  }

  const body = await readJsonBody(request);
  const userDiscordId = readString(body.user_discord_id || body.userId);
  const username = readString(body.username);
  const avatarUrl = readString(body.avatar_url || body.avatarUrl);

  if (!userDiscordId) {
    return jsonResponse({ ok: false, error: 'user_discord_id is required.' }, 400);
  }

  if (username) {
    await upsertUser(env.ngnl_build, { discordId: userDiscordId, username, avatarUrl });
  }

  const likeRow = await env.ngnl_build
    .prepare('SELECT 1 AS liked FROM preset_likes WHERE preset_id = ? AND user_discord_id = ?')
    .bind(presetId, userDiscordId)
    .first();

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

  const row = await getPresetRow(env.ngnl_build, presetId);
  return jsonResponse({
    ok: true,
    liked: !likeRow?.liked,
    like_count: Number(row?.like_count || 0),
    preset: row ? mapPresetRow(row) : null,
  });
}

async function getPresetRow(db, presetId) {
  return db
    .prepare(`
      SELECT
        p.id,
        p.owner_discord_id,
        p.title,
        p.intro,
        p.cover_url,
        p.class_name,
        p.race,
        p.tags_json,
        p.preset_json,
        p.like_count,
        p.download_count,
        p.status,
        p.created_at,
        p.updated_at,
        u.username,
        u.avatar_url
      FROM presets p
      LEFT JOIN users u ON u.discord_id = p.owner_discord_id
      WHERE p.id = ?
      LIMIT 1
    `)
    .bind(presetId)
    .first();
}

function normalizePresetPayload(body) {
  const presetData = body.presetData ?? body.preset_json ?? null;
  const tags = Array.isArray(body.tags)
    ? body.tags.map((item) => readString(typeof item === 'string' ? item : item?.text)).filter(Boolean)
    : [];

  const ownerDiscordId = readString(body.owner_discord_id || body.ownerDiscordId || body.ownerId);
  const username = readString(body.username || body.owner_name || body.ownerName || body.author);
  const avatarUrl = readString(body.avatar_url || body.avatarUrl || body.authorAvatar);
  const title = readString(body.title || body.name || presetData?.name);
  const intro = readString(body.intro || body.summary);
  const coverUrl = readString(body.cover_url || body.coverUrl || presetData?.avatar);
  const className = readString(body.class_name || body.className || presetData?.class || presetData?.customClassName);
  const race = readString(body.race || presetData?.race || presetData?.customRace?.name || presetData?.customRace);
  const status = readString(body.status) || 'published';

  return {
    id: readString(body.id),
    ownerDiscordId,
    username,
    avatarUrl,
    author: readString(body.author),
    title,
    intro,
    coverUrl,
    className,
    race,
    status,
    tags,
    presetData,
  };
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
    coverUrl: row.cover_url || '',
    className: row.class_name || '',
    race: row.race || '',
    tags: safeJsonParse(row.tags_json, []),
    likes: Number(row.like_count || 0),
    downloads: Number(row.download_count || 0),
    status: row.status || 'published',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    presetData: safeJsonParse(row.preset_json, null),
  };
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
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

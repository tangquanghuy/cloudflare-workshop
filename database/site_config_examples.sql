-- Weekly featured slot examples
INSERT INTO site_featured_slots (
  id,
  slot_key,
  target_type,
  target_id,
  badge_text,
  title,
  summary,
  status,
  starts_at,
  ends_at
) VALUES (
  'featured-build-week-1',
  'build',
  'preset',
  'replace-with-preset-id',
  '每周推荐',
  '本周 Build 推荐',
  '这份预设会固定排在列表第一位，并展示推荐样式。',
  'active',
  CURRENT_TIMESTAMP,
  NULL
)
ON CONFLICT(slot_key) DO UPDATE SET
  target_type = excluded.target_type,
  target_id = excluded.target_id,
  badge_text = excluded.badge_text,
  title = excluded.title,
  summary = excluded.summary,
  status = excluded.status,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO site_featured_slots (
  id,
  slot_key,
  target_type,
  target_id,
  badge_text,
  title,
  summary,
  status,
  starts_at,
  ends_at
) VALUES (
  'featured-character-week-1',
  'character',
  'character',
  'replace-with-character-id',
  '本周人设',
  '本周人设推荐',
  '这份人设会固定排在列表第一位，并展示推荐样式。',
  'active',
  CURRENT_TIMESTAMP,
  NULL
)
ON CONFLICT(slot_key) DO UPDATE SET
  target_type = excluded.target_type,
  target_id = excluded.target_id,
  badge_text = excluded.badge_text,
  title = excluded.title,
  summary = excluded.summary,
  status = excluded.status,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO site_featured_slots (
  id,
  slot_key,
  target_type,
  target_id,
  badge_text,
  title,
  summary,
  status,
  starts_at,
  ends_at
) VALUES (
  'featured-extension-week-1',
  'extension',
  'extension',
  'replace-with-extension-id',
  '本周拓展',
  '本周拓展推荐',
  '这份拓展会固定排在列表第一位，并展示推荐样式。',
  'active',
  CURRENT_TIMESTAMP,
  NULL
)
ON CONFLICT(slot_key) DO UPDATE SET
  target_type = excluded.target_type,
  target_id = excluded.target_id,
  badge_text = excluded.badge_text,
  title = excluded.title,
  summary = excluded.summary,
  status = excluded.status,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  updated_at = CURRENT_TIMESTAMP;

-- Announcement examples
INSERT INTO site_announcements (
  id,
  title,
  message,
  badge_text,
  display_mode,
  link_label,
  link_url,
  dismiss_key,
  sort_order,
  status,
  starts_at,
  ends_at
) VALUES (
  'notice-banner-1',
  '版本公告',
  '新的每周推荐位和公告系统已经上线，支持数据库热更新。',
  '滚动播报',
  'banner',
  '查看说明',
  'https://example.com',
  '',
  10,
  'active',
  CURRENT_TIMESTAMP,
  NULL
);

INSERT INTO site_announcements (
  id,
  title,
  message,
  badge_text,
  display_mode,
  link_label,
  link_url,
  dismiss_key,
  sort_order,
  status,
  starts_at,
  ends_at
) VALUES (
  'notice-modal-1',
  '站内通知',
  '这是一个只会在用户已读前弹出的公告。修改 dismiss_key 或 updated_at 后，会重新触发一次。',
  '公告',
  'modal',
  '',
  '',
  'notice-modal-1-v1',
  20,
  'active',
  CURRENT_TIMESTAMP,
  NULL
);

INSERT INTO site_announcements (
  id,
  title,
  message,
  badge_text,
  display_mode,
  link_label,
  link_url,
  dismiss_key,
  sort_order,
  status,
  starts_at,
  ends_at
) VALUES (
  'notice-both-1',
  '活动提醒',
  '这条公告会同时出现在滚动 banner 和首次弹窗里。',
  '活动',
  'both',
  '立即查看',
  'https://example.com/activity',
  'notice-both-1-v1',
  30,
  'active',
  CURRENT_TIMESTAMP,
  NULL
);

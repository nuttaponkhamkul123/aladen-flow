const crypto = require('crypto');
const db = require('./db');

function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  try {
    const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(testHash, 'hex'));
  } catch (err) {
    return false;
  }
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(userId, days = 30) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO user_sessions (token, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(token, userId, expiresAt);
  return { token, expiresAt };
}

function getAuthUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  try {
    const session = db.prepare(`
      SELECT s.token, u.id, u.username, u.email, u.display_name, u.avatar_url, u.created_at
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
    `).get(token);

    return session || null;
  } catch (err) {
    console.error('getAuthUser error:', err);
    return null;
  }
}

function getUserSettings(userId) {
  let settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  if (!settings) {
    db.prepare(`
      INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)
    `).run(userId);
    settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  }

  if (settings && typeof settings.settings_json === 'string') {
    try {
      settings.extra = JSON.parse(settings.settings_json);
    } catch {
      settings.extra = {};
    }
  }
  return settings;
}

function updateUserSettings(userId, patch) {
  const current = getUserSettings(userId);
  if (!current) return null;

  const allowed = [
    'theme_mode',
    'ambient_theme',
    'ai_provider',
    'ai_api_key',
    'ai_base_url',
    'ai_model',
    'ai_ollama_base_url',
    'ai_ollama_model',
    'sidebar_collapsed'
  ];

  const updates = [];
  const params = [];

  for (const field of allowed) {
    if (patch[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(patch[field]);
    }
  }

  if (patch.settings_json !== undefined) {
    updates.push('settings_json = ?');
    const val = typeof patch.settings_json === 'object' ? JSON.stringify(patch.settings_json) : String(patch.settings_json);
    params.push(val);
  } else if (patch.extra !== undefined) {
    updates.push('settings_json = ?');
    params.push(JSON.stringify(patch.extra));
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    params.push(userId);
    db.prepare(`UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?`).run(...params);
  }

  return getUserSettings(userId);
}

function seedUsersIfEmpty() {
  try {
    const count = db.prepare('SELECT COUNT(*) AS c FROM users').get()?.c || 0;
    if (count > 0) return;

    // 1. Seed demo user (Dark Mode, Nebula Ambient, Qwen AI)
    const demoPass = hashPassword('password123');
    const demoInfo = db.prepare(`
      INSERT INTO users (username, email, password_hash, salt, display_name, avatar_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'demo',
      'demo@aladenflow.io',
      demoPass.hash,
      demoPass.salt,
      'Alex Mercer (Demo)',
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=128&q=80'
    );

    db.prepare(`
      INSERT INTO user_settings (
        user_id, theme_mode, ambient_theme, ai_provider, ai_api_key, ai_base_url, ai_model, sidebar_collapsed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      demoInfo.lastInsertRowid,
      'dark',
      'nebula',
      'opencode',
      '',
      'https://api.groq.com/openai/v1',
      'qwen/qwen3.8-27b',
      0
    );

    // 2. Seed Sarah (Light Mode, Aurora Ambient, Groq Llama)
    const sarahPass = hashPassword('password123');
    const sarahInfo = db.prepare(`
      INSERT INTO users (username, email, password_hash, salt, display_name, avatar_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'sarah',
      'sarah@aladenflow.io',
      sarahPass.hash,
      sarahPass.salt,
      'Sarah Chen',
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=128&q=80'
    );

    db.prepare(`
      INSERT INTO user_settings (
        user_id, theme_mode, ambient_theme, ai_provider, ai_api_key, ai_base_url, ai_model, sidebar_collapsed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sarahInfo.lastInsertRowid,
      'light',
      'aurora',
      'groq',
      '',
      'https://api.groq.com/openai/v1',
      'llama-3.3-70b-versatile',
      0
    );

    console.log('✅ Seeded default users: "demo" (Dark/Nebula) and "sarah" (Light/Aurora)');
  } catch (err) {
    console.error('Failed to seed users:', err);
  }
}

seedUsersIfEmpty();

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  createSession,
  getAuthUser,
  getUserSettings,
  updateUserSettings,
  seedUsersIfEmpty
};

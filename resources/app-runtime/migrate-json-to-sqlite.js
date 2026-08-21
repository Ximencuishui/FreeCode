#!/usr/bin/env node
/**
 * JSON → SQLite 数据迁移脚本
 *
 * 将 data/users.json 和 data/collections/**/*.json 迁移到 data/app.db
 *
 * 用法：node migrate-json-to-sqlite.js
 *
 * 迁移完成后，原 JSON 文件会被重命名为 .bak 备份。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const COLLECTIONS_DIR = path.join(DATA_DIR, 'collections');
const DB_FILE = path.join(DATA_DIR, 'app.db');

async function main() {
  console.log('=== FreeCoder JSON → SQLite 迁移工具 ===\n');

  // 检查是否有数据需要迁移
  const hasUsers = fs.existsSync(USERS_FILE);
  const hasCollections = fs.existsSync(COLLECTIONS_DIR);

  if (!hasUsers && !hasCollections) {
    console.log('没有找到 JSON 数据文件，无需迁移。');
    return;
  }

  // 如果数据库已存在，提示用户
  if (fs.existsSync(DB_FILE)) {
    console.log('⚠️  数据库文件已存在：' + DB_FILE);
    console.log('   继续执行将跳过已存在的记录。\n');
  }

  // 初始化 sql.js
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  // 加载或创建数据库
  let db;
  try {
    const fileData = fs.readFileSync(DB_FILE);
    db = new SQL.Database(fileData);
    console.log('✅ 已加载现有数据库\n');
  } catch (_e) {
    db = new SQL.Database();
    console.log('📦 创建新数据库\n');
  }

  // 建表
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      salt TEXT,
      password_hash TEXT,
      github_id TEXT UNIQUE,
      google_id TEXT UNIQUE,
      wechat_openid TEXT UNIQUE,
      avatar_url TEXT,
      display_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS collection_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      collection TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_collection_user ON collection_items(user_id, collection)');
  db.run('CREATE INDEX IF NOT EXISTS idx_collection_updated ON collection_items(user_id, collection, updated_at DESC)');

  db.run(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  // 迁移用户
  let userCount = 0;
  if (hasUsers) {
    console.log('📋 迁移用户数据...');
    try {
      const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) || [];
      for (const user of users) {
        try {
          db.run(
            'INSERT OR IGNORE INTO users (id, username, salt, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [
              user.id,
              user.username,
              user.salt || null,
              user.passwordHash || user.password_hash || null,
              user.createdAt || user.created_at || new Date().toISOString(),
              user.updatedAt || user.updated_at || user.createdAt || user.created_at || new Date().toISOString(),
            ]
          );
          userCount++;
        } catch (e) {
          console.log('   ⚠️  跳过用户 ' + (user.username || user.id) + ': ' + e.message);
        }
      }
      console.log('   ✅ 迁移了 ' + userCount + ' 个用户\n');
    } catch (e) {
      console.log('   ❌ 读取用户文件失败: ' + e.message + '\n');
    }
  }

  // 迁移集合数据
  let itemCount = 0;
  if (hasCollections) {
    console.log('📋 迁移集合数据...');
    try {
      const userIds = fs.readdirSync(COLLECTIONS_DIR);
      for (const userId of userIds) {
        const userDir = path.join(COLLECTIONS_DIR, userId);
        if (!fs.statSync(userDir).isDirectory()) continue;

        const files = fs.readdirSync(userDir).filter(function (f) { return f.endsWith('.json'); });
        for (const file of files) {
          const collection = path.basename(file, '.json');
          try {
            const items = JSON.parse(fs.readFileSync(path.join(userDir, file), 'utf8')) || [];
            for (const item of items) {
              try {
                // 提取元数据字段，其余作为 data
                const metaFields = ['id', 'createdAt', 'updatedAt', 'created_at', 'updated_at'];
                const data = {};
                for (const key of Object.keys(item)) {
                  if (!metaFields.includes(key)) data[key] = item[key];
                }

                db.run(
                  'INSERT OR IGNORE INTO collection_items (id, user_id, collection, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
                  [
                    item.id,
                    userId,
                    collection,
                    JSON.stringify(data),
                    item.createdAt || item.created_at || new Date().toISOString(),
                    item.updatedAt || item.updated_at || item.createdAt || item.created_at || new Date().toISOString(),
                  ]
                );
                itemCount++;
              } catch (e) {
                console.log('   ⚠️  跳过记录 ' + item.id + ': ' + e.message);
              }
            }
          } catch (e) {
            console.log('   ⚠️  读取文件 ' + file + ' 失败: ' + e.message);
          }
        }
      }
      console.log('   ✅ 迁移了 ' + itemCount + ' 条记录\n');
    } catch (e) {
      console.log('   ❌ 读取集合目录失败: ' + e.message + '\n');
    }
  }

  // 保存数据库
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_FILE, buffer);
  console.log('💾 数据库已保存到: ' + DB_FILE);

  // 备份原文件
  if (hasUsers) {
    const bakFile = USERS_FILE + '.bak';
    fs.renameSync(USERS_FILE, bakFile);
    console.log('📁 用户文件已备份为: ' + bakFile);
  }
  if (hasCollections) {
    const bakDir = COLLECTIONS_DIR + '.bak';
    fs.renameSync(COLLECTIONS_DIR, bakDir);
    console.log('📁 集合目录已备份为: ' + bakDir);
  }

  console.log('\n✅ 迁移完成！');
  console.log('   总计: ' + userCount + ' 用户, ' + itemCount + ' 条记录');
}

main().catch(function (e) {
  console.error('❌ 迁移失败:', e);
  process.exit(1);
});

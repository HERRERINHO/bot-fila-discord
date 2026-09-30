const Database=require("better-sqlite3");
const db=new Database("queue.sqlite");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS queues(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL,
 name TEXT NOT NULL,
 format INTEGER NOT NULL DEFAULT 1,
 channel_id TEXT,
 message_id TEXT,
 status TEXT NOT NULL DEFAULT 'open',
 emoji TEXT NOT NULL DEFAULT '🎟️',
 role_id TEXT,
 price TEXT NOT NULL DEFAULT 'R$ 0,00',
 platform TEXT NOT NULL DEFAULT 'Emulador',
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS queue_members(queue_id INTEGER NOT NULL,user_id TEXT NOT NULL,joined_at INTEGER NOT NULL,PRIMARY KEY(queue_id,user_id));
CREATE TABLE IF NOT EXISTS matches(id INTEGER PRIMARY KEY AUTOINCREMENT,queue_id INTEGER NOT NULL,guild_id TEXT NOT NULL,thread_id TEXT,status TEXT NOT NULL DEFAULT 'open',created_at INTEGER NOT NULL,finished_at INTEGER);
CREATE TABLE IF NOT EXISTS match_players(match_id INTEGER NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(match_id,user_id));
CREATE TABLE IF NOT EXISTS stats(guild_id TEXT NOT NULL,user_id TEXT NOT NULL,matches INTEGER NOT NULL DEFAULT 0,wins INTEGER NOT NULL DEFAULT 0,mediator_count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(guild_id,user_id));
CREATE TABLE IF NOT EXISTS blacklist(guild_id TEXT NOT NULL,user_id TEXT NOT NULL,reason TEXT,PRIMARY KEY(guild_id,user_id));
`);

const columns=db.prepare("PRAGMA table_info(queues)").all().map(c=>c.name);
if(!columns.includes("price")) db.exec("ALTER TABLE queues ADD COLUMN price TEXT NOT NULL DEFAULT 'R$ 0,00'");
if(!columns.includes("platform")) db.exec("ALTER TABLE queues ADD COLUMN platform TEXT NOT NULL DEFAULT 'Emulador'");

module.exports=db;

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let db;

async function initDatabase() {
    db = await open({
        filename: path.join(__dirname, 'influencer_bot.db'),
        driver: sqlite3.Database
    });
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS posts (
            id TEXT PRIMARY KEY,
            timestamp TEXT,
            topic TEXT,
            hook TEXT,
            format TEXT,
            hashtags TEXT,
            engagement_score REAL,
            views INTEGER,
            likes INTEGER,
            comments INTEGER,
            shares INTEGER,
            saves INTEGER,
            followers_gained INTEGER
        );
        
        CREATE TABLE IF NOT EXISTS trends (
            id TEXT PRIMARY KEY,
            timestamp TEXT,
            topic TEXT,
            source TEXT,
            engagement_potential REAL
        );
        
        CREATE TABLE IF NOT EXISTS learnings (
            id TEXT PRIMARY KEY,
            timestamp TEXT,
            insight TEXT,
            confidence REAL,
            applied_to TEXT
        );
    `);
    
    return db;
}

async function savePost(postData) {
    const id = `${Date.now()}_${Math.random()}`;
    await db.run(`
        INSERT INTO posts (id, timestamp, topic, hook, hashtags)
        VALUES (?, ?, ?, ?, ?)
    `, [id, new Date().toISOString(), postData.topic, postData.hook, JSON.stringify(postData.hashtags)]);
    return id;
}

async function updatePostEngagement(postId, engagementScore) {
    await db.run(`
        UPDATE posts SET engagement_score = ? WHERE id = ?
    `, [engagementScore, postId]);
}

async function getPostStats() {
    const result = await db.get(`
        SELECT 
            COUNT(*) as totalPosts,
            AVG(engagement_score) as avgEngagement
        FROM posts WHERE engagement_score IS NOT NULL
    `);
    return result || { totalPosts: 0, avgEngagement: 0 };
}

async function getTrainingData(limit = 100) {
    const rows = await db.all(`
        SELECT timestamp, topic, hook, hashtags, engagement_score
        FROM posts 
        WHERE engagement_score IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT ?
    `, [limit]);
    
    return rows.map(row => ({
        timestamp: row.timestamp,
        topic: row.topic,
        hook: row.hook,
        hashtags: JSON.parse(row.hashtags || '[]'),
        engagement_score: row.engagement_score
    }));
}

async function getBestPostingHour() {
    const result = await db.get(`
        SELECT strftime('%H', timestamp) as hour, AVG(engagement_score) as avg_score
        FROM posts
        WHERE engagement_score IS NOT NULL
        GROUP BY hour
        ORDER BY avg_score DESC
        LIMIT 1
    `);
    return result ? `${result.hour}:00` : '19:00';
}

module.exports = {
    initDatabase,
    savePost,
    updatePostEngagement,
    getPostStats,
    getTrainingData,
    getBestPostingHour
};

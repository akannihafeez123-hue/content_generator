#!/usr/bin/env node

/**
 * AI Influencer Bot - Self-Learning System (Node.js Version)
 * Runs as a Web Service on Render Free Tier
 * Sends ready-to-upload videos to Telegram every hour
 */

require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Import modules
const { initDatabase, savePost, getPostStats, getTrainingData, getBestPostingHour } = require('./database');
const { scrapeTrending, getFallbackTrends } = require('./scraper');
const { generateScript, createVideo } = require('./generator');
const { sendVideoToTelegram, setupTelegramBot } = require('./telegram');
const { LearningEngine } = require('./learning');

// Configuration
const PORT = process.env.PORT || 8080;
const CONTENT_PER_HOUR = parseInt(process.env.CONTENT_PER_HOUR) || 1;
const EXPLORATION_RATE = parseFloat(process.env.EXPLORATION_RATE) || 0.10;

// Global state
let learningEngine = null;
let lastRunTime = null;
let totalRuns = 0;
const startTime = new Date();

// Create videos directory
const videosDir = path.join(__dirname, 'videos');
if (!fs.existsSync(videosDir)) {
    fs.mkdirSync(videosDir);
}

// Initialize Express app
const app = express();
app.use(express.json());

// ============================================
// KeepAlive Endpoints (for UptimeRobot)
// ============================================

app.get('/', (req, res) => {
    res.json({
        status: 'alive',
        bot: 'AI Influencer Bot',
        timestamp: new Date().toISOString(),
        uptime: getUptime(),
        stats: getBotStats()
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: getUptime(),
        lastRun: lastRunTime,
        totalRuns: totalRuns,
        telegram: process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'missing'
    });
});

app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

app.post('/trigger', async (req, res) => {
    res.json({
        status: 'triggered',
        message: 'Content generation started',
        timestamp: new Date().toISOString()
    });
    // Run in background
    setTimeout(() => runHourly(), 100);
});

app.get('/stats', async (req, res) => {
    const stats = await getPostStats();
    res.json({
        totalPosts: stats.totalPosts || 0,
        avgEngagement: stats.avgEngagement || 0,
        totalRuns: totalRuns,
        uptime: getUptime(),
        learningEnabled: learningEngine !== null
    });
});

// ============================================
// Helper Functions
// ============================================

function getUptime() {
    const diff = Math.floor((new Date() - startTime) / 1000);
    const days = Math.floor(diff / 86400);
    const hours = Math.floor((diff % 86400) / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
}

function getBotStats() {
    return {
        totalRuns: totalRuns,
        lastRun: lastRunTime ? lastRunTime.toISOString() : null,
        uptime: getUptime()
    };
}

// ============================================
// Main Content Generation Function
// ============================================

async function runHourly() {
    console.log('='.repeat(50));
    console.log('Starting hourly content generation at:', new Date().toISOString());
    console.log('='.repeat(50));
    
    lastRunTime = new Date();
    totalRuns++;
    
    try {
        // Step 1: Get trending content
        console.log('📊 Scraping trending fitness content...');
        let trends = await scrapeTrending(CONTENT_PER_HOUR * 2);
        
        if (!trends || trends.length === 0) {
            console.log('⚠️ No trends found, using fallback topics');
            trends = getFallbackTrends();
        }
        
        // Step 2: Score trends with ML (if available)
        console.log('🤖 Scoring trends...');
        const scoredTrends = [];
        for (const trend of trends) {
            let score = 0.5; // Default score
            if (learningEngine) {
                const dummyPost = {
                    hook: trend.topic.substring(0, 50),
                    hashtags: ['#fitness', '#gym'],
                    topic: trend.topic,
                    timestamp: new Date().toISOString()
                };
                score = await learningEngine.predictEngagement(dummyPost);
            }
            scoredTrends.push({ score, trend });
        }
        
        // Sort by score descending
        scoredTrends.sort((a, b) => b.score - a.score);
        
        // Step 3: Select content (with exploration)
        const selected = [];
        for (let i = 0; i < Math.min(CONTENT_PER_HOUR, scoredTrends.length); i++) {
            if (Math.random() < EXPLORATION_RATE && i > 0) {
                // Exploration mode - pick lower ranked
                selected.push(scoredTrends[scoredTrends.length - 1]);
                console.log('🔍 EXPLORATION MODE - testing lower-ranked content');
            } else {
                // Exploitation mode - pick highest ranked
                selected.push(scoredTrends[i]);
                console.log(`📈 EXPLOITATION MODE - predicted score: ${(scoredTrends[i].score * 100).toFixed(1)}%`);
            }
        }
        
        // Step 4: Generate and send videos
        for (const { score, trend } of selected) {
            console.log(`🎬 Generating video for: ${trend.topic.substring(0, 50)}...`);
            
            const scriptData = generateScript(trend);
            const videoPath = await createVideo(scriptData, videosDir);
            
            if (videoPath && fs.existsSync(videoPath)) {
                const success = await sendVideoToTelegram(videoPath, scriptData, score);
                if (success) {
                    console.log('✅ Video sent to Telegram');
                    // Save to database
                    await savePost({
                        topic: trend.topic,
                        hook: scriptData.hook,
                        hashtags: scriptData.hashtags,
                        source: trend.source
                    });
                } else {
                    console.log('❌ Failed to send video');
                }
            } else {
                console.log('❌ Failed to create video');
            }
        }
        
        console.log(`Hourly run complete - ${selected.length} videos generated`);
        
        // Step 5: Train/retrain model if needed
        if (learningEngine) {
            const shouldRetrain = await learningEngine.shouldRetrain();
            if (shouldRetrain) {
                const trainingData = await getTrainingData();
                if (trainingData.length >= 10) {
                    await learningEngine.train(trainingData);
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Hourly run failed:', error.message);
    }
}

// ============================================
// Initialize and Start
// ============================================

async function main() {
    console.log('='.repeat(60));
    console.log('🚀 AI INFLUENCER BOT - Self-Learning System (Node.js)');
    console.log('='.repeat(60));
    console.log('');
    console.log('⚠️  Make sure you have set environment variables:');
    console.log('   - TELEGRAM_BOT_TOKEN (required)');
    console.log('   - TELEGRAM_CHAT_ID (required)');
    console.log('');
    console.log(`🌐 Web server running on port ${PORT}`);
    console.log('   Health check: http://localhost:' + PORT + '/health');
    console.log('   Stats: http://localhost:' + PORT + '/stats');
    console.log('');
    console.log('Press Ctrl+C to stop');
    console.log('-'.repeat(60));
    
    // Initialize database
    await initDatabase();
    console.log('✅ Database initialized');
    
    // Initialize learning engine
    learningEngine = new LearningEngine();
    await learningEngine.loadModel();
    console.log('✅ Learning engine initialized');
    
    // Setup Telegram bot (for receiving feedback)
    setupTelegramBot();
    console.log('✅ Telegram bot ready');
    
    // Schedule hourly job
    // Run at minute 0 of every hour
    cron.schedule('0 * * * *', () => {
        runHourly();
    });
    console.log('⏰ Scheduled: Hourly content generation');
    
    // Run once immediately on startup
    setTimeout(() => runHourly(), 5000);
    
    // Start Express server
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ KeepAlive server running on port ${PORT}`);
    });
}

// Start the bot
main().catch(console.error);

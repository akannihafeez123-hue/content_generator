#!/usr/bin/env node

/**
 * AI Influencer Bot - Self-Learning System (Node.js Version)
 * WITH REAL AI VIDEO GENERATION
 * Runs as a Web Service on Render Free Tier
 * Sends ready-to-upload videos to Telegram every hour
 */

require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Import modules
const { initDatabase, savePost, getPostStats, getTrainingData, getBestPostingHour, updatePostEngagement } = require('./database');
const { scrapeTrending, getFallbackTrends } = require('./scraper');
const { generateScript, createVideo, initVideoGenerator } = require('./generator');
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
    fs.mkdirSync(videosDir, { recursive: true });
}

// Initialize Express app
const app = express();
app.use(express.json());

// Store pending content for feedback (shared across modules)
global.pendingContent = new Map();

// ============================================
// KeepAlive Endpoints (for UptimeRobot)
// ============================================

app.get('/', (req, res) => {
    res.json({
        status: 'alive',
        bot: 'AI Influencer Bot',
        version: '2.0.0',
        features: ['real-ai-video', 'self-learning', 'hourly-content'],
        timestamp: new Date().toISOString(),
        uptime: getUptime(),
        stats: getBotStats()
    });
});

app.get('/health', (req, res) => {
    const videoProvider = process.env.VIDEO_PROVIDER || 'animated-fallback';
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: getUptime(),
        lastRun: lastRunTime,
        totalRuns: totalRuns,
        telegram: process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'missing',
        videoProvider: videoProvider,
        replicateConfigured: !!process.env.REPLICATE_API_TOKEN,
        huggingfaceConfigured: !!process.env.HUGGINGFACE_API_TOKEN,
        learningEnabled: learningEngine !== null
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
    // Run in background to not block the response
    setTimeout(() => runHourly(), 100);
});

app.get('/stats', async (req, res) => {
    const stats = await getPostStats();
    res.json({
        totalPosts: stats.totalPosts || 0,
        avgEngagement: stats.avgEngagement || 0,
        totalRuns: totalRuns,
        uptime: getUptime(),
        learningEnabled: learningEngine !== null,
        videoProvider: process.env.VIDEO_PROVIDER || 'animated-fallback',
        lastRun: lastRunTime,
        botStartTime: startTime.toISOString()
    });
});

app.get('/health/deep', async (req, res) => {
    // Deep health check with database verification
    let dbStatus = 'ok';
    try {
        const { initDatabase } = require('./database');
        await initDatabase();
    } catch (error) {
        dbStatus = 'error: ' + error.message;
    }
    
    res.json({
        status: 'healthy',
        database: dbStatus,
        videosDirectory: fs.existsSync(videosDir) ? 'ok' : 'missing',
        pendingContentCount: global.pendingContent?.size || 0,
        uptime: getUptime(),
        totalRuns: totalRuns
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
    const seconds = diff % 60;
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function getBotStats() {
    return {
        totalRuns: totalRuns,
        lastRun: lastRunTime ? lastRunTime.toISOString() : null,
        uptime: getUptime(),
        videoProvider: process.env.VIDEO_PROVIDER || 'animated-fallback'
    };
}

// ============================================
// Main Content Generation Function
// ============================================

async function runHourly() {
    console.log('='.repeat(60));
    console.log(`🚀 Starting hourly content generation at: ${new Date().toISOString()}`);
    console.log(`📹 Video provider: ${process.env.VIDEO_PROVIDER || 'animated-fallback'}`);
    console.log('='.repeat(60));
    
    lastRunTime = new Date();
    totalRuns++;
    
    try {
        // Step 1: Get trending content
        console.log('📊 Scraping trending fitness content...');
        let trends = await scrapeTrending(CONTENT_PER_HOUR * 2);
        
        if (!trends || trends.length === 0) {
            console.log('⚠️ No trends found from RSS, using fallback topics');
            trends = getFallbackTrends();
        }
        
        console.log(`✅ Found ${trends.length} trending topics`);
        
        // Step 2: Score trends with ML (if available)
        console.log('🤖 Scoring trends with ML model...');
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
                try {
                    score = await learningEngine.predictEngagement(dummyPost);
                } catch (error) {
                    console.log(`⚠️ ML prediction failed for ${trend.topic.substring(0, 30)}: ${error.message}`);
                }
            }
            scoredTrends.push({ score, trend });
        }
        
        // Sort by score descending
        scoredTrends.sort((a, b) => b.score - a.score);
        console.log(`📈 Top score: ${(scoredTrends[0]?.score * 100).toFixed(1)}%`);
        
        // Step 3: Select content (with exploration)
        const selected = [];
        for (let i = 0; i < Math.min(CONTENT_PER_HOUR, scoredTrends.length); i++) {
            if (Math.random() < EXPLORATION_RATE && i > 0) {
                // Exploration mode - pick lower ranked to discover new patterns
                const randomLowIndex = scoredTrends.length - 1 - Math.floor(Math.random() * 3);
                selected.push(scoredTrends[randomLowIndex]);
                console.log('🔍 EXPLORATION MODE - testing lower-ranked content for discovery');
            } else {
                // Exploitation mode - pick highest ranked
                selected.push(scoredTrends[i]);
                console.log(`📈 EXPLOITATION MODE - using predicted score: ${(scoredTrends[i].score * 100).toFixed(1)}%`);
            }
        }
        
        // Step 4: Generate and send videos
        let successCount = 0;
        let failCount = 0;
        
        for (const { score, trend } of selected) {
            console.log(`\n🎬 Processing: "${trend.topic.substring(0, 60)}..."`);
            console.log(`   Source: ${trend.source}`);
            console.log(`   Predicted score: ${(score * 100).toFixed(1)}%`);
            
            try {
                // Generate script
                const scriptData = generateScript(trend);
                console.log(`   ✓ Script generated (hook: "${scriptData.hook.substring(0, 40)}...")`);
                
                // Create video (REAL AI VIDEO)
                console.log(`   🎥 Generating AI video... (this may take 10-30 seconds)`);
                const videoPath = await createVideo(scriptData, videosDir);
                
                if (videoPath && fs.existsSync(videoPath)) {
                    const fileSize = (fs.statSync(videoPath).size / 1024 / 1024).toFixed(2);
                    const fileType = videoPath.endsWith('.mp4') ? 'video' : 'image';
                    console.log(`   ✓ ${fileType} created: ${path.basename(videoPath)} (${fileSize} MB)`);
                    
                    // Send to Telegram
                    const success = await sendVideoToTelegram(videoPath, scriptData, score);
                    if (success) {
                        console.log(`   ✅ Video sent to Telegram successfully`);
                        successCount++;
                        
                        // Save to database for learning
                        const postId = await savePost({
                            topic: trend.topic,
                            hook: scriptData.hook,
                            hashtags: scriptData.hashtags,
                            source: trend.source,
                            exercise: scriptData.exercise,
                            score: score
                        });
                        
                        // Store for feedback
                        global.pendingContent.set(postId, {
                            postId: postId,
                            scriptData: scriptData,
                            trend: trend,
                            timestamp: new Date().toISOString()
                        });
                        
                    } else {
                        console.log(`   ❌ Failed to send to Telegram`);
                        failCount++;
                    }
                } else {
                    console.log(`   ❌ Failed to create video`);
                    failCount++;
                }
            } catch (error) {
                console.log(`   ❌ Error processing trend: ${error.message}`);
                failCount++;
            }
        }
        
        console.log('\n' + '='.repeat(60));
        console.log(`📊 Hourly Run Complete:`);
        console.log(`   ✅ Successful videos: ${successCount}`);
        console.log(`   ❌ Failed: ${failCount}`);
        console.log(`   📈 Total runs so far: ${totalRuns}`);
        console.log('='.repeat(60));
        
        // Step 5: Train/retrain model if needed
        if (learningEngine) {
            try {
                const shouldRetrain = await learningEngine.shouldRetrain();
                if (shouldRetrain) {
                    console.log('🧠 Retraining ML model with new data...');
                    const trainingData = await getTrainingData();
                    if (trainingData.length >= 10) {
                        await learningEngine.train(trainingData);
                        console.log(`✅ Model retrained on ${trainingData.length} samples`);
                    } else {
                        console.log(`⏳ Need ${10 - trainingData.length} more samples before retraining`);
                    }
                }
            } catch (error) {
                console.log(`⚠️ Model retraining failed: ${error.message}`);
            }
        }
        
        // Clean up old video files (keep last 50)
        try {
            const files = fs.readdirSync(videosDir);
            const videoFiles = files.filter(f => f.endsWith('.mp4') || f.endsWith('.png'));
            if (videoFiles.length > 50) {
                const sorted = videoFiles.sort((a, b) => {
                    return fs.statSync(path.join(videosDir, a)).mtimeMs - 
                           fs.statSync(path.join(videosDir, b)).mtimeMs;
                });
                const toDelete = sorted.slice(0, sorted.length - 50);
                for (const file of toDelete) {
                    fs.unlinkSync(path.join(videosDir, file));
                }
                console.log(`🧹 Cleaned up ${toDelete.length} old video files`);
            }
        } catch (error) {
            console.log(`⚠️ Cleanup failed: ${error.message}`);
        }
        
    } catch (error) {
        console.error('❌ Hourly run failed with error:', error);
        console.error(error.stack);
    }
}

// ============================================
// Manual Run Function (for testing)
// ============================================

async function runOnce() {
    console.log('🔧 Running one-time content generation (manual trigger)...');
    await runHourly();
    console.log('✅ One-time run completed');
    process.exit(0);
}

// Check for --once flag
if (process.argv.includes('--once')) {
    // Initialize and run once
    (async () => {
        await initDatabase();
        learningEngine = new LearningEngine();
        await learningEngine.loadModel();
        initVideoGenerator();
        setupTelegramBot();
        await runOnce();
    })();
    return;
}

// ============================================
// Initialize and Start
// ============================================

async function main() {
    console.log('='.repeat(60));
    console.log('🚀 AI INFLUENCER BOT - Self-Learning System (Node.js)');
    console.log('🎬 WITH REAL AI VIDEO GENERATION');
    console.log('='.repeat(60));
    console.log('');
    console.log('⚠️  Make sure you have set environment variables:');
    console.log('   - TELEGRAM_BOT_TOKEN (required)');
    console.log('   - TELEGRAM_CHAT_ID (required)');
    console.log('');
    console.log('📹 AI Video Configuration:');
    
    const videoProvider = process.env.VIDEO_PROVIDER || 'animated-fallback';
    if (videoProvider === 'replicate' && process.env.REPLICATE_API_TOKEN) {
        console.log('   ✅ Replicate.com AI video - ENABLED (high quality)');
    } else if (videoProvider === 'huggingface' && process.env.HUGGINGFACE_API_TOKEN) {
        console.log('   ✅ Hugging Face AI video - ENABLED (good quality)');
    } else {
        console.log('   ⚠️  No AI video API configured - using animated fallback');
        console.log('   💡 Get FREE API keys:');
        console.log('      - Replicate.com: https://replicate.com (100 free gens)');
        console.log('      - Hugging Face: https://huggingface.co (30k/month free)');
    }
    console.log('');
    console.log(`🌐 Web server running on port ${PORT}`);
    console.log('   Health check: http://localhost:' + PORT + '/health');
    console.log('   Stats: http://localhost:' + PORT + '/stats');
    console.log('   Deep health: http://localhost:' + PORT + '/health/deep');
    console.log('');
    console.log('Press Ctrl+C to stop');
    console.log('-'.repeat(60));
    
    try {
        // Initialize database
        await initDatabase();
        console.log('✅ Database initialized');
        
        // Initialize learning engine
        learningEngine = new LearningEngine();
        await learningEngine.loadModel();
        console.log('✅ Learning engine initialized');
        
        // Initialize video generator
        initVideoGenerator();
        console.log('✅ Video generator initialized');
        
        // Setup Telegram bot (for receiving feedback)
        setupTelegramBot();
        console.log('✅ Telegram bot ready');
        
        // Schedule hourly job - run at minute 0 of every hour
        // Also add a backup schedule every 30 minutes to ensure we don't miss
        cron.schedule('0 * * * *', () => {
            console.log(`\n⏰ Scheduled job triggered at ${new Date().toISOString()}`);
            runHourly();
        });
        console.log('⏰ Scheduled: Hourly content generation (at :00)');
        
        // Optional: Also run at 30 minutes past as backup if no content was generated
        cron.schedule('30 * * * *', async () => {
            const hoursSinceLastRun = lastRunTime ? (new Date() - lastRunTime) / (1000 * 60 * 60) : 2;
            if (hoursSinceLastRun > 1.5) {
                console.log(`⚠️ No run detected in last ${hoursSinceLastRun.toFixed(1)} hours, running backup job...`);
                await runHourly();
            }
        });
        console.log('⏰ Scheduled: Backup check at :30');
        
        // Run once immediately on startup (after 10 second delay to let everything initialize)
        setTimeout(() => {
            console.log('🚀 Running initial content generation...');
            runHourly();
        }, 10000);
        
        // Start Express server
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ KeepAlive server running on port ${PORT}`);
            console.log(`   UptimeRobot URL: https://your-app.onrender.com/health`);
        });
        
    } catch (error) {
        console.error('❌ Failed to initialize bot:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT. Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM. Shutting down gracefully...');
    process.exit(0);
});

// Start the bot
main().catch(console.error);

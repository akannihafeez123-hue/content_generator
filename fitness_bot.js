// fitness_bot.js - Automated Fitness Influencer Content Generator
// Uses OpenShorts to generate AI fitness videos for Instagram

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// Configuration
const OPENSHORTS_URL = process.env.OPENSHORTS_URL || 'http://localhost:3000';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;

// Fitness topics to generate
const FITNESS_TOPICS = [
    "Proper squat form for glute growth",
    "How to engage your core during deadlifts",
    "Best warm-up exercises before leg day",
    "Common push-up mistakes and fixes",
    "Shoulder mobility routine for overhead press",
    "Why you're not seeing ab definition",
    "The correct way to breathe during heavy lifts",
    "Full back workout for wider lats",
    "Hip thrust technique for glute activation",
    "Recovery tips after intense leg day"
];

// Picked influencers to use as AI actors (community shared)
const AI_ACTORS = [
    "fitness_trainer_1",
    "athletic_coach",
    "gym_instructor_female"
];

/**
 * Generate script using Gemini (FREE)
 */
async function generateFitnessScript(topic) {
    const prompt = `Write a 30-second Instagram Reel script about "${topic}" for a fitness influencer.

Format exactly like this:

TITLE: [catchy title under 40 chars]
HOOK: (what you say in first 3 seconds)
BODY: (20-30 seconds of valuable advice)
CTA: (call to action - ask to follow or comment)
HASHTAGS: (5 relevant tags)

Make it energetic, expert, and motivational. Use simple language.`;

    const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`,
        {
            contents: [{ parts: [{ text: prompt }] }]
        },
        {
            headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': GEMINI_API_KEY
            }
        }
    );

    const text = response.data.candidates[0].content.parts[0].text;
    
    // Parse the response
    const titleMatch = text.match(/TITLE:\s*(.+)/i);
    const hookMatch = text.match(/HOOK:\s*(.+)/i);
    const bodyMatch = text.match(/BODY:\s*(.+)/i);
    const ctaMatch = text.match(/CTA:\s*(.+)/i);
    const hashtagsMatch = text.match(/HASHTAGS:\s*(.+)/i);
    
    return {
        title: titleMatch ? titleMatch[1].trim() : topic.substring(0, 40),
        hook: hookMatch ? hookMatch[1].trim() : `Want better ${topic.split(' ')[0]} results?`,
        body: bodyMatch ? bodyMatch[1].trim() : `Here's what most people get wrong about ${topic.toLowerCase()}.`,
        cta: ctaMatch ? ctaMatch[1].trim() : "Follow for more fitness tips!",
        hashtags: hashtagsMatch ? hashtagsMatch[1].trim().split(' ') : ["#fitness", "#gym", "#workout", "#fitfam", "#training"],
        fullScript: text
    };
}

/**
 * Generate video using OpenShorts API
 */
async function generateFitnessVideo(script, actorId) {
    console.log(`🎬 Generating video with actor: ${actorId}`);
    console.log(`   Topic: ${script.title}`);
    
    const formData = new FormData();
    formData.append('actor_id', actorId);
    formData.append('script', script.body);
    formData.append('hook', script.hook);
    formData.append('cta', script.cta);
    formData.append('duration', '30');
    formData.append('aspect_ratio', '9:16'); // Instagram Reels format
    
    try {
        const response = await axios.post(
            `${OPENSHORTS_URL}/api/generate-short`,
            formData,
            {
                headers: formData.getHeaders(),
                responseType: 'stream'
            }
        );
        
        const videoPath = path.join(__dirname, 'videos', `fitness_${Date.now()}.mp4`);
        const writer = fs.createWriteStream(videoPath);
        response.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        
        console.log(`✅ Video saved: ${videoPath}`);
        return videoPath;
        
    } catch (error) {
        console.error('Video generation failed:', error.message);
        return null;
    }
}

/**
 * Send video to Telegram for review
 */
async function sendToTelegram(videoPath, script) {
    if (!TELEGRAM_BOT_TOKEN) {
        console.log('⚠️ TELEGRAM_BOT_TOKEN not set, cannot send');
        return false;
    }
    
    const caption = `🏋️‍♀️ *NEW FITNESS REEL READY*

*Title:* ${script.title}

*Hook:* ${script.hook}

*Script:* ${script.body.substring(0, 200)}...

*CTA:* ${script.cta}

*Hashtags:* ${script.hashtags.join(' ')}

---
📱 *Ready to post to Instagram!*
👍 Tap 👍 if good, 👎 if needs improvement`;

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendVideo`;
    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('video', fs.createReadStream(videoPath));
    formData.append('caption', caption);
    formData.append('parse_mode', 'Markdown');
    
    try {
        await axios.post(url, formData, { headers: formData.getHeaders() });
        console.log('✅ Video sent to Telegram');
        return true;
    } catch (error) {
        console.error('Telegram send failed:', error.message);
        return false;
    }
}

/**
 * Main automation function
 */
async function generateDailyContent() {
    console.log('\n' + '='.repeat(60));
    console.log(`🎥 Starting content generation at ${new Date().toISOString()}`);
    console.log('='.repeat(60));
    
    // Pick random topic and actor
    const topic = FITNESS_TOPICS[Math.floor(Math.random() * FITNESS_TOPICS.length)];
    const actorId = AI_ACTORS[Math.floor(Math.random() * AI_ACTORS.length)];
    
    console.log(`📝 Selected topic: ${topic}`);
    console.log(`🎭 Selected actor: ${actorId}`);
    
    // Step 1: Generate script with Gemini
    const script = await generateFitnessScript(topic);
    console.log(`✅ Script generated: "${script.title}"`);
    
    // Step 2: Generate video with OpenShorts
    const videoPath = await generateFitnessVideo(script, actorId);
    
    if (videoPath && fs.existsSync(videoPath)) {
        // Step 3: Send to Telegram
        await sendToTelegram(videoPath, script);
        
        // Step 4: Clean up old videos (keep last 20)
        const videosDir = path.join(__dirname, 'videos');
        if (fs.existsSync(videosDir)) {
            const files = fs.readdirSync(videosDir)
                .filter(f => f.endsWith('.mp4'))
                .sort();
            while (files.length > 20) {
                const oldest = files.shift();
                fs.unlinkSync(path.join(videosDir, oldest));
                console.log(`🧹 Cleaned up: ${oldest}`);
            }
        }
    } else {
        console.log('❌ Video generation failed');
    }
    
    console.log('='.repeat(60));
}

// Create videos directory
const videosDir = path.join(__dirname, 'videos');
if (!fs.existsSync(videosDir)) {
    fs.mkdirSync(videosDir);
}

// Run once on startup
generateDailyContent();

// Then run every hour
setInterval(generateDailyContent, 60 * 60 * 1000);

console.log('🤖 AI Fitness Influencer Bot Started');
console.log('⏰ Will generate a new video every hour');
console.log('📱 Videos will be sent to your Telegram');

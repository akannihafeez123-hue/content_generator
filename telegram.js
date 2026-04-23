const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const { updatePostEngagement, getBestPostingHour } = require('./database');

let bot = null;
let pendingContent = new Map();

function setupTelegramBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.error('❌ TELEGRAM_BOT_TOKEN not set');
        return;
    }
    
    bot = new TelegramBot(token, { polling: true });
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    // Handle commands
    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, 
            "🤖 *AI Influencer Bot Active*\n\nI'm generating fitness content every hour!\n\nCommands:\n/status - Check bot status\n/stats - View performance stats\n/help - Show this message",
            { parse_mode: 'Markdown' }
        );
    });
    
    bot.onText(/\/status/, async (msg) => {
        bot.sendMessage(msg.chat.id, 
            "📊 *Bot Status*\n\n✅ Running\n⏰ Hourly schedule: Active\n🧠 Learning mode: Enabled",
            { parse_mode: 'Markdown' }
        );
    });
    
    // Handle callback queries (inline buttons)
    bot.on('callback_query', async (callbackQuery) => {
        const data = callbackQuery.data;
        const messageId = callbackQuery.message.message_id;
        const chatId = callbackQuery.message.chat.id;
        
        if (data.startsWith('good_') || data.startsWith('bad_') || data.startsWith('post_')) {
            const contentId = data.split('_')[1];
            const feedbackType = data.split('_')[0];
            
            let engagementScore = 0.5;
            if (feedbackType === 'good') engagementScore = 0.9;
            if (feedbackType === 'bad') engagementScore = 0.2;
            if (feedbackType === 'post') engagementScore = 0.7;
            
            // Find the content
            for (const [id, content] of pendingContent) {
                if (id.includes(contentId)) {
                    await updatePostEngagement(content.postId, engagementScore);
                    pendingContent.delete(id);
                    break;
                }
            }
            
            bot.editMessageCaption(`✅ Feedback recorded! AI will learn from this.`, {
                chat_id: chatId,
                message_id: messageId
            });
        }
        
        bot.answerCallbackQuery(callbackQuery.id);
    });
    
    console.log('✅ Telegram bot handlers registered');
    return bot;
}

async function sendVideoToTelegram(videoPath, scriptData, predictedScore) {
    if (!bot) {
        console.error('❌ Telegram bot not initialized');
        return false;
    }
    
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const contentId = `${Date.now()}_${Math.random()}`;
    
    const stars = '⭐'.repeat(Math.floor(predictedScore * 5));
    const scoreText = predictedScore > 0.8 ? '🚀 VIRAL POTENTIAL' :
                      predictedScore > 0.6 ? '📈 Strong performer' :
                      predictedScore > 0.4 ? '👍 Solid content' : '⚠️ Low confidence';
    
    const bestHour = await getBestPostingHour();
    
    const caption = `🏋️‍♀️ *READY TO POST* | Score: ${stars} (${(predictedScore * 100).toFixed(0)}%)

*Hook:* ${scriptData.hook}

*Topic:* ${scriptData.topic}

*Predicted performance:* ${scoreText}

📝 *Caption ready:*
\`\`\`
${scriptData.fullScript.substring(0, 900)}
\`\`\`

⏰ *Best posting time:* ${bestHour}

---
Tap ✅ after posting to Instagram to train the AI!`;
    
    const options = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ Posted to IG', callback_data: `post_${contentId}` }],
                [{ text: '👍 Works Well', callback_data: `good_${contentId}` }, { text: '👎 Flop', callback_data: `bad_${contentId}` }]
            ]
        }
    };
    
    try {
        // Check if it's a video or image
        if (videoPath.endsWith('.mp4')) {
            await bot.sendVideo(chatId, videoPath, { caption, ...options });
        } else {
            await bot.sendPhoto(chatId, videoPath, { caption, ...options });
        }
        
        // Store for feedback
        pendingContent.set(contentId, { postId: Date.now().toString(), scriptData });
        
        // Clean up file after sending
        setTimeout(() => {
            try { fs.unlinkSync(videoPath); } catch(e) {}
        }, 60000);
        
        return true;
    } catch (error) {
        console.error('Failed to send to Telegram:', error.message);
        return false;
    }
}

module.exports = {
    setupTelegramBot,
    sendVideoToTelegram
};

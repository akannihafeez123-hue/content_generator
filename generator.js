const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { getTrendingHashtags } = require('./scraper');

function extractExercise(topic) {
    const exercises = ['squat', 'deadlift', 'pull up', 'push up', 'lunge', 'curl', 'press', 'row', 'bench'];
    const lowerTopic = topic.toLowerCase();
    for (const ex of exercises) {
        if (lowerTopic.includes(ex)) return ex;
    }
    return 'exercise';
}

function extractKeyword(topic) {
    const words = topic.toLowerCase().split(' ');
    if (words.length > 2) return words.slice(-2).join(' ');
    return topic.toLowerCase();
}

function generateScript(trend) {
    const topic = trend.topic;
    const exercise = extractExercise(topic);
    const keyword = extractKeyword(topic);
    
    const hooks = [
        `Stop doing ${exercise} wrong! ❌`,
        `The one ${keyword} you're missing 🔥`,
        `I tried this ${keyword} for 30 days...`,
        `3 ${keyword} mistakes ruining your gains`,
        `POV: You finally learned proper ${exercise} form`
    ];
    
    const bodies = [
        `Most people don't realize that ${topic.toLowerCase()} is actually about form, not weight. Here's what the pros know...`,
        `Want faster results? Focus on ${keyword} instead of just going through the motions.`,
        `The secret to mastering ${topic.toLowerCase()} isn't what you think. It's all about mind-muscle connection.`
    ];
    
    const ctas = [
        'Save this for your next workout! 🔥',
        'Tag a friend who needs to see this 💪',
        'Follow for more fitness tips!',
        "Comment 'FORM' for a full tutorial!"
    ];
    
    const hashtagsList = getTrendingHashtags();
    const nicheHashtags = ['#athleticbuild', '#gymgirl', '#fitcheck', '#workoutmotivation'];
    const selectedHashtags = [...hashtagsList, ...nicheHashtags].slice(0, 7);
    
    const selectedHook = hooks[Math.floor(Math.random() * hooks.length)];
    const selectedBody = bodies[Math.floor(Math.random() * bodies.length)];
    const selectedCTA = ctas[Math.floor(Math.random() * ctas.length)];
    
    const fullScript = `${selectedHook}\n\n${selectedBody}\n\n${selectedCTA}\n\n${selectedHashtags.join(' ')}`;
    
    return {
        hook: selectedHook,
        body: selectedBody,
        cta: selectedCTA,
        hashtags: selectedHashtags,
        fullScript: fullScript,
        topic: topic,
        source: trend.source || 'trending'
    };
}

function wrapText(text, width) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = [];
    
    for (const word of words) {
        currentLine.push(word);
        if (currentLine.join(' ').length > width) {
            currentLine.pop();
            lines.push(currentLine.join(' '));
            currentLine = [word];
        }
    }
    if (currentLine.length) lines.push(currentLine.join(' '));
    return lines.length ? lines : [text];
}

async function createVideo(scriptData, videosDir) {
    const timestamp = Date.now();
    const imagePath = path.join(videosDir, `frame_${timestamp}.png`);
    const videoPath = path.join(videosDir, `video_${timestamp}.mp4`);
    
    // Create a text image using Sharp
    const width = 1080;
    const height = 1920;
    
    // Create SVG with text
    const hookLines = wrapText(scriptData.hook, 25);
    const bodyLines = wrapText(scriptData.body.substring(0, 200), 30);
    
    let svgText = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="black"/>
        <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#1a1a2e;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#16213e;stop-opacity:1" />
            </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grad)"/>`;
    
    let y = 500;
    for (const line of hookLines) {
        svgText += `<text x="50%" y="${y}" fill="white" font-family="Arial, sans-serif" font-size="60" font-weight="bold" text-anchor="middle">${escapeXml(line)}</text>`;
        y += 80;
    }
    
    y += 100;
    for (const line of bodyLines) {
        svgText += `<text x="50%" y="${y}" fill="#cccccc" font-family="Arial, sans-serif" font-size="40" text-anchor="middle">${escapeXml(line)}</text>`;
        y += 60;
    }
    
    svgText += `<text x="50%" y="1700" fill="#FF6B6B" font-family="Arial, sans-serif" font-size="50" font-weight="bold" text-anchor="middle">${escapeXml(scriptData.cta)}</text>`;
    svgText += `<text x="50%" y="1850" fill="#888888" font-family="Arial, sans-serif" font-size="35" text-anchor="middle">${escapeXml(scriptData.hashtags.slice(0, 3).join(' '))}</text>`;
    svgText += `</svg>`;
    
    function escapeXml(str) {
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }
    
    // Save SVG to PNG
    await sharp(Buffer.from(svgText))
        .png()
        .toFile(imagePath);
    
    // Note: For actual MP4 video generation, you'd need ffmpeg installed on Render
    // Since Render doesn't have ffmpeg by default, we'll return the image path
    // The image can still be sent to Telegram (as a photo instead of video)
    
    return imagePath; // Return image path as fallback (works without ffmpeg)
}

module.exports = {
    generateScript,
    createVideo
};

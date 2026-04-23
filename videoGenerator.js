// videoGenerator.js
// Uses Google Gemini API with Veo 3.1 for high-quality AI video generation

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class VideoGenerator {
    constructor() {
        this.geminiApiKey = process.env.GEMINI_API_KEY;
        this.videosDir = path.join(__dirname, 'videos');
        
        // Model selection - Veo 3.1 Fast is cheaper, Veo 3.1 is higher quality
        this.model = process.env.GEMINI_VIDEO_MODEL || 'veo-3.1-generate-preview';
        // Options: 'veo-3.1-generate-preview' (standard) or 'veo-3.1-fast-generate-preview' (cheaper/faster)
        
        if (!fs.existsSync(this.videosDir)) {
            fs.mkdirSync(this.videosDir, { recursive: true });
        }
        
        console.log(`🎬 VideoGenerator initialized with Gemini API`);
        console.log(`   Model: ${this.model}`);
        console.log(`   API Key: ${this.geminiApiKey ? '✅ Configured' : '❌ Missing'}`);
    }

    // ============================================
    // GEMINI API VIDEO GENERATION (Primary)
    // ============================================
    
    async generateWithGemini(prompt, durationSeconds = 8) {
        if (!this.geminiApiKey) {
            throw new Error('GEMINI_API_KEY not set. Get one from https://aistudio.google.com/');
        }

        console.log('🎥 Calling Google Gemini API for video generation...');
        
        // Veo 3.1 supports 4, 6, or 8 second videos [citation:5]
        // For fitness content, 8 seconds is optimal for Instagram Reels
        const validDurations = [4, 6, 8];
        let videoDuration = validDurations.includes(durationSeconds) ? durationSeconds : 8;
        
        // Enhance prompt for fitness content with cinematic quality [citation:1]
        const enhancedPrompt = `cinematic, professional fitness video, ${prompt}. Athletic woman demonstrating proper form in a modern, well-lit gym. High quality, smooth motion, professional lighting, 4k.`;
        
        // Build request body according to Gemini API specs [citation:1]
        const requestBody = {
            prompt: enhancedPrompt,
            parameters: {
                durationSeconds: videoDuration,
                resolution: "1080p",      // 720p or 1080p [citation:1]
                aspectRatio: "9:16",      // Portrait for Instagram Reels [citation:1]
                generateAudio: "true"      // Veo 3.1 can generate native audio [citation:2]
            }
        };
        
        console.log(`   Duration: ${videoDuration} seconds`);
        console.log(`   Resolution: 1080p, Aspect: 9:16 (Instagram Reels)`);
        
        try {
            // Step 1: Start video generation [citation:1]
            const startResponse = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateVideos`,
                requestBody,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': this.geminiApiKey
                    }
                }
            );
            
            const operationName = startResponse.data.name;
            console.log(`   Operation started: ${operationName}`);
            
            // Step 2: Poll for completion [citation:1]
            let videoUrl = null;
            let attempts = 0;
            const maxAttempts = 60; // 60 * 5 seconds = 5 minutes max wait
            const pollInterval = 5000; // 5 seconds between polls
            
            while (attempts < maxAttempts) {
                await this.sleep(pollInterval);
                attempts++;
                
                const statusResponse = await axios.get(
                    `https://generativelanguage.googleapis.com/v1beta/${operationName}`,
                    {
                        headers: { 'x-goog-api-key': this.geminiApiKey }
                    }
                );
                
                const operation = statusResponse.data;
                console.log(`   Status: ${operation.done ? 'Completed' : 'Processing'} (attempt ${attempts}/${maxAttempts})`);
                
                if (operation.done) {
                    if (operation.error) {
                        throw new Error(`Generation failed: ${JSON.stringify(operation.error)}`);
                    }
                    
                    // Extract video URL from response [citation:1]
                    if (operation.response && operation.response.generatedVideos) {
                        const videoData = operation.response.generatedVideos[0];
                        videoUrl = videoData.video?.uri || videoData.video?.url;
                        
                        if (!videoUrl && videoData.video) {
                            // Handle different response formats
                            videoUrl = videoData.video;
                        }
                    }
                    break;
                }
            }
            
            if (!videoUrl) {
                throw new Error('Video generation timeout after 5 minutes');
            }
            
            console.log(`   Downloading video...`);
            
            // Step 3: Download the video file
            const videoResponse = await axios({
                method: 'get',
                url: videoUrl,
                responseType: 'stream',
                headers: { 'x-goog-api-key': this.geminiApiKey }
            });
            
            const videoPath = path.join(this.videosDir, `gemini_${Date.now()}.mp4`);
            const writer = fs.createWriteStream(videoPath);
            videoResponse.data.pipe(writer);
            
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            
            const fileSize = (fs.statSync(videoPath).size / 1024 / 1024).toFixed(2);
            console.log(`✅ Gemini video saved: ${videoPath} (${fileSize} MB)`);
            
            return videoPath;
            
        } catch (error) {
            console.error('Gemini API error:', error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response data:', JSON.stringify(error.response.data));
            }
            throw error;
        }
    }

    // ============================================
    // ANIMATED FALLBACK (When Gemini fails or quota exceeded)
    // ============================================
    
    async generateAnimatedVideo(scriptData) {
        console.log('🎨 Generating animated video (fallback mode)...');
        
        try {
            const sharp = require('sharp');
        } catch (error) {
            console.log('⚠️ Sharp not available, using simple text fallback');
            return await this.generateStaticTextImage(scriptData);
        }
        
        const sharp = require('sharp');
        const videoPath = path.join(this.videosDir, `animated_${Date.now()}.mp4`);
        
        // Create frames
        const frames = [];
        const numFrames = 30; // 1 second at 30fps
        const durationSeconds = parseInt(process.env.VIDEO_DURATION) || 5;
        const totalFrames = numFrames * durationSeconds;
        
        console.log(`   Creating ${totalFrames} frames for ${durationSeconds} second video...`);
        
        for (let i = 0; i < totalFrames; i++) {
            const framePath = await this.createAnimatedFrame(scriptData, i, totalFrames);
            frames.push(framePath);
            
            if ((i + 1) % 30 === 0) {
                console.log(`   Frames: ${i + 1}/${totalFrames}`);
            }
        }
        
        try {
            await this.combineFramesToVideo(frames, videoPath, 30);
            frames.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
            console.log(`✅ Animated video created: ${videoPath}`);
            return videoPath;
        } catch (error) {
            console.log('FFmpeg not available, returning first frame as image');
            frames.slice(1).forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
            return frames[0];
        }
    }

    async createAnimatedFrame(scriptData, frameIndex, totalFrames) {
        const sharp = require('sharp');
        const width = 1080;
        const height = 1920;
        
        const progress = frameIndex / totalFrames;
        const hue = 220 + (progress * 20);
        const gradientStart = `hsl(${hue}, 70%, 8%)`;
        const gradientEnd = `hsl(${hue + 10}, 70%, 12%)`;
        const slideOffset = Math.sin(progress * Math.PI * 2) * 15;
        const pulseScale = 1 + Math.sin(progress * Math.PI * 4) * 0.05;
        const fadeIn = Math.min(1, progress * 2);
        const isVisible = progress < 0.2 ? Math.sin(progress * Math.PI * 2.5) : 1;
        
        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="${gradientStart}" />
                    <stop offset="100%" stop-color="${gradientEnd}" />
                </linearGradient>
                <filter id="glow">
                    <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                    <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>
            <rect width="100%" height="100%" fill="url(#grad)"/>
            
            <circle cx="${width/2}" cy="${height/2}" r="${300 + slideOffset}" fill="none" stroke="rgba(255,107,107,0.08)" stroke-width="2"/>
            <circle cx="${width/2}" cy="${height/2}" r="${200 + slideOffset/2}" fill="none" stroke="rgba(255,107,107,0.05)" stroke-width="1"/>
            
            <g opacity="${fadeIn}">
                <text x="${width/2}" y="${height/2 - 200 + slideOffset/2}" fill="white" font-family="Arial, sans-serif" font-size="${60 * pulseScale}" font-weight="bold" text-anchor="middle" filter="url(#glow)">
                    ${this.escapeXml(scriptData.hook || 'Fitness Tip')}
                </text>
            </g>
            
            <g opacity="${Math.min(1, progress * 3)}">
                <text x="${width/2}" y="${height/2 - 30 + slideOffset}" fill="#cccccc" font-family="Arial, sans-serif" font-size="36" text-anchor="middle">
                    ${this.escapeXml((scriptData.body || '').substring(0, 150))}
                </text>
            </g>
            
            <g opacity="${isVisible}">
                <text x="${width/2}" y="${height/2 + 420 + (frameIndex % 30 === 0 ? 10 : 0)}" fill="#FF6B6B" font-family="Arial, sans-serif" font-size="${48 * pulseScale}" font-weight="bold" text-anchor="middle">
                    ${this.escapeXml(scriptData.cta || 'Save this!')}
                </text>
            </g>
            
            <text x="${width/2}" y="${height - 80}" fill="#666666" font-family="Arial, sans-serif" font-size="32" text-anchor="middle">
                ${this.escapeXml((scriptData.hashtags || []).slice(0, 5).join(' '))}
            </text>
            
            <text x="50" y="100" fill="#FF6B6B" font-family="Arial, sans-serif" font-size="40" opacity="0.3">💪</text>
        </svg>`;
        
        const framePath = path.join(this.videosDir, `frame_${Date.now()}_${frameIndex.toString().padStart(4, '0')}.png`);
        await sharp(Buffer.from(svg)).png().toFile(framePath);
        return framePath;
    }

    async generateStaticTextImage(scriptData) {
        console.log('📸 Creating static text image (simplest fallback)...');
        const sharp = require('sharp');
        const imagePath = path.join(this.videosDir, `static_${Date.now()}.png`);
        
        const width = 1080;
        const height = 1920;
        
        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="#1a1a2e"/>
            <circle cx="${width/2}" cy="${height/2}" r="350" fill="none" stroke="#FF6B6B" stroke-width="2" opacity="0.15"/>
            <circle cx="${width/2}" cy="${height/2}" r="250" fill="none" stroke="#FF6B6B" stroke-width="1" opacity="0.1"/>
            <text x="${width/2}" y="200" fill="#FF6B6B" font-family="Arial, sans-serif" font-size="80" text-anchor="middle">💪🔥🏋️‍♀️</text>
            <text x="${width/2}" y="${height/2 - 150}" fill="white" font-family="Arial, sans-serif" font-size="64" font-weight="bold" text-anchor="middle">${this.escapeXml(scriptData.hook || 'Fitness Tip')}</text>
            <text x="${width/2}" y="${height/2 + 50}" fill="#cccccc" font-family="Arial, sans-serif" font-size="36" text-anchor="middle">${this.escapeXml((scriptData.body || '').substring(0, 150))}</text>
            <text x="${width/2}" y="${height/2 + 400}" fill="#FF6B6B" font-family="Arial, sans-serif" font-size="52" font-weight="bold" text-anchor="middle">${this.escapeXml(scriptData.cta || 'Save for later!')}</text>
            <text x="${width/2}" y="${height - 80}" fill="#666666" font-family="Arial, sans-serif" font-size="32" text-anchor="middle">${this.escapeXml((scriptData.hashtags || []).slice(0, 5).join(' '))}</text>
        </svg>`;
        
        await sharp(Buffer.from(svg)).png().toFile(imagePath);
        console.log(`✅ Static image created: ${imagePath}`);
        return imagePath;
    }

    async combineFramesToVideo(frames, outputPath, fps = 30) {
        const listPath = path.join(this.videosDir, 'frames.txt');
        const listContent = frames.map(f => `file '${f}'`).join('\n');
        fs.writeFileSync(listPath, listContent);
        
        try {
            await execPromise(`ffmpeg -y -f concat -safe 0 -i ${listPath} -c:v libx264 -pix_fmt yuv420p -r ${fps} ${outputPath} 2>/dev/null`);
        } finally {
            try { fs.unlinkSync(listPath); } catch(e) {}
        }
    }

    escapeXml(str) {
        if (!str) return '';
        return str
            .replace(/[&<>]/g, function(m) {
                if (m === '&') return '&amp;';
                if (m === '<') return '&lt;';
                if (m === '>') return '&gt;';
                return m;
            })
            .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '');
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ============================================
    // MAIN GENERATION METHOD
    // ============================================
    
    async generateVideo(scriptData) {
        console.log(`\n🎬 Generating video using Gemini API`);
        console.log(`   Topic: ${(scriptData.topic || 'fitness').substring(0, 50)}...`);
        
        // Create a fitness-specific prompt optimized for Veo 3.1 [citation:1][citation:2]
        const prompt = `${scriptData.topic || 'fitness workout'}. ${scriptData.hook || 'workout tip'} for athletic women. Professional fitness demonstration in modern gym with proper form.`;
        
        // Try Gemini first if API key is available
        if (this.geminiApiKey) {
            try {
                const result = await this.generateWithGemini(prompt);
                return result;
            } catch (error) {
                console.log(`⚠️ Gemini generation failed: ${error.message}`);
                console.log(`   Falling back to animated video...`);
            }
        } else {
            console.log(`⚠️ GEMINI_API_KEY not set, using animated fallback`);
            console.log(`   Get a free API key at: https://aistudio.google.com/`);
        }
        
        // Fallback to animated video
        return await this.generateAnimatedVideo(scriptData);
    }
}

module.exports = { VideoGenerator };

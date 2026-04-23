// videoGenerator.js
// Supports: Replicate.com (recommended), Hugging Face (fallback), Animated (last resort)

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class VideoGenerator {
    constructor() {
        this.provider = process.env.VIDEO_PROVIDER || 'replicate';
        this.replicateToken = process.env.REPLICATE_API_TOKEN;
        this.huggingfaceToken = process.env.HUGGINGFACE_API_TOKEN;
        this.videosDir = path.join(__dirname, 'videos');
        
        if (!fs.existsSync(this.videosDir)) {
            fs.mkdirSync(this.videosDir, { recursive: true });
        }
        
        console.log(`🎬 VideoGenerator initialized`);
        console.log(`   Provider: ${this.provider}`);
        console.log(`   Replicate token: ${this.replicateToken ? '✅ Configured' : '❌ Missing'}`);
        console.log(`   Hugging Face token: ${this.huggingfaceToken ? '✅ Configured' : '❌ Missing'}`);
    }

    // ============================================
    // OPTION 1: Replicate.com (RECOMMENDED)
    // ============================================
    
    async generateWithReplicate(prompt, durationSeconds = 5) {
        if (!this.replicateToken) {
            throw new Error('REPLICATE_API_TOKEN not set. Get one from https://replicate.com');
        }

        console.log('🎥 Calling Replicate API for video generation...');
        
        // Use Zeroscope v2 XL - good quality, fast, reliable
        // Model: anotherjesse/zeroscope-v2-xl
        const modelVersion = 'anotherjesse/zeroscope-v2-xl:9f747673945c62801b13b84701c783929c0ee784e4748ec062204894dda1a351';
        
        // Enhance prompt for fitness content
        const enhancedPrompt = `cinematic shot, ${prompt}, fitness workout, athletic woman in modern gym, professional lighting, high quality, 4k, smooth motion, realistic, detailed muscles, workout clothes`;
        
        const negativePrompt = "blurry, ugly, distorted, deformed, low quality, bad anatomy, bad proportions, extra limbs, disfigured, gross proportions, malformed limbs, missing arms, missing legs, extra arms, extra legs, cloned face, mutated, mutated hands, poorly drawn hands, poorly drawn face, mutation, deformed, bad anatomy, bad proportions, cloned face, disfigured, gross proportions, malformed limbs, missing arms, missing legs, extra arms, extra legs, fused fingers, too many fingers, long neck";
        
        try {
            // Start prediction
            const startResponse = await axios.post(
                'https://api.replicate.com/v1/predictions',
                {
                    version: modelVersion,
                    input: {
                        prompt: enhancedPrompt,
                        negative_prompt: negativePrompt,
                        width: 576,
                        height: 320,
                        num_frames: Math.min(durationSeconds * 8, 48),
                        fps: 8,
                        guidance_scale: 9,
                        num_inference_steps: 25
                    }
                },
                {
                    headers: {
                        'Authorization': `Token ${this.replicateToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const predictionId = startResponse.data.id;
            console.log(`   Prediction ID: ${predictionId}`);
            
            // Poll for completion (up to 90 seconds)
            let videoUrl = null;
            let attempts = 0;
            const maxAttempts = 45; // 45 * 2 seconds = 90 seconds
            
            while (attempts < maxAttempts) {
                await this.sleep(2000);
                attempts++;
                
                const statusResponse = await axios.get(
                    `https://api.replicate.com/v1/predictions/${predictionId}`,
                    {
                        headers: { 'Authorization': `Token ${this.replicateToken}` }
                    }
                );
                
                const status = statusResponse.data.status;
                console.log(`   Status: ${status} (attempt ${attempts}/${maxAttempts})`);
                
                if (status === 'succeeded') {
                    videoUrl = statusResponse.data.output;
                    break;
                } else if (status === 'failed') {
                    throw new Error(`Replicate generation failed: ${JSON.stringify(statusResponse.data.error)}`);
                }
            }
            
            if (!videoUrl) {
                throw new Error('Video generation timeout after 90 seconds');
            }
            
            // Handle different output formats
            let videoFileUrl = videoUrl;
            if (typeof videoUrl === 'object' && videoUrl.video) {
                videoFileUrl = videoUrl.video;
            } else if (Array.isArray(videoUrl)) {
                videoFileUrl = videoUrl[0];
            }
            
            console.log(`   Downloading video from: ${videoFileUrl.substring(0, 80)}...`);
            
            // Download video
            const videoPath = path.join(this.videosDir, `replicate_${Date.now()}.mp4`);
            const videoResponse = await axios({
                method: 'get',
                url: videoFileUrl,
                responseType: 'stream'
            });
            
            const writer = fs.createWriteStream(videoPath);
            videoResponse.data.pipe(writer);
            
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            
            const fileSize = (fs.statSync(videoPath).size / 1024 / 1024).toFixed(2);
            console.log(`✅ Replicate video saved: ${videoPath} (${fileSize} MB)`);
            
            return videoPath;
            
        } catch (error) {
            console.error('Replicate API error:', error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response data:', JSON.stringify(error.response.data));
            }
            throw error;
        }
    }

    // ============================================
    // OPTION 2: Hugging Face (Fallback)
    // ============================================
    
    async generateWithHuggingFace(prompt, durationSeconds = 5) {
        if (!this.huggingfaceToken) {
            throw new Error('HUGGINGFACE_API_TOKEN not set');
        }

        console.log('🎥 Calling Hugging Face API for video generation...');
        
        // Use a confirmed working model (Text-to-Video)
        // Model: ali-vilab/text-to-video-ms-1-7b
        const apiUrl = 'https://api-inference.huggingface.co/models/ali-vilab/text-to-video-ms-1-7b';
        
        const enhancedPrompt = `fitness workout, ${prompt}, athletic woman in gym, professional lighting, high quality`;
        
        try {
            const response = await axios.post(
                apiUrl,
                {
                    inputs: enhancedPrompt,
                    parameters: {
                        num_frames: Math.min(durationSeconds * 8, 48),
                        fps: 8
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.huggingfaceToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 120000, // 2 minutes
                    responseType: 'arraybuffer'
                }
            );
            
            const videoPath = path.join(this.videosDir, `huggingface_${Date.now()}.mp4`);
            fs.writeFileSync(videoPath, response.data);
            
            const fileSize = (fs.statSync(videoPath).size / 1024 / 1024).toFixed(2);
            console.log(`✅ Hugging Face video saved: ${videoPath} (${fileSize} MB)`);
            
            return videoPath;
            
        } catch (error) {
            console.error('Hugging Face API error:', error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
            }
            throw error;
        }
    }

    // ============================================
    // OPTION 3: Animated Video (Always works)
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
            
            // Log progress every 30 frames
            if ((i + 1) % 30 === 0) {
                console.log(`   Frames: ${i + 1}/${totalFrames}`);
            }
        }
        
        // Try to use ffmpeg to combine frames
        try {
            await this.combineFramesToVideo(frames, videoPath, 30);
            // Clean up frames
            frames.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
            console.log(`✅ Animated video created: ${videoPath}`);
            return videoPath;
        } catch (error) {
            console.log('FFmpeg not available, returning first frame as image');
            // Clean up extra frames, keep first
            frames.slice(1).forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
            return frames[0];
        }
    }

    async createAnimatedFrame(scriptData, frameIndex, totalFrames) {
        const sharp = require('sharp');
        const width = 1080;
        const height = 1920;
        
        // Progress through frame (0 to 1)
        const progress = frameIndex / totalFrames;
        
        // Create gradient background that shifts
        const hue = 220 + (progress * 20);
        const gradientStart = `hsl(${hue}, 70%, 8%)`;
        const gradientEnd = `hsl(${hue + 10}, 70%, 12%)`;
        
        // Animation effects
        const slideOffset = Math.sin(progress * Math.PI * 2) * 15;
        const pulseScale = 1 + Math.sin(progress * Math.PI * 4) * 0.05;
        const fadeIn = Math.min(1, progress * 2);
        
        // Visibility (fade in first 20% of frames)
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
            
            <!-- Animated circles -->
            <circle cx="${width/2}" cy="${height/2}" r="${300 + slideOffset}" fill="none" stroke="rgba(255,107,107,0.08)" stroke-width="2"/>
            <circle cx="${width/2}" cy="${height/2}" r="${200 + slideOffset/2}" fill="none" stroke="rgba(255,107,107,0.05)" stroke-width="1"/>
            
            <!-- Hook text (main attention grabber) -->
            <g opacity="${fadeIn}">
                <text x="${width/2}" y="${height/2 - 200 + slideOffset/2}" fill="white" font-family="Arial, sans-serif" font-size="${60 * pulseScale}" font-weight="bold" text-anchor="middle" filter="url(#glow)">
                    ${this.escapeXml(scriptData.hook || 'Fitness Tip')}
                </text>
            </g>
            
            <!-- Body text -->
            <g opacity="${Math.min(1, progress * 3)}">
                <text x="${width/2}" y="${height/2 - 30 + slideOffset}" fill="#cccccc" font-family="Arial, sans-serif" font-size="36" text-anchor="middle">
                    ${this.escapeXml((scriptData.body || '').substring(0, 150))}
                </text>
            </g>
            
            <!-- CTA with pulse -->
            <g opacity="${isVisible}">
                <text x="${width/2}" y="${height/2 + 420 + (frameIndex % 30 === 0 ? 10 : 0)}" fill="#FF6B6B" font-family="Arial, sans-serif" font-size="${48 * pulseScale}" font-weight="bold" text-anchor="middle">
                    ${this.escapeXml(scriptData.cta || 'Save this!')}
                </text>
            </g>
            
            <!-- Hashtags at bottom -->
            <text x="${width/2}" y="${height - 80}" fill="#666666" font-family="Arial, sans-serif" font-size="32" text-anchor="middle">
                ${this.escapeXml((scriptData.hashtags || []).slice(0, 5).join(' '))}
            </text>
            
            <!-- Fitness icon / decorative element -->
            <text x="50" y="100" fill="#FF6B6B" font-family="Arial, sans-serif" font-size="40" opacity="0.3">
                💪
            </text>
        </svg>`;
        
        const framePath = path.join(this.videosDir, `frame_${Date.now()}_${frameIndex.toString().padStart(4, '0')}.png`);
        await sharp(Buffer.from(svg))
            .png()
            .toFile(framePath);
        
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
            
            <!-- Decorative circles -->
            <circle cx="${width/2}" cy="${height/2}" r="350" fill="none" stroke="#FF6B6B" stroke-width="2" opacity="0.15"/>
            <circle cx="${width/2}" cy="${height/2}" r="250" fill="none" stroke="#FF6B6B" stroke-width="1" opacity="0.1"/>
            
            <!-- Emoji header -->
            <text x="${width/2}" y="200" fill="#FF6B6B" font-family="Arial, sans-serif" font-size="80" text-anchor="middle">
                💪🔥🏋️‍♀️
            </text>
            
            <!-- Hook -->
            <text x="${width/2}" y="${height/2 - 150}" fill="white" font-family="Arial, sans-serif" font-size="64" font-weight="bold" text-anchor="middle">
                ${this.escapeXml(scriptData.hook || 'Fitness Tip')}
            </text>
            
            <!-- Body -->
            <text x="${width/2}" y="${height/2 + 50}" fill="#cccccc" font-family="Arial, sans-serif" font-size="36" text-anchor="middle">
                ${this.escapeXml((scriptData.body || '').substring(0, 150))}
            </text>
            
            <!-- CTA -->
            <text x="${width/2}" y="${height/2 + 400}" fill="#FF6B6B" font-family="Arial, sans-serif" font-size="52" font-weight="bold" text-anchor="middle">
                ${this.escapeXml(scriptData.cta || 'Save for later!')}
            </text>
            
            <!-- Hashtags -->
            <text x="${width/2}" y="${height - 80}" fill="#666666" font-family="Arial, sans-serif" font-size="32" text-anchor="middle">
                ${this.escapeXml((scriptData.hashtags || []).slice(0, 5).join(' '))}
            </text>
        </svg>`;
        
        await sharp(Buffer.from(svg))
            .png()
            .toFile(imagePath);
        
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
        console.log(`\n🎬 Generating video using provider: ${this.provider}`);
        console.log(`   Topic: ${(scriptData.topic || 'fitness').substring(0, 50)}...`);
        
        // Create a fitness-specific prompt
        const prompt = `${scriptData.topic || 'fitness workout'}. ${scriptData.hook || 'workout tip'} for athletic women. Proper form demonstration in modern gym.`;
        
        // Try providers in priority order
        const providers = [];
        
        if (this.provider === 'replicate' && this.replicateToken) {
            providers.push(() => this.generateWithReplicate(prompt));
        }
        
        if (this.provider === 'huggingface' && this.huggingfaceToken) {
            providers.push(() => this.generateWithHuggingFace(prompt));
        }
        
        // Always add animated as final fallback
        providers.push(() => this.generateAnimatedVideo(scriptData));
        
        // Try each provider until one succeeds
        for (let i = 0; i < providers.length; i++) {
            try {
                console.log(`   Attempt ${i + 1}/${providers.length}...`);
                const result = await providers[i]();
                return result;
            } catch (error) {
                console.log(`   Attempt ${i + 1} failed: ${error.message}`);
                if (i === providers.length - 1) {
                    // Last attempt failed
                    console.log('⚠️ All video generation methods failed, creating static image...');
                    return await this.generateStaticTextImage(scriptData);
                }
                // Wait before next attempt
                await this.sleep(2000);
            }
        }
        
        // Ultimate fallback
        return await this.generateStaticTextImage(scriptData);
    }
}

module.exports = { VideoGenerator };

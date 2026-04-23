// videoGenerator.js
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
        
        console.log(`🎬 VideoGenerator initialized with provider: ${this.provider}`);
    }

    /**
     * Generate video using Hugging Face Inference API (Free tier)
     */
    async generateWithHuggingFace(prompt, durationSeconds = 5) {
        if (!this.huggingfaceToken) {
            throw new Error('HUGGINGFACE_API_TOKEN not set');
        }

        console.log('🎥 Calling Hugging Face API for video generation...');
        
        // Use Modelscope text-to-video model
        const apiUrl = 'https://api-inference.huggingface.co/models/damo-vilab/modelscope-damo-text-to-video-synthesis';
        
        // Enhance prompt for fitness content
        const enhancedPrompt = `${prompt}, fitness workout, athletic woman in gym, professional lighting, high quality, 4k, smooth motion`;
        
        try {
            const response = await axios.post(
                apiUrl,
                {
                    inputs: enhancedPrompt,
                    parameters: {
                        num_frames: Math.min(durationSeconds * 8, 48), // Max 48 frames
                        fps: 8
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.huggingfaceToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 120000, // 2 minute timeout
                    responseType: 'arraybuffer'
                }
            );
            
            const videoPath = path.join(this.videosDir, `video_${Date.now()}.mp4`);
            fs.writeFileSync(videoPath, response.data);
            console.log(`✅ Hugging Face video saved to: ${videoPath}`);
            
            return videoPath;
        } catch (error) {
            console.error('Hugging Face API error:', error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
            }
            throw error;
        }
    }

    /**
     * Generate animated video as fallback (always works, no API needed)
     */
    async generateAnimatedVideo(scriptData) {
        console.log('🎨 Generating animated video (fallback mode)...');
        const sharp = require('sharp');
        const videoPath = path.join(this.videosDir, `animated_${Date.now()}.mp4`);
        
        // Create multiple frames with slight variations for animation effect
        const frames = [];
        const numFrames = 30; // 1 second at 30fps
        
        for (let i = 0; i < numFrames; i++) {
            const framePath = await this.createAnimatedFrame(scriptData, i, numFrames);
            frames.push(framePath);
        }
        
        // Try to use ffmpeg, fallback to image if not available
        try {
            await this.combineFramesToVideo(frames, videoPath, 30);
            // Clean up frames
            frames.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
            console.log(`✅ Animated video created: ${videoPath}`);
            return videoPath;
        } catch (error) {
            console.log('FFmpeg not available, returning first frame as image');
            // Clean up extra frames
            frames.slice(1).forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
            return frames[0]; // Return first frame as static image
        }
    }

    async createAnimatedFrame(scriptData, frameIndex, totalFrames) {
        const sharp = require('sharp');
        const width = 1080;
        const height = 1920;
        
        // Create gradient background that shifts slightly each frame
        const hue = (frameIndex / totalFrames) * 20; // Subtle hue shift
        const gradientStart = `hsl(${220 + hue}, 70%, 10%)`;
        const gradientEnd = `hsl(${240 + hue}, 70%, 15%)`;
        
        // Animation: text sliding or pulsing
        const slideOffset = Math.sin((frameIndex / totalFrames) * Math.PI * 2) * 10;
        
        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="${gradientStart}" />
                    <stop offset="100%" stop-color="${gradientEnd}" />
                </linearGradient>
            </defs>
            <rect width="100%" height="100%" fill="url(#grad)"/>
            
            <!-- Animated glow effect -->
            <circle cx="${width/2}" cy="${height/2}" r="${300 + slideOffset}" fill="none" stroke="rgba(255,107,107,0.1)" stroke-width="2"/>
            <circle cx="${width/2}" cy="${height/2}" r="${200 + slideOffset/2}" fill="none" stroke="rgba(255,107,107,0.05)" stroke-width="1"/>
            
            <!-- Hook text -->
            <text x="${width/2}" y="${height/2 - 200 + slideOffset/2}" fill="white" font-family="Arial, sans-serif" font-size="64" font-weight="bold" text-anchor="middle">
                ${this.escapeXml(scriptData.hook || 'Fitness Tip')}
            </text>
            
            <!-- Body text -->
            <text x="${width/2}" y="${height/2 - 50 + slideOffset}" fill="#cccccc" font-family="Arial, sans-serif" font-size="36" text-anchor="middle">
                ${this.escapeXml((scriptData.body || '').substring(0, 150))}
            </text>
            
            <!-- CTA with pulse animation -->
            <text x="${width/2}" y="${height/2 + 400 + (frameIndex % 20 === 0 ? 5 : 0)}" fill="#FF6B6B" font-family="Arial, sans-serif" font-size="48" font-weight="bold" text-anchor="middle">
                ${this.escapeXml(scriptData.cta || 'Save this!')}
            </text>
            
            <!-- Hashtags -->
            <text x="${width/2}" y="${height - 100}" fill="#888888" font-family="Arial, sans-serif" font-size="32" text-anchor="middle">
                ${this.escapeXml((scriptData.hashtags || []).slice(0, 5).join(' '))}
            </text>
        </svg>`;
        
        const framePath = path.join(this.videosDir, `frame_${Date.now()}_${frameIndex}.png`);
        await sharp(Buffer.from(svg))
            .png()
            .toFile(framePath);
        
        return framePath;
    }

    async combineFramesToVideo(frames, outputPath, fps = 30) {
        // Create a temporary file list for ffmpeg
        const listPath = path.join(this.videosDir, 'frames.txt');
        const listContent = frames.map(f => `file '${f}'`).join('\n');
        fs.writeFileSync(listPath, listContent);
        
        await execPromise(`ffmpeg -y -f concat -safe 0 -i ${listPath} -c:v libx264 -pix_fmt yuv420p -r ${fps} ${outputPath} 2>/dev/null`);
        fs.unlinkSync(listPath);
    }

    escapeXml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Main video generation method
     */
    async generateVideo(scriptData) {
        console.log(`🎬 Generating video using ${this.provider}...`);
        
        // Create a fitness-specific prompt
        const prompt = `${scriptData.topic || 'fitness workout'}. ${scriptData.hook || 'workout tip'}. Athletic woman demonstrating proper form in a modern gym.`;
        
        try {
            if (this.provider === 'huggingface' && this.huggingfaceToken) {
                return await this.generateWithHuggingFace(prompt, parseInt(process.env.VIDEO_DURATION) || 5);
            } else {
                console.log('No AI video API configured or Replicate not implemented, using animated fallback');
                return await this.generateAnimatedVideo(scriptData);
            }
        } catch (error) {
            console.error('AI video generation failed:', error.message);
            console.log('Falling back to animated video...');
            return await this.generateAnimatedVideo(scriptData);
        }
    }
}

module.exports = { VideoGenerator };

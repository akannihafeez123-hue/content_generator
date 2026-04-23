const axios = require('axios');
const FormData = require('form-data');
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
    }

    /**
     * Generate video using Replicate.com API (Free tier available)
     * Models: stability-ai/stable-video-diffusion, lucataco/animate-diff, zeroscope
     */
    async generateWithReplicate(prompt, durationSeconds = 5) {
        if (!this.replicateToken) {
            throw new Error('REPLICATE_API_TOKEN not set');
        }

        // Use Zeroscope for text-to-video (good for fitness content)
        const model = 'anotherjesse/zeroscope-v2-xl:9f747673945c62801b13b84701c783929c0ee784e4748ec062204894dda1a351';
        
        const response = await axios.post(
            'https://api.replicate.com/v1/predictions',
            {
                version: model,
                input: {
                    prompt: `${prompt}, fitness workout, athletic woman, gym background, high quality, 4k`,
                    num_frames: durationSeconds * 8, // ~8fps
                    fps: 8,
                    guidance_scale: 9,
                    negative_prompt: "blurry, ugly, distorted, deformed, low quality"
                }
            },
            {
                headers: {
                    'Authorization': `Token ${this.replicateToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const predictionId = response.data.id;
        
        // Poll for completion
        let videoUrl = null;
        for (let i = 0; i < 60; i++) { // Wait up to 2 minutes
            await this.sleep(2000);
            
            const statusResponse = await axios.get(
                `https://api.replicate.com/v1/predictions/${predictionId}`,
                {
                    headers: { 'Authorization': `Token ${this.replicateToken}` }
                }
            );
            
            if (statusResponse.data.status === 'succeeded') {
                videoUrl = statusResponse.data.output;
                break;
            } else if (statusResponse.data.status === 'failed') {
                throw new Error('Video generation failed');
            }
        }
        
        if (!videoUrl) throw new Error('Video generation timeout');
        
        // Download video
        const videoPath = path.join(this.videosDir, `video_${Date.now()}.mp4`);
        const videoResponse = await axios({
            method: 'get',
            url: typeof videoUrl === 'string' ? videoUrl : videoUrl[0],
            responseType: 'stream'
        });
        
        const writer = fs.createWriteStream(videoPath);
        videoResponse.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        
        return videoPath;
    }

    /**
     * Generate video using Hugging Face Inference API (Free tier)
     */
    async generateWithHuggingFace(prompt, durationSeconds = 5) {
        if (!this.huggingfaceToken) {
            throw new Error('HUGGINGFACE_API_TOKEN not set');
        }

        // Use Modelscope text-to-video model
        const apiUrl = 'https://api-inference.huggingface.co/models/damo-vilab/modelscope-damo-text-to-video-synthesis';
        
        const response = await axios.post(
            apiUrl,
            {
                inputs: `${prompt}, fitness athlete, gym workout, athletic body, professional lighting`,
                parameters: {
                    num_frames: durationSeconds * 8,
                    fps: 8
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.huggingfaceToken}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer'
            }
        );
        
        const videoPath = path.join(this.videosDir, `video_${Date.now()}.mp4`);
        fs.writeFileSync(videoPath, response.data);
        
        return videoPath;
    }

    /**
     * Generate a simple animated video using Canvas/Sharp (Fallback - better than static)
     */
    async generateAnimatedVideo(scriptData) {
        const videoPath = path.join(this.videosDir, `animated_${Date.now()}.mp4`);
        
        // Create multiple frames with slight variations for animation effect
        const frames = [];
        const numFrames = 30; // 1 second at 30fps
        
        for (let i = 0; i < numFrames; i++) {
            const framePath = await this.createAnimatedFrame(scriptData, i, numFrames);
            frames.push(framePath);
        }
        
        // Use ffmpeg to combine frames into video if available
        try {
            await this.combineFramesToVideo(frames, videoPath, 30);
        } catch (error) {
            console.log('FFmpeg not available, returning first frame as image');
            return frames[0];
        }
        
        // Clean up frames
        frames.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
        
        return videoPath;
    }

    async createAnimatedFrame(scriptData, frameIndex, totalFrames) {
        const sharp = require('sharp');
        const width = 1080;
        const height = 1920;
        
        // Create gradient background that shifts slightly each frame
        const hue = (frameIndex / totalFrames) * 20; // Subtle hue shift
        const gradientStart = `hsl(${220 + hue}, 70%, 10%)`;
        const gradientEnd = `hsl(${240 + hue}, 70%, 15%)`;
        
        // Animation: text sliding up or pulsing
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
            <text x="${width/2}" y="${height/2 - 200 + slideOffset/2}" fill="white" font-family="Arial, sans-serif" font-size="64" font-weight="bold" text-anchor="middle" textLength="900">
                ${this.escapeXml(scriptData.hook)}
            </text>
            
            <!-- Body text -->
            <text x="${width/2}" y="${height/2 - 50 + slideOffset}" fill="#cccccc" font-family="Arial, sans-serif" font-size="36" text-anchor="middle" textLength="900">
                ${this.escapeXml(scriptData.body.substring(0, 150))}
            </text>
            
            <!-- CTA with pulse animation -->
            <text x="${width/2}" y="${height/2 + 400 + (frameIndex % 20 === 0 ? 5 : 0)}" fill="#FF6B6B" font-family="Arial, sans-serif" font-size="48" font-weight="bold" text-anchor="middle">
                ${this.escapeXml(scriptData.cta)}
            </text>
            
            <!-- Hashtags -->
            <text x="${width/2}" y="${height - 100}" fill="#888888" font-family="Arial, sans-serif" font-size="32" text-anchor="middle">
                ${this.escapeXml(scriptData.hashtags.slice(0, 5).join(' '))}
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
        
        await execPromise(`ffmpeg -y -f concat -safe 0 -i ${listPath} -c:v libx264 -pix_fmt yuv420p -r ${fps} ${outputPath}`);
        fs.unlinkSync(listPath);
    }

    escapeXml(str) {
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
        const prompt = `${scriptData.topic}. ${scriptData.hook}. Athletic woman demonstrating proper form in a modern gym. Professional lighting, high quality.`;
        
        try {
            if (this.provider === 'replicate' && this.replicateToken) {
                return await this.generateWithReplicate(prompt, parseInt(process.env.VIDEO_DURATION) || 5);
            } else if (this.provider === 'huggingface' && this.huggingfaceToken) {
                return await this.generateWithHuggingFace(prompt, parseInt(process.env.VIDEO_DURATION) || 5);
            } else {
                console.log('No AI video API configured, using animated fallback');
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

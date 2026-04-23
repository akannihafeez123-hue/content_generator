const fs = require('fs');
const path = require('path');
const natural = require('natural');
const ss = require('simple-statistics');

class LearningEngine {
    constructor() {
        this.model = null;
        this.lastRetrain = null;
        this.featureWeights = {
            hour: 0.1,
            dayOfWeek: 0.05,
            hookLength: 0.15,
            hashtagCount: 0.1,
            hasExclamation: 0.2,
            hasQuestion: 0.15,
            hasNumbers: 0.1,
            topicTrending: 0.15
        };
        this.modelPath = path.join(__dirname, 'model_weights.json');
    }
    
    async loadModel() {
        try {
            if (fs.existsSync(this.modelPath)) {
                const data = fs.readFileSync(this.modelPath, 'utf8');
                this.model = JSON.parse(data);
                this.lastRetrain = new Date(this.model.lastRetrain);
                console.log('✅ Loaded existing ML model');
            } else {
                this.model = {
                    weights: { ...this.featureWeights },
                    lastRetrain: new Date().toISOString(),
                    trainingSamples: 0
                };
                console.log('✅ Created new ML model');
            }
        } catch (error) {
            console.error('Failed to load model:', error.message);
            this.model = {
                weights: { ...this.featureWeights },
                lastRetrain: new Date().toISOString(),
                trainingSamples: 0
            };
        }
    }
    
    saveModel() {
        try {
            fs.writeFileSync(this.modelPath, JSON.stringify(this.model, null, 2));
            console.log('💾 Model saved');
        } catch (error) {
            console.error('Failed to save model:', error.message);
        }
    }
    
    extractFeatures(postData) {
        const hour = new Date(postData.timestamp).getHours();
        const dayOfWeek = new Date(postData.timestamp).getDay();
        
        return {
            hour: hour / 23, // Normalize 0-1
            dayOfWeek: dayOfWeek / 6,
            hookLength: Math.min(1, (postData.hook?.length || 0) / 100),
            hashtagCount: Math.min(1, (postData.hashtags?.length || 0) / 10),
            hasExclamation: (postData.hook?.includes('!') || postData.hook?.includes('🔥')) ? 1 : 0,
            hasQuestion: postData.hook?.includes('?') ? 1 : 0,
            hasNumbers: /\d/.test(postData.hook || '') ? 1 : 0,
            topicTrending: this.calculateTrendingScore(postData.topic || '')
        };
    }
    
    calculateTrendingScore(topic) {
        const trendingKeywords = ['fast', 'easy', 'best', 'mistake', 'secret', 'how to', 'stop', 'never'];
        const lowerTopic = topic.toLowerCase();
        let score = 0;
        for (const kw of trendingKeywords) {
            if (lowerTopic.includes(kw)) score += 0.15;
        }
        return Math.min(1, score);
    }
    
    predictEngagement(postData) {
        const features = this.extractFeatures(postData);
        let score = 0;
        
        for (const [key, value] of Object.entries(features)) {
            const weight = this.model.weights[key] || this.featureWeights[key] || 0.1;
            score += value * weight;
        }
        
        // Add small random noise for exploration
        score += (Math.random() - 0.5) * 0.1;
        
        return Math.max(0, Math.min(1, score));
    }
    
    async train(trainingData) {
        if (trainingData.length < 10) {
            console.log(`Need at least 10 samples, have ${trainingData.length}`);
            return;
        }
        
        console.log(`🧠 Training model on ${trainingData.length} samples...`);
        
        // Simple weight adjustment based on correlation
        const featureCorrelations = {
            hour: [],
            dayOfWeek: [],
            hookLength: [],
            hashtagCount: [],
            hasExclamation: [],
            hasQuestion: [],
            hasNumbers: [],
            topicTrending: []
        };
        
        for (const post of trainingData) {
            const features = this.extractFeatures(post);
            const engagement = post.engagement_score || 0.5;
            
            for (const [key, value] of Object.entries(features)) {
                if (featureCorrelations[key]) {
                    featureCorrelations[key].push([value, engagement]);
                }
            }
        }
        
        // Update weights based on correlation
        for (const [key, pairs] of Object.entries(featureCorrelations)) {
            if (pairs.length > 5) {
                const x = pairs.map(p => p[0]);
                const y = pairs.map(p => p[1]);
                const correlation = ss.sampleCorrelation(x, y);
                // Adjust weight: higher correlation = higher weight
                let newWeight = 0.1 + (Math.abs(correlation) * 0.3);
                newWeight = Math.min(0.4, Math.max(0.05, newWeight));
                this.model.weights[key] = newWeight;
            }
        }
        
        // Normalize weights to sum to 1
        const totalWeight = Object.values(this.model.weights).reduce((a, b) => a + b, 0);
        for (const key of Object.keys(this.model.weights)) {
            this.model.weights[key] /= totalWeight;
        }
        
        this.model.trainingSamples = trainingData.length;
        this.model.lastRetrain = new Date().toISOString();
        this.lastRetrain = new Date();
        
        this.saveModel();
        console.log('✅ Model trained successfully');
        console.log('📊 New weights:', this.model.weights);
    }
    
    async shouldRetrain() {
        if (!this.lastRetrain) return true;
        const hoursSinceRetrain = (new Date() - this.lastRetrain) / (1000 * 60 * 60);
        const retrainHours = parseInt(process.env.RETRAIN_HOURS) || 24;
        return hoursSinceRetrain >= retrainHours;
    }
}

module.exports = { LearningEngine };

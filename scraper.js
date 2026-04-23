const axios = require('axios');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const parser = new Parser();

const RSS_FEEDS = [
    'https://www.bodybuilding.com/rss/articles',
    'https://www.menshealth.com/fitness/feed/rss',
    'https://www.womenshealthmag.com/fitness/feed/rss',
    'https://www.self.com/fitness/feed/rss',
    'https://greatist.com/fitness/feed',
    'https://www.shape.com/fitness/feed'
];

async function scrapeTrending(limit = 10) {
    const trends = [];
    
    for (const feedUrl of RSS_FEEDS) {
        try {
            const feed = await parser.parseURL(feedUrl);
            for (const item of feed.items.slice(0, 3)) {
                trends.push({
                    topic: item.title,
                    summary: (item.contentSnippet || item.summary || '').substring(0, 300),
                    source: new URL(feedUrl).hostname,
                    url: item.link,
                    timestamp: new Date().toISOString()
                });
            }
            // Be polite - delay between requests
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            console.warn(`Failed to scrape ${feedUrl}:`, error.message);
        }
    }
    
    // Remove duplicates
    const seen = new Set();
    const unique = [];
    for (const trend of trends) {
        const key = trend.topic.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(trend);
        }
    }
    
    return unique.slice(0, limit);
}

function getFallbackTrends() {
    const fallbacks = [
        { topic: 'Proper squat form for glute growth', source: 'fallback' },
        { topic: 'Best pre-workout meal before leg day', source: 'fallback' },
        { topic: 'How to increase pull-up reps', source: 'fallback' },
        { topic: 'Deadlift mistakes ruining your back', source: 'fallback' },
        { topic: 'Quick ab workout for visible core', source: 'fallback' },
        { topic: 'Best cardio for fat loss without losing muscle', source: 'fallback' },
        { topic: 'Shoulder mobility exercises for overhead press', source: 'fallback' },
        { topic: 'Recovery tips after intense leg day', source: 'fallback' }
    ];
    return fallbacks.slice(0, 5);
}

function getTrendingHashtags() {
    const baseHashtags = ['#fitness', '#gym', '#workout', '#fitfam', '#training'];
    
    const day = new Date().toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
    const dayHashtags = {
        monday: ['#motivationmonday', '#mondayworkout'],
        tuesday: ['#tuesdaytraining', '#legdaytuesday'],
        wednesday: ['#wellnesswednesday', '#wednesdayworkout'],
        thursday: ['#thrivingthursday', '#thursdaytraining'],
        friday: ['#fitnessfriday', '#fridayflex'],
        saturday: ['#saturdaysquat', '#weekendworkout'],
        sunday: ['#sundaystretch', '#restday']
    };
    
    const trending = [...baseHashtags];
    if (dayHashtags[day]) trending.push(...dayHashtags[day]);
    
    // Seasonal hashtags
    const month = new Date().getMonth() + 1;
    if (month === 1 || month === 2) trending.push('#newyearnewme');
    if (month >= 5 && month <= 7) trending.push('#summerbody');
    
    return trending;
}

module.exports = {
    scrapeTrending,
    getFallbackTrends,
    getTrendingHashtags
};

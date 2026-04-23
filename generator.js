const { VideoGenerator } = require('./videoGenerator');
const { getTrendingHashtags } = require('./scraper');

let videoGenerator = null;

function initVideoGenerator() {
    videoGenerator = new VideoGenerator();
    return videoGenerator;
}

function extractExercise(topic) {
    const exercises = ['squat', 'deadlift', 'pull up', 'push up', 'lunge', 'curl', 'press', 'row', 'bench', 'crunch', 'plank'];
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
        `POV: You finally learned proper ${exercise} form`,
        `99% of people do ${exercise} WRONG`,
        `${exercise.toUpperCase()} secrets the pros won't tell you`
    ];
    
    const bodies = [
        `Most people don't realize that ${topic.toLowerCase()} is actually about form, not weight. Here's what the pros know...`,
        `Want faster results? Focus on ${keyword} instead of just going through the motions.`,
        `The secret to mastering ${topic.toLowerCase()} isn't what you think. It's all about mind-muscle connection.`,
        `Your ${exercise} is holding you back. Watch this to level up your form.`,
        `This one change doubled my ${keyword} gains. Here's exactly how.`
    ];
    
    const ctas = [
        'Save this for your next workout! 🔥',
        'Tag a friend who needs to see this 💪',
        'Follow for more fitness tips!',
        "Comment 'FORM' for a full tutorial!",
        'Send this to someone who needs to fix their form 📤',
        'Double tap if you needed this today ❤️'
    ];
    
    const hashtagsList = getTrendingHashtags();
    const nicheHashtags = ['#athleticbuild', '#gymgirl', '#fitcheck', '#workoutmotivation', '#formcheck', '#gymtok'];
    const selectedHashtags = [...hashtagsList, ...nicheHashtags].slice(0, 10);
    
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
        source: trend.source || 'trending',
        exercise: exercise,
        keyword: keyword
    };
}

async function createVideo(scriptData, videosDir) {
    if (!videoGenerator) {
        videoGenerator = new VideoGenerator();
    }
    
    return await videoGenerator.generateVideo(scriptData);
}

module.exports = {
    generateScript,
    createVideo,
    initVideoGenerator
};

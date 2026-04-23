
⏰ *Best posting time:* {self._get_best_posting_time()}

---
Tap ✅ to mark as posted, 👍/👎 to train the AI
"""
        
        try:
            with open(video_path, 'rb') as video:
                self.bot.send_video(
                    chat_id=self.chat_id,
                    video=video,
                    caption=caption,
                    parse_mode='Markdown',
                    reply_markup=reply_markup
                )
            return True
        except Exception as e:
            logging.error(f"Failed to send video: {e}")
            return False
    
    def _score_to_text(self, score: float) -> str:
        """Convert score to human-readable text"""
        if score > 0.8:
            return "🚀 VIRAL POTENTIAL - Post immediately!"
        elif score > 0.6:
            return "📈 Strong performer - This should do well"
        elif score > 0.4:
            return "👍 Solid content - Worth posting"
        else:
            return "⚠️ Low confidence - Consider regenerating"
    
    def _get_best_posting_time(self) -> str:
        """Calculate best posting time based on historical data"""
        conn = sqlite3.connect('influencer_bot.db')
        c = conn.cursor()
        
        c.execute("""
            SELECT strftime('%H', timestamp) as hour, AVG(engagement_score) as avg_score
            FROM posts
            WHERE engagement_score IS NOT NULL
            GROUP BY hour
            ORDER BY avg_score DESC
            LIMIT 1
        """)
        
        result = c.fetchone()
        conn.close()
        
        if result and result[1] > 0:
            return f"{int(result[0])}:00 (based on your data)"
        return "7:00 PM (default for fitness niche)"
    
    def handle_feedback(self, content_id: str, feedback_type: str):
        """Process user feedback to train the AI"""
        if content_id not in self.pending_content:
            return "Content not found"
        
        script_data = self.pending_content[content_id]
        
        # Map feedback to engagement score
        score_map = {
            'good': 0.9,
            'bad': 0.2,
            'post': 0.7  # Default for posted content
        }
        
        engagement_score = score_map.get(feedback_type, 0.5)
        
        # Store in database for training
        conn = sqlite3.connect('influencer_bot.db')
        c = conn.cursor()
        
        post_id = hashlib.md5(f"{time.time()}{content_id}".encode()).hexdigest()
        c.execute("""
            INSERT OR REPLACE INTO posts 
            (id, timestamp, topic, hook, hashtags, engagement_score)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            post_id,
            datetime.now().isoformat(),
            script_data['topic'],
            script_data['hook'],
            json.dumps(script_data['hashtags']),
            engagement_score
        ))
        
        conn.commit()
        conn.close()
        
        # Retrain model if needed
        if self.learning_engine.should_retrain():
            self._retrain_model()
        
        return f"✅ Feedback recorded! AI will learn from this."
    
    def _retrain_model(self):
        """Retrain ML model on all historical data"""
        conn = sqlite3.connect('influencer_bot.db')
        c = conn.cursor()
        
        c.execute("SELECT * FROM posts WHERE engagement_score IS NOT NULL")
        rows = c.fetchall()
        conn.close()
        
        if len(rows) >= 10:
            training_data = []
            for row in rows:
                training_data.append({
                    'timestamp': row[1],
                    'topic': row[2],
                    'hook': row[3],
                    'hashtags': json.loads(row[4]) if row[4] else [],
                    'engagement_score': row[5]
                })
            
            self.learning_engine.train(training_data)
            logging.info(f"Retrained on {len(training_data)} posts")

# ============================================
# MAIN AUTOMATION LOOP
# ============================================

class AIContentBot:
    """Main orchestrator - runs everything"""
    
    def __init__(self):
        self.trend_scraper = FitnessTrendScraper()
        self.content_gen = ContentGenerator()
        self.telegram_bot = InfluencerTelegramBot(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
        self.learning_engine = SelfLearningEngine()
        
        # Setup logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s'
        )
        
        # Initialize database
        init_database()
    
    def run_hourly(self):
        """Main function to run every hour"""
        logging.info("=" * 50)
        logging.info("Starting hourly content generation")
        logging.info("=" * 50)
        
        # Step 1: Get trending content
        logging.info("📊 Scraping trending fitness content...")
        trends = self.trend_scraper.scrape_trending(limit=CONTENT_PER_HOUR * 2)
        
        if not trends:
            logging.warning("No trends found, using fallback topics")
            trends = self._get_fallback_trends()
        
        # Step 2: Score each trend with ML model
        logging.info("🤖 Scoring trends with ML model...")
        scored_trends = []
        for trend in trends:
            # Create a dummy post for prediction
            dummy_script = self.content_gen.generate_script(trend)
            dummy_post = {
                'timestamp': datetime.now().isoformat(),
                'hook': dummy_script['hook'],
                'hashtags': dummy_script['hashtags'],
                'topic': trend['topic']
            }
            score = self.learning_engine.predict_engagement(dummy_post)
            scored_trends.append((score, trend, dummy_script))
        
        # Sort by predicted score
        scored_trends.sort(reverse=True, key=lambda x: x[0])
        
        # Step 3: Select best content (with exploration)
        selected = []
        for i in range(min(CONTENT_PER_HOUR, len(scored_trends))):
            if random.random() < EXPLORATION_RATE and i > 0:
                # Explore: pick a lower-ranked trend
                selected.append(scored_trends[-1])
                logging.info("🔍 EXPLORATION MODE - testing lower-ranked content")
            else:
                # Exploit: pick highest-ranked
                selected.append(scored_trends[i])
                logging.info(f"📈 EXPLOITATION MODE - predicted score: {scored_trends[i][0]:.2%}")
        
        # Step 4: Generate videos
        for score, trend, script in selected:
            logging.info(f"🎬 Generating video for: {trend['topic'][:50]}...")
            
            # Generate script (refine for this specific trend)
            final_script = self.content_gen.generate_script(trend)
            
            # Create video
            video_path = self.content_gen.create_video(final_script)
            
            if video_path and os.path.exists(video_path):
                # Send to Telegram
                success = self.telegram_bot.send_content(video_path, final_script)
                if success:
                    logging.info(f"✅ Video sent to Telegram")
                else:
                    logging.error(f"❌ Failed to send video")
            else:
                logging.error(f"❌ Failed to create video")
        
        logging.info(f"Hourly run complete - {len(selected)} videos generated")
        
        # Step 5: Log for analytics
        self._log_run_metrics(len(selected))
    
    def _get_fallback_trends(self) -> List[Dict]:
        """Fallback topics if scraping fails"""
        fallbacks = [
            {"topic": "Proper squat form for glute growth", "source": "fallback"},
            {"topic": "Best pre-workout meal before leg day", "source": "fallback"},
            {"topic": "How to increase pull-up reps", "source": "fallback"},
            {"topic": "Deadlift mistakes ruining your back", "source": "fallback"},
            {"topic": "Quick ab workout for visible core", "source": "fallback"},
        ]
        return random.sample(fallbacks, min(CONTENT_PER_HOUR, len(fallbacks)))
    
    def _log_run_metrics(self, videos_generated: int):
        """Log metrics for monitoring"""
        conn = sqlite3.connect('influencer_bot.db')
        c = conn.cursor()
        
        c.execute("SELECT COUNT(*) FROM posts")
        total_posts = c.fetchone()[0]
        
        conn.close()
        
        logging.info(f"📊 Metrics: Total posts in DB: {total_posts}")

# ============================================
# TELEGRAM COMMAND HANDLERS
# ============================================

def setup_telegram_handlers():
    """Setup Telegram bot command handlers"""
    updater = Updater(token=TELEGRAM_BOT_TOKEN, use_context=True)
    dp = updater.dispatcher
    
    def start(update, context):
        update.message.reply_text(
            "🤖 *AI Influencer Bot Active*\n\n"
            "I'm generating fitness content every hour!\n\n"
            "Commands:\n"
            "/status - Check bot status\n"
            "/trends - See current trending topics\n"
            "/stats - View your performance stats\n"
            "/help - Show this message",
            parse_mode='Markdown'
        )
    
    def status(update, context):
        conn = sqlite3.connect('influencer_bot.db')
        c = conn.cursor()
        c.execute("SELECT COUNT(*) FROM posts")
        post_count = c.fetchone()[0]
        conn.close()
        
        update.message.reply_text(
            f"📊 *Bot Status*\n\n"
            f"✅ Running\n"
            f"📹 Videos generated: {post_count}\n"
            f"⏰ Hourly schedule: Active\n"
            f"🧠 Learning mode: Enabled\n"
            f"📈 Exploration rate: {EXPLORATION_RATE*100}%",
            parse_mode='Markdown'
        )
    
    def handle_callback(update, context):
        query = update.callback_query
        query.answer()
        
        data = query.data
        if data.startswith('post_'):
            content_id = data.replace('post_', '')
            # Create a Telegram bot instance to handle feedback
            bot = InfluencerTelegramBot(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
            response = bot.handle_feedback(content_id, 'post')
            query.edit_message_caption(caption=f"✅ {response}", parse_mode='Markdown')
        
        elif data.startswith('good_'):
            content_id = data.replace('good_', '')
            bot = InfluencerTelegramBot(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
            response = bot.handle_feedback(content_id, 'good')
            query.edit_message_caption(caption=f"👍 {response}", parse_mode='Markdown')
        
        elif data.startswith('bad_'):
            content_id = data.replace('bad_', '')
            bot = InfluencerTelegramBot(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
            response = bot.handle_feedback(content_id, 'bad')
            query.edit_message_caption(caption=f"👎 {response}", parse_mode='Markdown')
        
        elif data.startswith('regenerate_'):
            query.edit_message_caption(caption="🔄 Regeneration requested - will generate new content in next cycle", parse_mode='Markdown')
    
    dp.add_handler(CommandHandler("start", start))
    dp.add_handler(CommandHandler("status", status))
    dp.add_handler(CallbackQueryHandler(handle_callback))
    
    return updater

# ============================================
# MAIN ENTRY POINT
# ============================================

def main():
    """Main entry point"""
    print("=" * 60)
    print("🚀 AI INFLUENCER BOT - Self-Learning System")
    print("=" * 60)
    print()
    print("⚠️  Before starting, make sure you:")
    print("   1. Set your TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID")
    print("   2. Installed requirements: pip install -r requirements.txt")
    print("   3. Created 'videos' folder: mkdir videos")
    print()
    print("Press Ctrl+C to stop")
    print("-" * 60)
    
    # Create videos directory
    os.makedirs("videos", exist_ok=True)
    
    # Initialize bot
    bot = AIContentBot()
    
    # Start Telegram bot in background
    updater = setup_telegram_handlers()
    updater.start_polling()
    
    # Run once immediately
    bot.run_hourly()
    
    # Then run every hour
    while True:
        time.sleep(3600)  # 1 hour
        bot.run_hourly()

# ============================================
# REQUIREMENTS FILE (requirements.txt)
# ============================================

REQUIREMENTS = """
python-telegram-bot>=20.0
beautifulsoup4>=4.12.0
feedparser>=6.0.0
Pillow>=10.0.0
scikit-learn>=1.3.0
numpy>=1.24.0
joblib>=1.3.0
requests>=2.31.0
""".strip()

if __name__ == "__main__":
    # Check if requirements are installed
    try:
        import telegram
        import bs4
        import feedparser
        from PIL import Image
        import sklearn
    except ImportError as e:
        print(f"❌ Missing dependency: {e}")
        print("\nPlease install requirements:")
        print("pip install python-telegram-bot beautifulsoup4 feedparser Pillow scikit-learn numpy joblib requests")
        exit(1)
    
    # Check if TELEGRAM_BOT_TOKEN is set
    if TELEGRAM_BOT_TOKEN == "YOUR_BOT_TOKEN_HERE":
        print("❌ Please set your TELEGRAM_BOT_TOKEN in the script")
        print("   Get one from @BotFather on Telegram")
        exit(1)
    
    if TELEGRAM_CHAT_ID == "YOUR_CHAT_ID_HERE":
        print("❌ Please set your TELEGRAM_CHAT_ID in the script")
        print("   Get it from @userinfobot on Telegram")
        exit(1)
    
    main()

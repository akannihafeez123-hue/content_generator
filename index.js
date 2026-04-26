// Viral Shorts Engine — single-file standalone build
// Generates a comedy short-form video every N minutes and posts it to a Telegram chat.
// Designed to run 24/7 on Render / Railway / Fly / any Node.js host.

import express from "express";
import cron from "node-cron";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ffmpegPath from "ffmpeg-static";
import { GoogleGenAI, Modality } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ----------------------------------------------------------------------------
// ENV / CONFIG
// ----------------------------------------------------------------------------
const env = process.env;

function required(name) {
  const v = env[name];
  if (!v) {
    console.error(`FATAL: missing required env var ${name}`);
    process.exit(1);
  }
  return v;
}

const GEMINI_API_KEY = required("GEMINI_API_KEY");
const TELEGRAM_BOT_TOKEN = required("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = required("TELEGRAM_CHAT_ID");

const PORT = Number(env.PORT || 3000);
const DATA_DIR = env.DATA_DIR || path.join(__dirname, "data");
const CADENCE_MINUTES = Math.max(5, Math.min(720, Number(env.CADENCE_MINUTES || 60)));
const VIDEO_SECONDS = Math.max(4, Math.min(30, Number(env.VIDEO_SECONDS || 15)));
const IMAGE_QUALITY = env.IMAGE_QUALITY === "standard" ? "standard" : "high";
const LANGUAGE = env.LANGUAGE || "English";
const ENABLED = (env.ENABLED || "true") === "true";
const TEXT_MODEL = env.GEMINI_TEXT_MODEL || "gemini-2.5-pro";
const IMAGE_MODEL = env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const IMAGE_MODEL_FALLBACK =
  env.GEMINI_IMAGE_MODEL_FALLBACK || "gemini-2.5-flash-image";

const NICHES = (env.NICHES ? env.NICHES.split("|").map((s) => s.trim()).filter(Boolean) : null) || [
  "real jobs that absolutely should not exist but do",
  "historical events so absurd they sound made up",
  "oddly specific laws still on the books somewhere",
  "animals doing things that make zero sense",
  "absurd traditions and rituals practiced with total seriousness",
  "small towns famous for one extremely weird thing",
  "scientific discoveries that scientists themselves found ridiculous",
  "POV: you live in a very specific weird historical era",
  "everyday objects with bizarre origin stories",
  "world records nobody asked for but somebody set anyway",
];

const MEDIA_DIR = path.join(DATA_DIR, "media");
const STORE_FILE = path.join(DATA_DIR, "store.json");

// Resolve bundled font path
const FONT_PATH = path.join(
  path.dirname(require.resolve("@fontsource/oswald/package.json")),
  "files",
  "oswald-latin-700-normal.ttf",
);

// ----------------------------------------------------------------------------
// LOGGING
// ----------------------------------------------------------------------------
const log = {
  info: (...a) => console.log(new Date().toISOString(), "INFO", ...a),
  warn: (...a) => console.warn(new Date().toISOString(), "WARN", ...a),
  error: (...a) => console.error(new Date().toISOString(), "ERROR", ...a),
};

// ----------------------------------------------------------------------------
// STORAGE (JSON file)
// ----------------------------------------------------------------------------
async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(MEDIA_DIR, { recursive: true });
}

async function loadStore() {
  try {
    return JSON.parse(await fs.readFile(STORE_FILE, "utf8"));
  } catch {
    return { runs: [], lastError: undefined, nextRunAt: undefined };
  }
}

async function saveStore(store) {
  await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2));
}

async function appendRun(run) {
  const store = await loadStore();
  store.runs.unshift(run);
  store.runs = store.runs.slice(0, 50);
  await saveStore(store);
}

async function updateRun(id, patch) {
  const store = await loadStore();
  const idx = store.runs.findIndex((r) => r.id === id);
  if (idx >= 0) {
    store.runs[idx] = { ...store.runs[idx], ...patch };
    await saveStore(store);
    return store.runs[idx];
  }
  return undefined;
}

async function setLastError(msg) {
  const store = await loadStore();
  store.lastError = msg;
  await saveStore(store);
}

async function setNextRunAt(iso) {
  const store = await loadStore();
  store.nextRunAt = iso;
  await saveStore(store);
}

async function recentTopics(n) {
  const store = await loadStore();
  return store.runs.map((r) => r.topic).filter(Boolean).slice(0, n);
}

// ----------------------------------------------------------------------------
// GEMINI: comedy writer + scene image generator
// ----------------------------------------------------------------------------
const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

function pickNiche() {
  return NICHES[Math.floor(Math.random() * NICHES.length)];
}

function stripCodeFences(text) {
  const t = text.trim();
  if (t.startsWith("```")) {
    return t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  return t;
}

function computeSceneCount(durationSeconds) {
  if (durationSeconds <= 8) return 4;
  if (durationSeconds <= 12) return 5;
  if (durationSeconds <= 18) return 6;
  if (durationSeconds <= 24) return 7;
  return 8;
}

const COMEDY_STYLES = [
  {
    name: "DEADPAN",
    brief:
      "Dry, matter-of-fact narrator stating something absurdly specific as if it's totally normal. Comedy comes from the calm tone vs the ridiculous content. Think: 'It's not weird, it's just oddly specific.'",
  },
  {
    name: "ABSURD",
    brief:
      "Surreal 'wait this is REAL?' energy. Real-world facts so bizarre they sound made up. Comedy comes from escalating disbelief. Each scene piles on more absurdity.",
  },
  {
    name: "POV",
    brief:
      "First-person relatable mini-story with a twist. Format: 'POV: you [unusual situation]'. Comedy comes from putting the viewer inside an absurd scenario with deadpan internal monologue captions.",
  },
];

async function generateTopicIdea(sceneCount) {
  const niche = pickNiche();
  const style = COMEDY_STYLES[Math.floor(Math.random() * COMEDY_STYLES.length)];
  const recent = await recentTopics(20);
  const avoid = recent.length
    ? `\n\nAVOID repeating any of these recently used topics:\n- ${recent.join("\n- ")}`
    : "";

  const prompt = `You are the head comedy writer for a viral short-form channel (Reels / Shorts / TikTok) that makes people laugh out loud and rewatch immediately. Your job is to be FUNNY first, informative second.

Niche for this video: "${niche}"
Output language: ${LANGUAGE}
Comedy style for this video: ${style.name}
Style brief: ${style.brief}

Write ONE fresh comedy video idea, ${sceneCount} scenes long, that lands a real laugh.

Comedy structure (must follow):
1. HOOK — a scroll-stopping line under 8 words that promises a payoff. Curiosity + comedy energy.
2. Beats across ${sceneCount} scenes:
   - Scene 1: Setup — establish the premise in one beat. Calm, normal-sounding.
   - Scene 2: Tilt — the first thing that's "wait, what?"
   - Scene 3: Escalation — make it weirder/more specific. Be SPECIFIC, not vague — specifics are funny.
${sceneCount >= 4 ? `   - Scene 4: Bigger escalation or unexpected detail.\n` : ""}${sceneCount >= 5 ? `   - Scene 5: Setup the punchline — a beat of false calm before the joke lands.\n` : ""}${sceneCount >= 6 ? `   - Scene 6: PUNCHLINE — the laugh-out-loud payoff. Short, deadpan, devastating. This is the line people will quote in the comments.\n` : ""}${sceneCount >= 7 ? `   - Scene 7: Tag/button — one tiny extra absurd detail after the punchline. The "and one more thing" beat.\n` : ""}

Hard rules:
- BE GENUINELY FUNNY. If a beat isn't funny, rewrite it. Specifics > vagueness. Understatement > shouting. The unexpected word > the expected word.
- Topic must be a real-world phenomenon — real history, real biology, real job, real law, real culture. Truth is the secret sauce.
- Safe-for-work. No mocking individuals or protected groups. No politics, religion, medical/financial advice. Punch UP at the absurdity of the universe, never DOWN at people.
- On-screen captions: 3–7 words each. Conversational. Sound like a friend whispering the joke.
- The PUNCHLINE caption must be the funniest line in the script.
- Visual prompts describe a vertical 9:16 photo. For comedy, lean into VISUAL absurdity: deadpan facial expressions, absurd objects placed seriously, mundane settings with one out-of-place detail. Think Wes Anderson meets r/oddlyspecific. No on-image text, no logos.

Return ONLY this JSON, no markdown, no commentary:
{
  "topic": "max 55 chars internal label",
  "hook": "max 45 chars on-screen hook, can be ALL CAPS",
  "scenes": [
${Array.from({ length: sceneCount }, () => `    { "visual": "specific cinematic visual prompt with comedic framing", "caption": "3-7 word punchy on-screen line" }`).join(",\n")}
  ],
  "caption": "1–2 sentence Instagram / YouTube Shorts caption that sets up the joke without spoiling the punchline. Conversational, ends with a question or dry observation.",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5", "#tag6"]
}${avoid}`;

  const response = await genai.models.generateContent({
    model: TEXT_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      temperature: 1.05,
    },
  });

  const text = response.text ?? "";
  const cleaned = stripCodeFences(text);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    log.error("Failed to parse Gemini topic JSON:", text);
    throw new Error("AI returned malformed topic JSON");
  }

  if (
    !parsed.topic ||
    !parsed.hook ||
    !Array.isArray(parsed.scenes) ||
    parsed.scenes.length < Math.min(3, sceneCount)
  ) {
    throw new Error("AI returned incomplete topic data");
  }

  const scenes = parsed.scenes.slice(0, sceneCount).map((s, i) => ({
    visual: typeof s.visual === "string" ? s.visual : `Scene ${i + 1}`,
    caption: typeof s.caption === "string" ? s.caption.slice(0, 60) : "",
  }));

  return {
    niche,
    topic: parsed.topic.slice(0, 80),
    hook: parsed.hook.slice(0, 60),
    scenes,
    caption: (parsed.caption ?? parsed.topic).slice(0, 600),
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, 8) : [],
  };
}

async function callImageModel(prompt, model) {
  const response = await genai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { responseModalities: [Modality.TEXT, Modality.IMAGE] },
  });
  const candidate = response.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find((p) => p.inlineData);
  if (!imagePart?.inlineData?.data) throw new Error("Image model returned no image data");
  return {
    b64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || "image/png",
  };
}

async function generateSceneImage(scenePrompt, topic) {
  const finalPrompt = `Vertical 9:16 photograph for a comedy short-form social video about "${topic}". ${scenePrompt}.

Style: cinematic but with deadpan comedic framing — think Wes Anderson symmetry meets r/oddlyspecific energy. Subjects shot dead-on with neutral expressions, mundane environments treated with serious cinematography, one perfectly absurd detail in frame, slightly oversaturated colors, soft natural light, shallow depth of field, 35mm photographic look, slight film grain. Mobile-first composition: keep the subject in the upper two-thirds, leave the lower third clean for captions. Photorealistic, sharp focus.

Strictly forbid: no on-image text, no captions, no watermarks, no logos, no UI elements, no borders, no frames, no subtitles, no signage with words, no speech bubbles.`;

  const primary = IMAGE_QUALITY === "high" ? IMAGE_MODEL : IMAGE_MODEL_FALLBACK;
  try {
    return await callImageModel(finalPrompt, primary);
  } catch (err) {
    if (primary !== IMAGE_MODEL_FALLBACK) {
      log.warn("Primary image model failed, falling back:", err.message);
      return callImageModel(finalPrompt, IMAGE_MODEL_FALLBACK);
    }
    throw err;
  }
}

async function writeBase64Image(b64, outPath) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, Buffer.from(b64, "base64"));
}

// ----------------------------------------------------------------------------
// FFMPEG VIDEO ASSEMBLY
// ----------------------------------------------------------------------------
const VIDEO_W = 1080;
const VIDEO_H = 1920;
const FPS = 30;

function escapeForDrawText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\u2019")
    .replace(/%/g, "\\%")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function wrapText(text, maxCharsPerLine) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxCharsPerLine) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = (current ? current + " " : "") + word;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", ...args]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
  });
}

const MOTIONS = [
  (frames) =>
    `zoompan=z='min(zoom+0.0018,1.30)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${VIDEO_W}x${VIDEO_H}:fps=${FPS}`,
  (frames) =>
    `zoompan=z='if(eq(on,0),1.25,max(zoom-0.0018,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${VIDEO_W}x${VIDEO_H}:fps=${FPS}`,
  (frames) =>
    `zoompan=z='min(zoom+0.0015,1.28)':x='iw/2-(iw/zoom/2)+on*1.2':y='ih/2-(ih/zoom/2)':d=${frames}:s=${VIDEO_W}x${VIDEO_H}:fps=${FPS}`,
  (frames) =>
    `zoompan=z='min(zoom+0.0015,1.28)':x='iw/2-(iw/zoom/2)-on*1.2':y='ih/2-(ih/zoom/2)':d=${frames}:s=${VIDEO_W}x${VIDEO_H}:fps=${FPS}`,
];

async function assembleVideo({ scenes, hook, outPath, durationSeconds }) {
  if (scenes.length === 0) throw new Error("No scenes provided to assembleVideo");
  const sceneCount = scenes.length;
  const perScene = +(durationSeconds / sceneCount).toFixed(3);
  const framesPerScene = Math.max(1, Math.round(perScene * FPS));

  const args = [];
  for (const s of scenes) {
    args.push("-loop", "1", "-t", String(perScene), "-i", s.imagePath);
  }

  const perInput = [];
  for (let i = 0; i < sceneCount; i++) {
    const motion = MOTIONS[i % MOTIONS.length](framesPerScene);
    perInput.push(
      `[${i}:v]scale=${VIDEO_W * 2}:${VIDEO_H * 2}:force_original_aspect_ratio=increase,` +
        `crop=${VIDEO_W * 2}:${VIDEO_H * 2},${motion},setsar=1,format=yuv420p[v${i}]`,
    );
  }

  const concatInputs = Array.from({ length: sceneCount }, (_, i) => `[v${i}]`).join("");
  const concatNode = `${concatInputs}concat=n=${sceneCount}:v=1:a=0[concat]`;

  const hookText = escapeForDrawText(wrapText(hook.toUpperCase(), 18));
  const hookDraw =
    `drawtext=fontfile=${FONT_PATH}:text='${hookText}':` +
    `fontcolor=white:fontsize=92:line_spacing=12:` +
    `borderw=8:bordercolor=black@0.95:` +
    `shadowx=4:shadowy=6:shadowcolor=black@0.8:` +
    `x=(w-text_w)/2:y=170`;

  const captionDraws = [];
  for (let i = 0; i < sceneCount; i++) {
    const raw = scenes[i].caption?.trim();
    if (!raw) continue;
    const start = +(i * perScene).toFixed(3);
    const end = +((i + 1) * perScene).toFixed(3);
    const captionText = escapeForDrawText(wrapText(raw, 22));
    const fadeIn = 0.25;
    const fadeOut = 0.25;
    const alphaExpr = `if(lt(t,${start}),0,if(lt(t,${start + fadeIn}),(t-${start})/${fadeIn},if(gt(t,${end - fadeOut}),max(0\\,(${end}-t)/${fadeOut}),1)))`;
    captionDraws.push(
      `drawtext=fontfile=${FONT_PATH}:text='${captionText}':` +
        `fontcolor=white:fontsize=78:line_spacing=10:` +
        `borderw=7:bordercolor=black@0.95:` +
        `shadowx=3:shadowy=5:shadowcolor=black@0.75:` +
        `x=(w-text_w)/2:y=h-text_h-260:` +
        `enable='between(t,${start},${end})':alpha='${alphaExpr}'`,
    );
  }

  const overlayChain = [hookDraw, ...captionDraws].join(",");
  const filter = `${perInput.join(";")};${concatNode};[concat]${overlayChain}[outv]`;

  args.push(
    "-filter_complex", filter,
    "-map", "[outv]",
    "-r", String(FPS),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "veryfast",
    "-crf", "20",
    "-movflags", "+faststart",
    "-t", String(durationSeconds),
    outPath,
  );

  log.info("ffmpeg assembling video:", { outPath, sceneCount, durationSeconds });
  await runFfmpeg(args);
}

async function makeThumbnail(videoPath, outPath) {
  await runFfmpeg([
    "-i", videoPath,
    "-vf", "thumbnail,scale=720:-1",
    "-frames:v", "1",
    outPath,
  ]);
}

// ----------------------------------------------------------------------------
// TELEGRAM
// ----------------------------------------------------------------------------
async function sendVideoToTelegram(videoPath, caption) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendVideo`;
  const buf = await fs.readFile(videoPath);
  const form = new FormData();
  form.append("chat_id", TELEGRAM_CHAT_ID);
  form.append("caption", caption.slice(0, 1024));
  form.append("supports_streaming", "true");
  form.append("video", new Blob([buf], { type: "video/mp4" }), path.basename(videoPath));

  const res = await fetch(url, { method: "POST", body: form });
  const data = await res.json();
  if (!data.ok) {
    return { ok: false, description: data.description || `HTTP ${res.status}` };
  }
  return { ok: true, messageId: data.result.message_id };
}

async function getBotInfo() {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`);
    const data = await res.json();
    if (!data.ok) return null;
    return { username: data.result.username, name: data.result.first_name };
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// ENGINE
// ----------------------------------------------------------------------------
let busy = false;

async function runOnce(trigger) {
  if (busy) throw new Error("Engine is already running a cycle");
  busy = true;
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  await appendRun({ id, startedAt, status: "generating" });
  log.info("Engine cycle started", { id, trigger });

  try {
    const sceneCount = computeSceneCount(VIDEO_SECONDS);
    const idea = await generateTopicIdea(sceneCount);
    await updateRun(id, {
      niche: idea.niche,
      topic: idea.topic,
      hook: idea.hook,
      caption: idea.caption,
      hashtags: idea.hashtags,
    });
    log.info("Topic generated:", { topic: idea.topic, hook: idea.hook, sceneCount });

    const runDir = path.join(MEDIA_DIR, id);
    await fs.mkdir(runDir, { recursive: true });

    const sceneInputs = [];
    for (let i = 0; i < idea.scenes.length; i++) {
      const scene = idea.scenes[i];
      log.info(`Generating scene image ${i + 1}/${idea.scenes.length}`);
      const img = await generateSceneImage(scene.visual, idea.topic);
      const ext = img.mimeType.includes("jpeg") ? "jpg" : "png";
      const imgPath = path.join(runDir, `scene-${i + 1}.${ext}`);
      await writeBase64Image(img.b64, imgPath);
      sceneInputs.push({ imagePath: imgPath, caption: scene.caption });
    }

    const videoPath = path.join(runDir, "video.mp4");
    await assembleVideo({
      scenes: sceneInputs,
      hook: idea.hook,
      outPath: videoPath,
      durationSeconds: VIDEO_SECONDS,
    });

    const thumbPath = path.join(runDir, "thumb.jpg");
    try {
      await makeThumbnail(videoPath, thumbPath);
    } catch (err) {
      log.warn("Thumbnail generation failed, continuing:", err.message);
    }

    const caption = [idea.hook, "", idea.caption, "", idea.hashtags.join(" ")].join("\n").trim();
    const tg = await sendVideoToTelegram(videoPath, caption);
    if (!tg.ok) throw new Error(`Telegram delivery failed: ${tg.description}`);

    const finishedAt = new Date().toISOString();
    await updateRun(id, {
      status: "delivered",
      videoPath,
      thumbnailPath: thumbPath,
      telegramMessageId: tg.messageId,
      finishedAt,
      durationMs: Date.now() - startMs,
    });
    await setLastError(undefined);
    log.info("Engine cycle delivered", { id, messageId: tg.messageId });

    // Optional: clean up older runs to save disk
    await cleanupOldRuns();
  } catch (err) {
    log.error("Engine cycle failed:", err.message);
    await updateRun(id, {
      status: "failed",
      error: err.message,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
    });
    await setLastError(err.message);
  } finally {
    busy = false;
  }
}

async function cleanupOldRuns() {
  try {
    const entries = await fs.readdir(MEDIA_DIR, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    if (dirs.length <= 20) return;
    const stats = await Promise.all(
      dirs.map(async (d) => ({
        name: d.name,
        mtime: (await fs.stat(path.join(MEDIA_DIR, d.name))).mtimeMs,
      })),
    );
    stats.sort((a, b) => a.mtime - b.mtime);
    const toRemove = stats.slice(0, stats.length - 20);
    for (const item of toRemove) {
      await fs.rm(path.join(MEDIA_DIR, item.name), { recursive: true, force: true });
    }
  } catch (err) {
    log.warn("cleanupOldRuns failed:", err.message);
  }
}

// ----------------------------------------------------------------------------
// SCHEDULER
// ----------------------------------------------------------------------------
let scheduledTask = null;

function scheduleNext() {
  const next = new Date(Date.now() + CADENCE_MINUTES * 60_000);
  setNextRunAt(next.toISOString()).catch(() => {});
}

function startScheduler() {
  if (scheduledTask) scheduledTask.stop();
  if (!ENABLED) {
    log.info("Scheduler disabled by ENABLED=false");
    return;
  }
  const expr = `*/${CADENCE_MINUTES} * * * *`;
  scheduledTask = cron.schedule(expr, async () => {
    try {
      await runOnce("scheduled");
    } catch (err) {
      log.error("Scheduled run error:", err.message);
    } finally {
      scheduleNext();
    }
  });
  scheduleNext();
  log.info(`Scheduler started: every ${CADENCE_MINUTES} minutes`);
}

// ----------------------------------------------------------------------------
// HTTP SERVER (status + manual trigger + minimal dashboard)
// ----------------------------------------------------------------------------
const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/api/status", async (_req, res) => {
  const store = await loadStore();
  const bot = await getBotInfo();
  res.json({
    busy,
    config: {
      enabled: ENABLED,
      cadenceMinutes: CADENCE_MINUTES,
      videoSeconds: VIDEO_SECONDS,
      imageQuality: IMAGE_QUALITY,
      language: LANGUAGE,
      niches: NICHES,
    },
    bot,
    nextRunAt: store.nextRunAt,
    lastError: store.lastError,
    recent: store.runs.slice(0, 10),
  });
});

app.post("/api/run", async (_req, res) => {
  if (busy) return res.status(409).json({ ok: false, error: "Engine is busy" });
  runOnce("manual").catch(() => {});
  res.json({ ok: true, message: "Cycle started" });
});

app.get("/", (_req, res) => {
  res.type("html").send(DASHBOARD_HTML);
});

const DASHBOARD_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Viral Shorts Engine</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0d10;color:#e6e9ef;margin:0;padding:24px;max-width:920px;margin-inline:auto}
  h1{font-size:22px;margin:0 0 4px}
  .sub{color:#8a93a3;font-size:13px;margin-bottom:24px}
  .card{background:#141821;border:1px solid #232a36;border-radius:12px;padding:18px;margin-bottom:16px}
  button{background:#3b82f6;color:white;border:0;padding:10px 18px;border-radius:8px;cursor:pointer;font-weight:600}
  button:disabled{opacity:.5;cursor:wait}
  .row{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
  .pill{background:#1f2937;padding:4px 10px;border-radius:999px;font-size:12px}
  .ok{color:#34d399}.bad{color:#f87171}.warn{color:#fbbf24}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #232a36;vertical-align:top}
  th{color:#8a93a3;font-weight:500}
  code{background:#1f2937;padding:2px 6px;border-radius:4px;font-size:12px}
</style></head><body>
<h1>Viral Shorts Engine</h1>
<div class="sub">Comedy short-form videos, generated and posted to Telegram automatically.</div>
<div class="card"><div class="row" id="state">Loading…</div></div>
<div class="card"><button id="run">Generate one now</button> <span id="msg" class="sub" style="margin-left:12px"></span></div>
<div class="card"><h3 style="margin:0 0 12px">Recent runs</h3><div id="runs">Loading…</div></div>
<script>
async function refresh(){
  const r = await fetch('/api/status'); const d = await r.json();
  const bot = d.bot ? '@'+d.bot.username : 'bot offline';
  document.getElementById('state').innerHTML =
    '<span class="pill">'+(d.config.enabled?'<span class="ok">●</span> auto':'<span class="warn">●</span> paused')+'</span>'+
    '<span class="pill">every '+d.config.cadenceMinutes+'m</span>'+
    '<span class="pill">'+d.config.videoSeconds+'s '+d.config.imageQuality+'</span>'+
    '<span class="pill">'+bot+'</span>'+
    '<span class="pill">next: '+(d.nextRunAt? new Date(d.nextRunAt).toLocaleTimeString():'—')+'</span>'+
    (d.busy?'<span class="pill warn">working…</span>':'')+
    (d.lastError?'<div class="bad" style="margin-top:8px">'+d.lastError+'</div>':'');
  const rows = d.recent.map(r => '<tr><td>'+(r.status==='delivered'?'<span class="ok">✓</span>':r.status==='failed'?'<span class="bad">✗</span>':'…')+'</td><td><b>'+(r.hook||'')+'</b><div class="sub">'+(r.topic||'')+'</div></td><td>'+(r.startedAt?new Date(r.startedAt).toLocaleString():'')+'</td><td>'+(r.durationMs?Math.round(r.durationMs/1000)+'s':'')+'</td></tr>').join('');
  document.getElementById('runs').innerHTML = '<table><tr><th></th><th>Hook / topic</th><th>Started</th><th>Took</th></tr>'+rows+'</table>';
  document.getElementById('run').disabled = d.busy;
}
document.getElementById('run').onclick = async () => {
  document.getElementById('msg').textContent = 'Starting…';
  const r = await fetch('/api/run',{method:'POST'}); const d = await r.json();
  document.getElementById('msg').textContent = d.message || d.error || '';
  setTimeout(refresh, 1500);
};
refresh(); setInterval(refresh, 5000);
</script></body></html>`;

// ----------------------------------------------------------------------------
// BOOT
// ----------------------------------------------------------------------------
async function main() {
  await ensureDirs();
  app.listen(PORT, "0.0.0.0", () => {
    log.info(`HTTP server listening on :${PORT}`);
  });
  startScheduler();
  log.info("Engine ready", {
    cadenceMinutes: CADENCE_MINUTES,
    videoSeconds: VIDEO_SECONDS,
    imageQuality: IMAGE_QUALITY,
    textModel: TEXT_MODEL,
    imageModel: IMAGE_MODEL,
    chatId: TELEGRAM_CHAT_ID,
  });
}

main().catch((err) => {
  log.error("Fatal boot error:", err);
  process.exit(1);
});

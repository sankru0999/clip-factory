import { Router, type IRouter } from "express";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import crypto from "crypto";
import multer from "multer";
import { CreateClipBody, GetClipMomentsBody } from "@workspace/api-zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router: IRouter = Router();

const CLIPS_DIR = "/tmp/clips";
const STATUS_DIR = "/tmp/clips";
fs.mkdirSync(CLIPS_DIR, { recursive: true });

// In-memory job registry (status file is written by Python)
const activeJobs = new Set<string>();

const upload = multer({
  dest: "/tmp/clip_uploads/",
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

function getPythonEnv() {
  return {
    ...process.env,
    PYTHONPATH:
      "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages:/home/runner/workspace/.pythonlibs/lib/python3.12/site-packages",
    PATH: `/home/runner/workspace/.pythonlibs/bin:${process.env.PATH}`,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
    CLIP_STATUS_DIR: STATUS_DIR,
  };
}

function findPython(): string {
  const candidates = [
    "/home/runner/workspace/.pythonlibs/bin/python3",
    "/usr/bin/python3",
    "python3",
  ];
  for (const p of candidates) {
    if (p === "python3") return p;
    if (fs.existsSync(p)) return p;
  }
  return "python3";
}

function getStatusFilePath(jobId: string) {
  return path.join(STATUS_DIR, `${jobId}.json`);
}

function readJobStatus(jobId: string) {
  const p = getStatusFilePath(jobId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function initJobStatus(jobId: string) {
  const p = getStatusFilePath(jobId);
  fs.writeFileSync(
    p,
    JSON.stringify({
      job_id: jobId,
      status: "pending",
      step: "En cola...",
      progress: 0,
    })
  );
}

function startClipJob(
  jobId: string,
  source: string,
  isLocal: boolean,
  start: number | null,
  end: number | null,
  mood: string,
  mode: string
): void {
  const scriptPath = path.resolve(__dirname, "../clip_editor.py");
  const python = findPython();

  const args = [
    scriptPath,
    jobId,
    source,
    String(isLocal),
    start !== null ? String(start) : "null",
    end !== null ? String(end) : "null",
    mood,
    mode,
    CLIPS_DIR,
  ];

  const proc = spawn(python, args, {
    env: getPythonEnv(),
    detached: false,
  });

  activeJobs.add(jobId);

  proc.stderr.on("data", (data: Buffer) => {
    process.stderr.write(`[clip:${jobId}] ${data}`);
  });

  proc.on("close", (code: number) => {
    activeJobs.delete(jobId);
    const status = readJobStatus(jobId);
    if (status?.status !== "done" && status?.status !== "error") {
      // Process ended unexpectedly
      const p = getStatusFilePath(jobId);
      const current = readJobStatus(jobId) || {};
      fs.writeFileSync(
        p,
        JSON.stringify({
          ...current,
          status: "error",
          error: `Process exited with code ${code}`,
        })
      );
    }
  });

  proc.on("error", (err: Error) => {
    activeJobs.delete(jobId);
    const p = getStatusFilePath(jobId);
    fs.writeFileSync(
      p,
      JSON.stringify({
        job_id: jobId,
        status: "error",
        error: `Failed to start processor: ${err.message}`,
      })
    );
  });
}

// POST /clips/create — start clip from URL
router.post("/clips/create", (req, res) => {
  const parsed = CreateClipBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: " + parsed.error.message });
    return;
  }

  const { url, start, end, mood, mode } = parsed.data;

  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  // Validate URL is from supported platform
  const supportedPattern =
    /youtube\.com|youtu\.be|twitch\.tv|kick\.com/i;
  if (!supportedPattern.test(url)) {
    res
      .status(400)
      .json({ error: "Only YouTube, Twitch, and Kick URLs are supported." });
    return;
  }

  const jobId = crypto.randomUUID();
  initJobStatus(jobId);
  startClipJob(jobId, url, false, start ?? null, end ?? null, mood, mode ?? "ai");

  res.json({ job_id: jobId, message: "Clip job started" });
});

// POST /clips/upload — start clip from uploaded file
router.post("/clips/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const allowed = [".mp4", ".mov", ".avi", ".mkv", ".webm"];
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!allowed.includes(ext)) {
    fs.unlinkSync(req.file.path);
    res
      .status(400)
      .json({ error: "Unsupported file format. Use mp4, mov, or avi." });
    return;
  }

  // Rename to mp4 if needed
  const finalPath = req.file.path + ".mp4";
  fs.renameSync(req.file.path, finalPath);

  const mood = String(req.body.mood || "energetic");
  const mode = String(req.body.mode || "manual");
  const start = req.body.start ? parseFloat(req.body.start) : null;
  const end = req.body.end ? parseFloat(req.body.end) : null;

  const jobId = crypto.randomUUID();
  initJobStatus(jobId);
  startClipJob(jobId, finalPath, true, start, end, mood, mode);

  res.json({ job_id: jobId, message: "Clip job started from upload" });
});

// GET /clips/status/:jobId — poll status
router.get("/clips/status/:jobId", (req, res) => {
  const { jobId } = req.params;
  if (!jobId || !/^[a-f0-9-]+$/.test(jobId)) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const status = readJobStatus(jobId);
  if (!status) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json(status);
});

// GET /clips/download/:jobId — stream the finished clip
router.get("/clips/download/:jobId", (req, res) => {
  const { jobId } = req.params;
  if (!jobId || !/^[a-f0-9-]+$/.test(jobId)) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const status = readJobStatus(jobId);
  if (!status || status.status !== "done") {
    res.status(404).json({ error: "Clip not ready or not found" });
    return;
  }

  const clipPath = path.join(CLIPS_DIR, `clip_${jobId}.mp4`);
  if (!fs.existsSync(clipPath)) {
    res.status(404).json({ error: "Clip file not found" });
    return;
  }

  const stat = fs.statSync(clipPath);
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Length", stat.size);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="clip_${jobId.slice(0, 8)}.mp4"`
  );
  res.setHeader("Accept-Ranges", "bytes");

  const stream = fs.createReadStream(clipPath);
  stream.pipe(res);
});

// POST /clips/moments — get AI-suggested moments (lightweight, just download + transcribe + analyze)
router.post("/clips/moments", async (req, res) => {
  const parsed = GetClipMomentsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: " + parsed.error.message });
    return;
  }

  const { url } = parsed.data;
  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  // Run a quick moments-only analysis using Python
  const scriptPath = path.resolve(__dirname, "../clip_moments.py");
  const python = findPython();

  try {
    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn(python, [scriptPath, url], {
        env: getPythonEnv(),
      });
      let out = "";
      let err = "";
      proc.stdout.on("data", (d: Buffer) => (out += d));
      proc.stderr.on("data", (d: Buffer) => (err += d));
      proc.on("close", (code: number) => {
        if (out.trim()) resolve(out.trim());
        else reject(new Error(err.slice(-300)));
      });
      proc.on("error", reject);
    });

    const data = JSON.parse(result);
    res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Analysis failed";
    res.status(500).json({ error: msg });
  }
});

export default router;

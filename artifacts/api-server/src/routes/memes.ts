import { Router, type IRouter } from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { GenerateMemesBody } from "@workspace/api-zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router: IRouter = Router();

function runPythonMemeGenerator(
  youtubeUrl: string,
  language: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(__dirname, "../meme_generator.py");

    // Find python3 - check common locations including .pythonlibs
    const pythonPaths = [
      "/home/runner/workspace/.pythonlibs/bin/python3",
      "/usr/bin/python3",
      "python3",
    ];

    const tryPython = (index: number) => {
      if (index >= pythonPaths.length) {
        reject(new Error("python3 not found"));
        return;
      }

      const python = pythonPaths[index];
      const proc = spawn(python, [scriptPath, youtubeUrl, language], {
        env: {
          ...process.env,
          PYTHONPATH:
            "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages:/home/runner/workspace/.pythonlibs/lib/python3.12/site-packages",
          PATH: `/home/runner/workspace/.pythonlibs/bin:${process.env.PATH}`,
        },
        timeout: 360000, // 6 minutes max
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
        // Log progress messages
        if (process.env.NODE_ENV !== "production") {
          process.stderr.write(`[meme-gen] ${data.toString()}`);
        }
      });

      proc.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT" && index < pythonPaths.length - 1) {
          tryPython(index + 1);
        } else {
          reject(new Error(`Failed to start python: ${err.message}`));
        }
      });

      proc.on("close", (code: number) => {
        if (code !== 0 && !stdout.trim()) {
          reject(
            new Error(
              `Python process failed (code ${code}): ${stderr.slice(-500)}`,
            ),
          );
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch {
          reject(
            new Error(`Invalid JSON from meme generator: ${stdout.slice(-300)}`),
          );
        }
      });
    };

    tryPython(0);
  });
}

router.post("/memes/generate", async (req, res) => {
  try {
    const parsed = GenerateMemesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request: " + parsed.error.message });
      return;
    }

    const { youtube_url, language } = parsed.data;

    // Basic URL validation
    const ytPattern =
      /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/).+/;
    if (!ytPattern.test(youtube_url)) {
      res
        .status(400)
        .json({ error: "Please provide a valid YouTube URL." });
      return;
    }

    const result = (await runPythonMemeGenerator(youtube_url, language)) as {
      error?: string;
      memes?: unknown[];
      video_title?: string;
    };

    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[memes/generate] Error:", message);
    res.status(500).json({ error: `Generation failed: ${message}` });
  }
});

router.post("/memes/ad-reward", (_req, res) => {
  const adUrl = process.env.ADSTERRA_AD_URL || "https://www.adsterra.com";
  res.json({
    ad_url: adUrl,
    credits_granted: 3,
  });
});

export default router;

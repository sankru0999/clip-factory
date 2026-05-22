#!/usr/bin/env python3
"""
Lightweight moments-only analysis: download → transcribe → Gemini moments.
Called by POST /clips/moments endpoint.
"""
import sys, os, json, subprocess, tempfile, re

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

def log(msg): print(msg, file=sys.stderr, flush=True)

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: clip_moments.py <url>"}))
        sys.exit(1)

    url = sys.argv[1]

    with tempfile.TemporaryDirectory() as tmpdir:
        # Download info only (no full download for moments)
        log("Getting video info...")
        try:
            result = subprocess.run(
                ["yt-dlp", "--dump-json", "--no-playlist", url],
                capture_output=True, text=True, timeout=30
            )
            if result.returncode != 0:
                print(json.dumps({"error": f"Cannot access video: {result.stderr[:200]}"}))
                sys.exit(1)
            info = json.loads(result.stdout)
            title = info.get("title", "Video")
            duration = float(info.get("duration", 120))
        except Exception as e:
            print(json.dumps({"error": str(e)}))
            sys.exit(1)

        # Download audio only for transcription (faster)
        log("Downloading audio for transcription...")
        audio_path = os.path.join(tmpdir, "audio.mp3")
        cmd = [
            "yt-dlp",
            "-f", "bestaudio",
            "--extract-audio", "--audio-format", "mp3",
            "--no-playlist",
            "-o", audio_path,
        ]
        if duration > 600:
            cmd.extend(["--download-sections", "*0-600"])
        cmd.append(url)
        subprocess.run(cmd, capture_output=True, timeout=180)

        if not os.path.exists(audio_path):
            # Check for any audio file
            for f in os.listdir(tmpdir):
                if f.endswith(('.mp3', '.m4a', '.ogg', '.webm')):
                    audio_path = os.path.join(tmpdir, f)
                    break

        # Transcribe
        transcript = ""
        if os.path.exists(audio_path):
            log("Transcribing...")
            try:
                import whisper, warnings
                warnings.filterwarnings("ignore")
                model = whisper.load_model("tiny")  # Use tiny for speed
                result = model.transcribe(audio_path, fp16=False, verbose=False)
                transcript = result.get("text", "")
            except Exception as e:
                log(f"Transcription error: {e}")

        # Get moments from Gemini
        moments = []
        if transcript and GEMINI_API_KEY:
            log("Analyzing with Gemini...")
            try:
                from google import genai
                client = genai.Client(api_key=GEMINI_API_KEY)
                max_dur = min(duration, 600)
                prompt = f"""You are a viral content expert. Analyze this video transcript and identify the 3 best moments for viral short clips (30-60 seconds each).

Transcript: {transcript[:3000]}
Video duration: {max_dur:.0f} seconds

Return ONLY a valid JSON array with exactly 3 objects:
- start: start time in seconds (number)
- end: end time in seconds (number, must be within {max_dur:.0f}s)
- reason: one sentence why this is viral-worthy

Only the JSON array, no markdown."""
                response = client.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=[prompt]
                )
                raw = response.text.strip()
                raw = re.sub(r'^```(?:json)?\s*', '', raw)
                raw = re.sub(r'\s*```$', '', raw)
                data = json.loads(raw.strip())
                if isinstance(data, list):
                    moments = [{"start": float(m.get("start",0)), "end": float(m.get("end",60)), "reason": str(m.get("reason",""))} for m in data[:3]]
            except Exception as e:
                log(f"Gemini error: {e}")

        if not moments:
            # Fallback moments
            d = min(duration, 600)
            moments = [
                {"start": 0, "end": min(60, d), "reason": "Opening hook"},
                {"start": d*0.33, "end": min(d*0.33+60, d), "reason": "Middle highlight"},
                {"start": max(0, d-60), "end": d, "reason": "Closing moment"},
            ]

        print(json.dumps({"moments": moments, "video_title": title}))

if __name__ == "__main__":
    main()

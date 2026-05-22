#!/usr/bin/env python3
"""
ClipFactory clip editor.
Pipeline: download → transcribe → AI analysis → cut → subtitles → music → output
Uses Gemini for AI analysis, ccMixter/archive.org for music.
"""
import sys
import os
import json
import subprocess
import tempfile
import time
import re
import math
import wave
import struct
import urllib.request
import urllib.parse
import uuid
from pathlib import Path

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
STATUS_FILE_DIR = os.environ.get("CLIP_STATUS_DIR", "/tmp/clips")

os.makedirs(STATUS_FILE_DIR, exist_ok=True)

def log(msg, job_id=None):
    print(msg, file=sys.stderr, flush=True)
    if job_id:
        update_status(job_id, step=msg)

def update_status(job_id, status=None, step=None, progress=None, error=None, download_url=None):
    path = os.path.join(STATUS_FILE_DIR, f"{job_id}.json")
    try:
        if os.path.exists(path):
            with open(path) as f:
                data = json.load(f)
        else:
            data = {"job_id": job_id, "status": "processing", "step": "", "progress": 0}
        if status:    data["status"] = status
        if step:      data["step"] = step
        if progress is not None: data["progress"] = progress
        if error:     data["error"] = error
        if download_url: data["download_url"] = download_url
        with open(path, "w") as f:
            json.dump(data, f)
    except Exception as e:
        print(f"Status write error: {e}", file=sys.stderr)

def download_video(url: str, output_dir: str) -> dict:
    """Download video from YouTube/Twitch/Kick using yt-dlp."""
    output_path = os.path.join(output_dir, "source.mp4")

    # Get info
    try:
        result = subprocess.run(
            ["yt-dlp", "--dump-json", "--no-playlist", url],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            err = result.stderr.lower()
            if "private" in err or "unavailable" in err:
                return {"error": "Video is private or unavailable."}
            return {"error": f"Cannot access video: {result.stderr[:200]}"}
        info = json.loads(result.stdout)
        title = info.get("title", "Video")
        duration = info.get("duration", 0)
    except subprocess.TimeoutExpired:
        return {"error": "Timeout getting video info."}
    except Exception as e:
        title = "Video"
        duration = 0

    cmd = [
        "yt-dlp",
        "-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best",
        "--merge-output-format", "mp4",
        "--no-playlist",
        "-o", output_path,
    ]
    if duration and duration > 600:
        cmd.extend(["--download-sections", "*0-600"])
    cmd.append(url)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            return {"error": f"Download failed: {result.stderr[:200]}"}
        if not os.path.exists(output_path):
            for f in os.listdir(output_dir):
                if f.endswith((".mp4", ".webm", ".mkv")):
                    output_path = os.path.join(output_dir, f)
                    break
            else:
                return {"error": "Video file not found after download"}
        return {"path": output_path, "title": title, "duration": duration}
    except subprocess.TimeoutExpired:
        return {"error": "Download timed out. Try a shorter video."}


def transcribe_video(video_path: str) -> dict:
    """Transcribe video audio using Whisper base model."""
    import whisper
    import warnings
    warnings.filterwarnings("ignore")

    model = whisper.load_model("base")
    result = model.transcribe(video_path, fp16=False, verbose=False)
    return {
        "text": result.get("text", ""),
        "segments": result.get("segments", [])
    }


def get_best_moments_with_gemini(transcript: str, duration: float) -> list:
    """Use Gemini to find best 3 viral clip moments from transcript."""
    try:
        from google import genai
    except ImportError:
        return _fallback_moments(duration)

    if not GEMINI_API_KEY:
        return _fallback_moments(duration)

    client = genai.Client(api_key=GEMINI_API_KEY)
    max_dur = min(duration, 600) if duration else 300
    clip_len = min(60, max_dur * 0.2)

    prompt = f"""You are a viral content expert. Analyze this video transcript and identify the 3 best moments for viral short clips.

Transcript:
{transcript[:4000]}

Video duration: {max_dur:.0f} seconds. Each clip should be 30-60 seconds long.

Return ONLY a valid JSON array with exactly 3 objects, each with:
- start: start time in seconds (number)
- end: end time in seconds (number, max {max_dur:.0f})
- reason: one sentence why this moment is viral-worthy

No markdown. No explanations. Only the JSON array."""

    try:
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=[prompt]
        )
        raw = response.text.strip()
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
        moments = json.loads(raw.strip())
        if isinstance(moments, list) and len(moments) > 0:
            # Clamp values
            return [{
                "start": max(0, float(m.get("start", 0))),
                "end": min(max_dur, float(m.get("end", min(60, max_dur)))),
                "reason": str(m.get("reason", "Viral moment"))
            } for m in moments[:3]]
    except Exception as e:
        print(f"Gemini moments error: {e}", file=sys.stderr)

    return _fallback_moments(duration)


def _fallback_moments(duration: float) -> list:
    """Fallback moments when AI is unavailable."""
    dur = min(duration or 120, 600)
    return [
        {"start": 0, "end": min(60, dur), "reason": "Opening hook"},
        {"start": dur * 0.33, "end": min(dur * 0.33 + 60, dur), "reason": "Middle highlight"},
        {"start": max(0, dur - 60), "end": dur, "reason": "Closing moment"},
    ]


def cut_clip(video_path: str, start: float, end: float, output_path: str) -> str:
    """Cut video clip using ffmpeg directly (faster than moviepy for cutting)."""
    duration = end - start
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start),
        "-i", video_path,
        "-t", str(duration),
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg cut failed: {result.stderr[:200]}")
    return output_path


def add_subtitles(video_path: str, segments: list, clip_start: float, output_path: str) -> str:
    """Add animated subtitles using ffmpeg drawtext filter."""
    if not segments:
        import shutil
        shutil.copy(video_path, output_path)
        return output_path

    # Filter segments to clip window
    clip_segs = [
        s for s in segments
        if s.get("end", 0) > clip_start and s.get("start", 0) < clip_start + 3600
    ]

    if not clip_segs:
        import shutil
        shutil.copy(video_path, output_path)
        return output_path

    # Build subtitle file (SRT format, then burn with ffmpeg)
    srt_path = video_path + ".srt"
    with open(srt_path, "w", encoding="utf-8") as f:
        idx = 1
        for seg in clip_segs:
            start = max(0, seg.get("start", 0) - clip_start)
            end = max(0, seg.get("end", 0) - clip_start)
            if end <= start:
                continue
            text = seg.get("text", "").strip()
            if not text:
                continue

            def fmt_time(t):
                h = int(t // 3600)
                m = int((t % 3600) // 60)
                s = int(t % 60)
                ms = int((t - int(t)) * 1000)
                return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

            f.write(f"{idx}\n{fmt_time(start)} --> {fmt_time(end)}\n{text}\n\n")
            idx += 1

    # Burn subtitles with ffmpeg using Impact-style white text + black border
    # Use subtitles filter if SRT has content
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vf", f"subtitles={srt_path}:force_style='FontName=Impact,FontSize=24,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2,Alignment=2,MarginV=30'",
        "-c:a", "copy",
        "-preset", "fast",
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        # Fallback: copy without subtitles
        print(f"Subtitle burn failed: {result.stderr[:200]}", file=sys.stderr)
        import shutil
        shutil.copy(video_path, output_path)

    try:
        os.remove(srt_path)
    except Exception:
        pass

    return output_path


def get_music(mood: str, output_dir: str) -> str | None:
    """Download royalty-free music matching the mood.
    
    Uses ccMixter API first, then curated archive.org fallback tracks.
    """
    # ccMixter mood mapping
    mood_map = {
        "energetic": "energetic upbeat fast",
        "chill": "chill ambient relaxed",
        "dramatic": "dramatic cinematic intense",
        "funny": "quirky fun upbeat comedy",
    }
    mood_query = mood_map.get(mood, "background instrumental")

    # Try ccMixter API (free, no key)
    music_path = os.path.join(output_dir, "music.mp3")
    try:
        query = urllib.parse.quote(mood_query)
        api_url = f"http://ccmixter.org/api/query?tags={urllib.parse.quote(mood)}&f=json&limit=5&lic=all"
        req = urllib.request.Request(api_url, headers={"User-Agent": "ClipFactory/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            tracks = json.loads(resp.read())
            for track in tracks:
                mp3_url = track.get("files", [{}])[0].get("download_url") or track.get("file_page_url")
                if mp3_url and mp3_url.endswith(".mp3"):
                    urllib.request.urlretrieve(mp3_url, music_path)
                    if os.path.getsize(music_path) > 10000:
                        return music_path
    except Exception as e:
        print(f"ccMixter failed: {e}", file=sys.stderr)

    # Fallback: curated royalty-free tracks from archive.org (public domain)
    fallback_urls = {
        "energetic": "https://archive.org/download/78_over-the-waves_juventino-rosas_gbia0001302/Over%20the%20Waves.mp3",
        "chill": "https://archive.org/download/78_moonlight-serenade_glenn-miller-and-his-orchestra-glenn-miller_gbia0001122/Moonlight%20Serenade.mp3",
        "dramatic": "https://archive.org/download/78_in-the-hall-of-the-mountain-king_boston-pops-orchestra-arthur-fiedler-edvard-grieg_gbia0001290/In%20The%20Hall%20Of%20The%20Mountain%20King.mp3",
        "funny": "https://archive.org/download/78_the-flight-of-the-bumble-bee_jascha-heifetz_gbia0000527/The%20Flight%20Of%20The%20Bumble%20Bee.mp3",
    }
    url = fallback_urls.get(mood, fallback_urls["chill"])
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ClipFactory/1.0"})
        urllib.request.urlretrieve(url, music_path)
        if os.path.getsize(music_path) > 5000:
            return music_path
    except Exception as e:
        print(f"Archive.org music fallback failed: {e}", file=sys.stderr)

    return None


def _make_sine_wav(path: str, freq: float, duration: float, volume: float = 0.4):
    """Generate a simple sine wave WAV for SFX fallback."""
    sample_rate = 44100
    n = int(sample_rate * duration)
    with wave.open(path, 'w') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        for i in range(n):
            env = min(i / max(1, 0.02 * sample_rate), 1.0) * max(0.0, 1.0 - i / (n * 0.8))
            val = int(32767 * volume * env * math.sin(2 * math.pi * freq * i / sample_rate))
            wf.writeframes(struct.pack('<h', max(-32767, min(32767, val))))


def mix_audio(clip_path: str, music_path: str | None, output_path: str, music_volume: float = 0.25) -> str:
    """Mix original audio with background music at reduced volume using ffmpeg."""
    if not music_path or not os.path.exists(music_path):
        import shutil
        shutil.copy(clip_path, output_path)
        return output_path

    cmd = [
        "ffmpeg", "-y",
        "-i", clip_path,
        "-stream_loop", "-1",
        "-i", music_path,
        "-filter_complex",
        f"[1:a]volume={music_volume},apad[music];[0:a][music]amix=inputs=2:duration=first[out]",
        "-map", "0:v",
        "-map", "[out]",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        print(f"Audio mix failed: {result.stderr[:200]}", file=sys.stderr)
        import shutil
        shutil.copy(clip_path, output_path)
    return output_path


def create_clip(
    job_id: str,
    video_source: str,  # URL or local file path
    is_local_file: bool,
    start: float | None,
    end: float | None,
    mood: str,
    mode: str,  # "ai" or "manual"
    output_dir: str,
) -> dict:
    """Main orchestration function for clip creation."""

    update_status(job_id, status="processing", step="📥 Iniciando descarga...", progress=5)

    with tempfile.TemporaryDirectory() as tmpdir:
        # Step 1: Get video
        if is_local_file:
            video_path = video_source
            title = os.path.basename(video_source)
            duration = _get_video_duration(video_path)
            update_status(job_id, step="📥 Video local cargado", progress=15)
        else:
            update_status(job_id, step="📥 Descargando video...", progress=5)
            dl = download_video(video_source, tmpdir)
            if "error" in dl:
                update_status(job_id, status="error", error=dl["error"])
                return {"error": dl["error"]}
            video_path = dl["path"]
            title = dl.get("title", "Clip")
            duration = dl.get("duration", 0) or _get_video_duration(video_path)
            update_status(job_id, step="✅ Video descargado", progress=20)

        # Step 2: Transcribe (always needed for subtitles)
        update_status(job_id, step="🎤 Transcribiendo audio con Whisper...", progress=25)
        try:
            transcript_data = transcribe_video(video_path)
            segments = transcript_data.get("segments", [])
            transcript_text = transcript_data.get("text", "")
        except Exception as e:
            print(f"Transcription failed: {e}", file=sys.stderr)
            segments = []
            transcript_text = ""
        update_status(job_id, step="✅ Transcripción completada", progress=45)

        # Step 3: Determine clip start/end
        if mode == "ai" or start is None or end is None:
            update_status(job_id, step="🤖 Analizando mejores momentos con IA...", progress=48)
            moments = get_best_moments_with_gemini(transcript_text, duration)
            if moments:
                best = moments[0]
                clip_start = float(best["start"])
                clip_end = float(best["end"])
            else:
                clip_start = 0
                clip_end = min(60, duration or 60)
            update_status(job_id, step="✅ Mejores momentos detectados", progress=55)
        else:
            clip_start = max(0, float(start))
            clip_end = min(float(end), duration or float(end))
            if clip_end <= clip_start:
                clip_end = clip_start + 60

        # Clamp to video length
        if duration:
            clip_end = min(clip_end, duration)
        clip_duration = clip_end - clip_start
        if clip_duration < 1:
            clip_end = clip_start + min(60, duration or 60)

        # Step 4: Cut clip
        update_status(job_id, step="✂️ Cortando clip...", progress=58)
        cut_path = os.path.join(tmpdir, "cut.mp4")
        try:
            cut_clip(video_path, clip_start, clip_end, cut_path)
        except Exception as e:
            update_status(job_id, status="error", error=f"Cut failed: {str(e)}")
            return {"error": str(e)}
        update_status(job_id, step="✅ Clip cortado", progress=68)

        # Step 5: Add subtitles
        update_status(job_id, step="📝 Añadiendo subtítulos animados...", progress=70)
        sub_path = os.path.join(tmpdir, "subtitled.mp4")
        try:
            add_subtitles(cut_path, segments, clip_start, sub_path)
        except Exception as e:
            print(f"Subtitle error: {e}", file=sys.stderr)
            import shutil
            shutil.copy(cut_path, sub_path)
        update_status(job_id, step="✅ Subtítulos añadidos", progress=78)

        # Step 6: Get music
        update_status(job_id, step="🎵 Buscando música sin copyright...", progress=80)
        music_path = None
        try:
            music_path = get_music(mood, tmpdir)
        except Exception as e:
            print(f"Music error: {e}", file=sys.stderr)
        update_status(job_id, step="🎵 Mezclando audio...", progress=85)

        # Step 7: Mix audio
        final_filename = f"clip_{job_id}.mp4"
        final_path = os.path.join(output_dir, final_filename)
        try:
            mix_audio(sub_path, music_path, final_path)
        except Exception as e:
            print(f"Mix error: {e}", file=sys.stderr)
            import shutil
            shutil.copy(sub_path, final_path)

        update_status(
            job_id,
            status="done",
            step="✅ ¡Clip listo!",
            progress=100,
            download_url=f"/api/clips/download/{job_id}"
        )
        return {"success": True, "filename": final_filename, "title": title}


def _get_video_duration(path: str) -> float:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", path],
            capture_output=True, text=True, timeout=15
        )
        data = json.loads(result.stdout)
        return float(data.get("format", {}).get("duration", 0))
    except Exception:
        return 0.0


if __name__ == "__main__":
    if len(sys.argv) < 7:
        print(json.dumps({"error": "Usage: clip_editor.py <job_id> <source> <is_local> <start|null> <end|null> <mood> <mode> <output_dir>"}))
        sys.exit(1)

    job_id    = sys.argv[1]
    source    = sys.argv[2]
    is_local  = sys.argv[3].lower() == "true"
    start_arg = None if sys.argv[4] == "null" else float(sys.argv[4])
    end_arg   = None if sys.argv[5] == "null" else float(sys.argv[5])
    mood_arg  = sys.argv[6]
    mode_arg  = sys.argv[7] if len(sys.argv) > 7 else "ai"
    out_dir   = sys.argv[8] if len(sys.argv) > 8 else STATUS_FILE_DIR

    os.makedirs(out_dir, exist_ok=True)
    result = create_clip(job_id, source, is_local, start_arg, end_arg, mood_arg, mode_arg, out_dir)
    print(json.dumps(result))

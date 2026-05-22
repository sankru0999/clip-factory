#!/usr/bin/env python3
"""
MemeFactory meme generation service.
Called from the Express backend via child_process.
"""
import sys
import os
import json
import subprocess
import tempfile
import time
import re
import requests
from pathlib import Path

def log_err(msg):
    print(msg, file=sys.stderr)

def download_video(youtube_url: str, output_dir: str) -> dict:
    """Download YouTube video using yt-dlp, max 720p, max 10 minutes."""
    output_path = os.path.join(output_dir, "video.mp4")
    
    # First get video info to check duration
    info_cmd = [
        "yt-dlp",
        "--dump-json",
        "--no-playlist",
        youtube_url
    ]
    
    try:
        result = subprocess.run(info_cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            err = result.stderr.lower()
            if "private" in err or "unavailable" in err or "login" in err:
                return {"error": "Este video es privado o no está disponible. / This video is private or unavailable."}
            return {"error": f"Could not get video info: {result.stderr[:200]}"}
        
        info = json.loads(result.stdout)
        title = info.get("title", "Unknown Video")
        duration = info.get("duration", 0)
        
    except subprocess.TimeoutExpired:
        return {"error": "Timeout getting video info. The video may be unavailable."}
    except json.JSONDecodeError:
        title = "YouTube Video"
        duration = 0
    
    # Build download command
    cmd = [
        "yt-dlp",
        "-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best",
        "--merge-output-format", "mp4",
        "--no-playlist",
        "-o", output_path,
    ]
    
    # If longer than 10 min, only download first 10 min
    if duration and duration > 600:
        log_err(f"Video is {duration}s, trimming to first 600s")
        cmd.extend(["--download-sections", "*0-600"])
    
    cmd.append(youtube_url)
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            err = result.stderr.lower()
            if "private" in err or "unavailable" in err:
                return {"error": "Este video es privado o no está disponible. / This video is private or unavailable."}
            return {"error": f"Download failed: {result.stderr[:200]}"}
        
        if not os.path.exists(output_path):
            # Try finding any mp4
            for f in os.listdir(output_dir):
                if f.endswith(".mp4") or f.endswith(".webm") or f.endswith(".mkv"):
                    output_path = os.path.join(output_dir, f)
                    break
            else:
                return {"error": "Video file not found after download"}
        
        return {"path": output_path, "title": title}
        
    except subprocess.TimeoutExpired:
        return {"error": "Video download timed out. Try a shorter video."}


def analyze_with_gemini(video_path: str, language: str) -> list:
    """Upload video to Gemini and get meme moments."""
    import google.generativeai as genai
    
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set")
    
    genai.configure(api_key=api_key)
    
    log_err("Uploading video to Gemini...")
    
    # Upload the file
    video_file = genai.upload_file(video_path, mime_type="video/mp4")
    
    # Wait for processing
    max_wait = 120
    waited = 0
    while video_file.state.name == "PROCESSING":
        time.sleep(5)
        waited += 5
        video_file = genai.get_file(video_file.name)
        log_err(f"Gemini processing... {waited}s")
        if waited >= max_wait:
            raise TimeoutError("Gemini video processing timed out")
    
    if video_file.state.name == "FAILED":
        raise ValueError("Gemini failed to process the video")
    
    log_err("Video processed, sending prompt...")
    
    if language == "es":
        prompt = """Mira este video. Encuentra 8-10 momentos divertidos, incómodos, dramáticos o perfectos para memes.
Devuelve SOLAMENTE un array JSON válido con estos campos por elemento:
- timestamp: tiempo en formato MM:SS
- what_happens: descripción breve en español de qué pasa
- trending_template: nombre de plantilla de meme real (usa nombres exactos como: Drake Hotline Bling, Distracted Boyfriend, This Is Fine, Gru Plan, Two Buttons, Surprised Pikachu, Woman Yelling at Cat, NPC, POV, Expanding Brain, Galaxy Brain, Chad, Gigachad, Stonks, Uno Reverse Card, Left Exit 12 Off Ramp, Running Away Balloon)
- top_text: texto superior del meme en español (gracioso/viral)
- bottom_text: texto inferior del meme en español (gracioso/viral)

No uses markdown. No des explicaciones. Solo el array JSON."""
    else:
        prompt = """Watch this video. Find 8-10 funny, awkward, dramatic or meme-worthy moments.
Return ONLY a valid JSON array with these fields per item:
- timestamp: time in MM:SS format
- what_happens: brief English description of what happens
- trending_template: real meme template name (use exact names like: Drake Hotline Bling, Distracted Boyfriend, This Is Fine, Gru Plan, Two Buttons, Surprised Pikacha, Woman Yelling at Cat, NPC, POV, Expanding Brain, Galaxy Brain, Chad, Gigachad, Stonks, Uno Reverse Card, Left Exit 12 Off Ramp, Running Away Balloon)
- top_text: top text of the meme in English (funny/viral)
- bottom_text: bottom text of the meme in English (funny/viral)

No markdown. No explanations. Only the JSON array."""

    model = genai.GenerativeModel("gemini-1.5-flash")
    
    # Try with retry
    for attempt in range(2):
        try:
            response = model.generate_content([video_file, prompt])
            raw = response.text.strip()
            
            # Strip markdown code blocks if present
            raw = re.sub(r'^```(?:json)?\s*', '', raw)
            raw = re.sub(r'\s*```$', '', raw)
            raw = raw.strip()
            
            moments = json.loads(raw)
            if isinstance(moments, list) and len(moments) > 0:
                return moments
        except (json.JSONDecodeError, ValueError) as e:
            log_err(f"Attempt {attempt+1}: JSON parse failed: {e}")
            if attempt == 1:
                raise ValueError(f"Gemini returned invalid JSON after 2 attempts: {raw[:200]}")
            time.sleep(2)
    
    return []


def get_imgflip_templates() -> list:
    """Fetch available meme templates from Imgflip."""
    try:
        resp = requests.get("https://api.imgflip.com/get_memes", timeout=10)
        data = resp.json()
        if data.get("success"):
            return data["data"]["memes"]
    except Exception as e:
        log_err(f"Failed to fetch Imgflip templates: {e}")
    return []


def find_best_template(templates: list, template_name: str) -> dict | None:
    """Find the best matching template using partial matching."""
    name_lower = template_name.lower()
    
    # Exact match first
    for t in templates:
        if t["name"].lower() == name_lower:
            return t
    
    # Partial match - all words present
    words = [w for w in name_lower.split() if len(w) > 2]
    best = None
    best_score = 0
    
    for t in templates:
        t_lower = t["name"].lower()
        score = sum(1 for w in words if w in t_lower)
        if score > best_score:
            best_score = score
            best = t
    
    if best_score > 0:
        return best
    
    # Fallback: first word match
    if words:
        for t in templates:
            if words[0] in t["name"].lower():
                return t
    
    return None


def create_meme_imgflip(template_id: str, top_text: str, bottom_text: str) -> str | None:
    """Create meme using Imgflip API."""
    username = os.environ.get("IMGFLIP_USERNAME", "")
    password = os.environ.get("IMGFLIP_PASSWORD", "")
    
    if not username or not password:
        return None
    
    try:
        resp = requests.post(
            "https://api.imgflip.com/caption_image",
            data={
                "template_id": template_id,
                "username": username,
                "password": password,
                "text0": top_text[:100],
                "text1": bottom_text[:100],
            },
            timeout=15
        )
        data = resp.json()
        if data.get("success"):
            return data["data"]["url"]
        else:
            log_err(f"Imgflip error: {data.get('error_message', 'unknown')}")
    except Exception as e:
        log_err(f"Imgflip request failed: {e}")
    
    return None


def create_meme_pillow(top_text: str, bottom_text: str, output_path: str) -> str:
    """Fallback: create meme with Pillow (white bg, Impact font style)."""
    from PIL import Image, ImageDraw, ImageFont
    import urllib.request
    
    width, height = 600, 450
    img = Image.new("RGB", (width, height), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    
    # Try to get a system font, fallback to default
    font_size = 52
    font = None
    
    font_paths = [
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
        "/nix/store",  # will search below
    ]
    
    for fp in font_paths:
        if os.path.exists(fp) and fp.endswith(".ttf"):
            try:
                font = ImageFont.truetype(fp, font_size)
                break
            except:
                pass
    
    if font is None:
        # Search nix store for any ttf
        try:
            result = subprocess.run(
                ["find", "/nix/store", "-name", "*.ttf", "-type", "f"],
                capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.splitlines():
                try:
                    font = ImageFont.truetype(line.strip(), font_size)
                    break
                except:
                    pass
        except:
            pass
    
    if font is None:
        font = ImageFont.load_default()
    
    def draw_text_with_border(draw, text, position, font, fill=(0, 0, 0), border_color=(255, 255, 255), border_size=3):
        x, y = position
        for dx in range(-border_size, border_size + 1):
            for dy in range(-border_size, border_size + 1):
                if dx != 0 or dy != 0:
                    draw.text((x + dx, y + dy), text, font=font, fill=border_color)
        draw.text((x, y), text, font=font, fill=fill)
    
    def wrap_text(text, max_width, font, draw):
        words = text.split()
        lines = []
        current = ""
        for word in words:
            test = (current + " " + word).strip()
            bbox = draw.textbbox((0, 0), test, font=font)
            if bbox[2] - bbox[0] <= max_width:
                current = test
            else:
                if current:
                    lines.append(current)
                current = word
        if current:
            lines.append(current)
        return lines
    
    padding = 20
    max_text_width = width - padding * 2
    
    # Draw top text
    top_lines = wrap_text(top_text.upper(), max_text_width, font, draw)
    y_pos = padding
    for line in top_lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        text_w = bbox[2] - bbox[0]
        x_pos = (width - text_w) // 2
        draw_text_with_border(draw, line, (x_pos, y_pos), font)
        y_pos += font_size + 4
    
    # Draw bottom text
    bottom_lines = wrap_text(bottom_text.upper(), max_text_width, font, draw)
    line_height = font_size + 4
    total_height = len(bottom_lines) * line_height
    y_pos = height - padding - total_height
    for line in bottom_lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        text_w = bbox[2] - bbox[0]
        x_pos = (width - text_w) // 2
        draw_text_with_border(draw, line, (x_pos, y_pos), font)
        y_pos += line_height
    
    img.save(output_path, "PNG")
    return output_path


def generate_memes(youtube_url: str, language: str) -> dict:
    """Main pipeline: download → analyze → generate memes."""
    
    with tempfile.TemporaryDirectory() as tmpdir:
        # Step 1: Download video
        log_err("Step 1: Downloading video...")
        dl_result = download_video(youtube_url, tmpdir)
        if "error" in dl_result:
            return {"error": dl_result["error"]}
        
        video_path = dl_result["path"]
        video_title = dl_result.get("title", "YouTube Video")
        
        # Step 2: Analyze with Gemini
        log_err("Step 2: Analyzing with Gemini...")
        try:
            moments = analyze_with_gemini(video_path, language)
        except Exception as e:
            return {"error": f"Gemini analysis failed: {str(e)}"}
        
        if not moments:
            return {"error": "No meme-worthy moments found in this video."}
        
        # Step 3: Generate meme images
        log_err("Step 3: Generating meme images...")
        templates = get_imgflip_templates()
        
        memes = []
        for moment in moments[:10]:
            top_text = moment.get("top_text", "")
            bottom_text = moment.get("bottom_text", "")
            template_name = moment.get("trending_template", "Distracted Boyfriend")
            
            image_url = None
            
            # Try Imgflip first
            if templates:
                template = find_best_template(templates, template_name)
                if template:
                    image_url = create_meme_imgflip(template["id"], top_text, bottom_text)
                    if not image_url:
                        log_err(f"Imgflip failed for {template_name}, using Pillow fallback")
            
            # Fallback to Pillow
            if not image_url:
                pillow_path = os.path.join(tmpdir, f"meme_{len(memes)}.png")
                try:
                    create_meme_pillow(top_text, bottom_text, pillow_path)
                    # Read as base64 data URL
                    import base64
                    with open(pillow_path, "rb") as f:
                        b64 = base64.b64encode(f.read()).decode()
                    image_url = f"data:image/png;base64,{b64}"
                except Exception as e:
                    log_err(f"Pillow fallback failed: {e}")
                    image_url = ""
            
            memes.append({
                "image_url": image_url,
                "timestamp": moment.get("timestamp", "0:00"),
                "what_happens": moment.get("what_happens", ""),
                "top_text": top_text,
                "bottom_text": bottom_text,
                "template_name": template_name,
            })
        
        return {
            "memes": memes,
            "video_title": video_title,
        }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: meme_generator.py <youtube_url> <language>"}))
        sys.exit(1)
    
    youtube_url = sys.argv[1]
    language = sys.argv[2] if sys.argv[2] in ["en", "es"] else "en"
    
    result = generate_memes(youtube_url, language)
    print(json.dumps(result))

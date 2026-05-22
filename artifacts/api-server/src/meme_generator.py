#!/usr/bin/env python3
"""
MemeFactory meme generation service.
Called from the Express backend via child_process.
Uses google-genai (new SDK).
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
    print(msg, file=sys.stderr, flush=True)


def download_video(youtube_url: str, output_dir: str) -> dict:
    """Download YouTube video using yt-dlp, max 720p, max 10 minutes."""
    output_path = os.path.join(output_dir, "video.mp4")

    # Get info first
    info_cmd = ["yt-dlp", "--dump-json", "--no-playlist", youtube_url]
    try:
        result = subprocess.run(info_cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            err = result.stderr.lower()
            if "private" in err or "unavailable" in err or "login" in err:
                return {"error": "Este video es privado o no está disponible. / This video is private or unavailable."}
            return {"error": f"Could not access video: {result.stderr[:300]}"}
        info = json.loads(result.stdout)
        title = info.get("title", "YouTube Video")
        duration = info.get("duration", 0)
    except subprocess.TimeoutExpired:
        return {"error": "Timeout getting video info. Try again or use a shorter video."}
    except json.JSONDecodeError:
        title = "YouTube Video"
        duration = 0

    cmd = [
        "yt-dlp",
        "-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best",
        "--merge-output-format", "mp4",
        "--no-playlist",
        "-o", output_path,
    ]

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
            return {"error": f"Download failed: {result.stderr[:300]}"}

        # Find the downloaded file
        if not os.path.exists(output_path):
            for f in os.listdir(output_dir):
                if f.endswith((".mp4", ".webm", ".mkv")):
                    output_path = os.path.join(output_dir, f)
                    break
            else:
                return {"error": "Video file not found after download"}

        return {"path": output_path, "title": title}

    except subprocess.TimeoutExpired:
        return {"error": "Video download timed out. Try a shorter video."}


def analyze_with_gemini(video_path: str, language: str) -> list:
    """Upload video to Gemini and get meme moments."""
    try:
        from google import genai
    except ImportError:
        import google.generativeai as genai_old
        return analyze_with_old_gemini(genai_old, video_path, language)

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set")

    client = genai.Client(api_key=api_key)

    log_err("Uploading video to Gemini...")
    # Use file path directly — simpler and supported by new SDK
    video_file = client.files.upload(file=video_path)

    # Wait for ACTIVE state
    max_wait = 180
    waited = 0
    while hasattr(video_file, 'state') and str(video_file.state).upper() in ("PROCESSING", "FILE_STATE_PROCESSING", "1"):
        time.sleep(5)
        waited += 5
        video_file = client.files.get(name=video_file.name)
        log_err(f"Gemini processing... {waited}s elapsed")
        if waited >= max_wait:
            raise TimeoutError("Gemini video processing timed out after 3 minutes")

    state_str = str(video_file.state).upper()
    if "FAIL" in state_str:
        raise ValueError("Gemini failed to process the video")

    log_err("Video processed. Sending prompt to Gemini...")
    prompt = _build_prompt(language)

    raw = ""
    for attempt in range(2):
        try:
            response = client.models.generate_content(
                model="gemini-2.0-flash",
                contents=[video_file, prompt]
            )
            raw = response.text.strip()
            raw = re.sub(r'^```(?:json)?\s*', '', raw)
            raw = re.sub(r'\s*```$', '', raw)
            raw = raw.strip()
            moments = json.loads(raw)
            if isinstance(moments, list) and len(moments) > 0:
                log_err(f"Got {len(moments)} moments from Gemini")
                return moments
        except (json.JSONDecodeError, ValueError) as e:
            log_err(f"Attempt {attempt + 1}: JSON parse failed: {e}\nRaw: {raw[:200]}")
            if attempt == 1:
                raise ValueError(f"Gemini returned invalid JSON after 2 attempts: {raw[:300]}")
            time.sleep(3)

    return []


def analyze_with_old_gemini(genai, video_path: str, language: str) -> list:
    """Fallback using old google-generativeai SDK."""
    import warnings
    warnings.filterwarnings("ignore")

    api_key = os.environ.get("GEMINI_API_KEY")
    genai.configure(api_key=api_key)

    log_err("Uploading video to Gemini (legacy SDK)...")
    video_file = genai.upload_file(video_path, mime_type="video/mp4")

    max_wait = 120
    waited = 0
    while video_file.state.name == "PROCESSING":
        time.sleep(5)
        waited += 5
        video_file = genai.get_file(video_file.name)
        log_err(f"Processing... {waited}s")
        if waited >= max_wait:
            raise TimeoutError("Gemini timed out")

    if video_file.state.name == "FAILED":
        raise ValueError("Gemini failed to process video")

    prompt = _build_prompt(language)
    model = genai.GenerativeModel("gemini-1.5-flash")

    for attempt in range(2):
        try:
            response = model.generate_content([video_file, prompt])
            raw = response.text.strip()
            raw = re.sub(r'^```(?:json)?\s*', '', raw)
            raw = re.sub(r'\s*```$', '', raw)
            raw = raw.strip()
            moments = json.loads(raw)
            if isinstance(moments, list) and len(moments) > 0:
                return moments
        except (json.JSONDecodeError, ValueError) as e:
            log_err(f"Attempt {attempt + 1}: {e}")
            if attempt == 1:
                raise ValueError(f"Invalid JSON from Gemini: {raw[:300]}")
            time.sleep(2)

    return []


def _build_prompt(language: str) -> str:
    if language == "es":
        return """Mira este video. Encuentra 8-10 momentos divertidos, incómodos, dramáticos o perfectos para memes.
Devuelve SOLAMENTE un array JSON válido (sin markdown, sin explicaciones) con estos campos:
- timestamp: tiempo en formato MM:SS
- what_happens: descripción breve en español de qué pasa
- trending_template: nombre de plantilla de meme real (usa nombres exactos como: Drake Hotline Bling, Distracted Boyfriend, This Is Fine, Gru Plan, Two Buttons, Surprised Pikachu, Woman Yelling at Cat, NPC, POV, Expanding Brain, Gigachad, Stonks, Uno Reverse Card, Left Exit 12 Off Ramp, Running Away Balloon, Change My Mind, Mocking SpongeBob)
- top_text: texto superior del meme en español (gracioso/viral, máx 80 caracteres)
- bottom_text: texto inferior del meme en español (gracioso/viral, máx 80 caracteres)

Solo devuelve el array JSON. Sin texto adicional."""
    else:
        return """Watch this video. Find 8-10 funny, awkward, dramatic or meme-worthy moments.
Return ONLY a valid JSON array (no markdown, no explanations) with these fields:
- timestamp: time in MM:SS format
- what_happens: brief English description of what happens
- trending_template: real meme template name (use exact names like: Drake Hotline Bling, Distracted Boyfriend, This Is Fine, Gru Plan, Two Buttons, Surprised Pikachu, Woman Yelling at Cat, NPC, POV, Expanding Brain, Gigachad, Stonks, Uno Reverse Card, Left Exit 12 Off Ramp, Running Away Balloon, Change My Mind, Mocking SpongeBob)
- top_text: top text of the meme (funny/viral, max 80 chars)
- bottom_text: bottom text of the meme (funny/viral, max 80 chars)

Return only the JSON array. No additional text."""


def get_imgflip_templates() -> list:
    try:
        resp = requests.get("https://api.imgflip.com/get_memes", timeout=10)
        data = resp.json()
        if data.get("success"):
            return data["data"]["memes"]
    except Exception as e:
        log_err(f"Failed to fetch Imgflip templates: {e}")
    return []


def find_best_template(templates: list, template_name: str) -> dict | None:
    name_lower = template_name.lower()

    # Exact match
    for t in templates:
        if t["name"].lower() == name_lower:
            return t

    # Score by how many words match
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

    # First keyword match
    if words:
        for t in templates:
            if words[0] in t["name"].lower():
                return t

    return None


def create_meme_imgflip(template_id: str, top_text: str, bottom_text: str) -> str | None:
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
            timeout=15,
        )
        data = resp.json()
        if data.get("success"):
            return data["data"]["url"]
        log_err(f"Imgflip error: {data.get('error_message', 'unknown')}")
    except Exception as e:
        log_err(f"Imgflip request failed: {e}")
    return None


def get_pixabay_background(query: str, output_path: str) -> bool:
    """Download a relevant background image from Pixabay. Returns True if successful."""
    api_key = os.environ.get("PIXABAY_API_KEY", "")
    if not api_key:
        return False
    try:
        params = {
            "key": api_key,
            "q": query[:100],
            "image_type": "photo",
            "orientation": "horizontal",
            "safesearch": "true",
            "per_page": 5,
            "min_width": 600,
            "min_height": 450,
        }
        url = "https://pixabay.com/api/?" + "&".join(f"{k}={requests.utils.quote(str(v))}" for k, v in params.items())
        resp = requests.get(url, timeout=10)
        data = resp.json()
        hits = data.get("hits", [])
        if not hits:
            return False
        img_url = hits[0].get("webformatURL") or hits[0].get("largeImageURL")
        if not img_url:
            return False
        img_resp = requests.get(img_url, timeout=15)
        if img_resp.status_code == 200:
            with open(output_path, "wb") as f:
                f.write(img_resp.content)
            return os.path.getsize(output_path) > 1000
    except Exception as e:
        log_err(f"Pixabay fetch failed: {e}")
    return False


def create_meme_pillow(top_text: str, bottom_text: str, output_path: str, bg_query: str = "") -> str:
    """Fallback: meme with Pixabay background (or white) + Impact-style text."""
    from PIL import Image, ImageDraw, ImageFont

    width, height = 600, 450

    # Try Pixabay background first
    bg_img = None
    if bg_query:
        bg_path = output_path + "_bg.jpg"
        if get_pixabay_background(bg_query, bg_path):
            try:
                bg_img = Image.open(bg_path).convert("RGB")
                bg_img = bg_img.resize((width, height), Image.LANCZOS)
            except Exception as e:
                log_err(f"Pixabay image open failed: {e}")
                bg_img = None

    if bg_img:
        img = bg_img
    else:
        img = Image.new("RGB", (width, height), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    font_size = 52
    font = None
    font_paths = [
        "/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages/PIL/",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
    ]
    for fp in font_paths:
        if os.path.exists(fp) and fp.endswith(".ttf"):
            try:
                font = ImageFont.truetype(fp, font_size)
                break
            except Exception:
                pass

    if font is None:
        # Search nix store
        try:
            result = subprocess.run(
                ["find", "/nix/store", "-name", "*.ttf", "-maxdepth", "8"],
                capture_output=True, text=True, timeout=8
            )
            for line in result.stdout.splitlines():
                line = line.strip()
                if "bold" in line.lower() or "Bold" in line:
                    try:
                        font = ImageFont.truetype(line, font_size)
                        break
                    except Exception:
                        pass
            if not font:
                for line in result.stdout.splitlines():
                    try:
                        font = ImageFont.truetype(line.strip(), font_size)
                        break
                    except Exception:
                        pass
        except Exception:
            pass

    if font is None:
        font = ImageFont.load_default()

    def draw_outlined_text(draw, text, pos, font, fill=(0, 0, 0), outline=(255, 255, 255), border=3):
        x, y = pos
        for dx in range(-border, border + 1):
            for dy in range(-border, border + 1):
                if dx != 0 or dy != 0:
                    draw.text((x + dx, y + dy), text, font=font, fill=outline)
        draw.text((x, y), text, font=font, fill=fill)

    def wrap_text(text, max_width, font, draw):
        words = text.split()
        lines, current = [], ""
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
        return lines or [text]

    padding = 18
    max_w = width - padding * 2
    line_h = font_size + 6

    # Top text
    top_lines = wrap_text(top_text.upper(), max_w, font, draw)
    y = padding
    for line in top_lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        x = (width - (bbox[2] - bbox[0])) // 2
        draw_outlined_text(draw, line, (x, y), font)
        y += line_h

    # Bottom text
    bottom_lines = wrap_text(bottom_text.upper(), max_w, font, draw)
    total_h = len(bottom_lines) * line_h
    y = height - padding - total_h
    for line in bottom_lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        x = (width - (bbox[2] - bbox[0])) // 2
        draw_outlined_text(draw, line, (x, y), font)
        y += line_h

    img.save(output_path, "PNG")
    return output_path


def generate_memes(youtube_url: str, language: str) -> dict:
    with tempfile.TemporaryDirectory() as tmpdir:
        log_err("Step 1: Downloading video...")
        dl = download_video(youtube_url, tmpdir)
        if "error" in dl:
            return {"error": dl["error"]}

        video_path = dl["path"]
        video_title = dl.get("title", "YouTube Video")

        log_err("Step 2: Analyzing with Gemini...")
        try:
            moments = analyze_with_gemini(video_path, language)
        except Exception as e:
            return {"error": f"Gemini analysis failed: {str(e)}"}

        if not moments:
            return {"error": "No meme-worthy moments found in this video."}

        log_err("Step 3: Generating meme images...")
        templates = get_imgflip_templates()
        memes = []

        for moment in moments[:10]:
            top_text = str(moment.get("top_text", "")).strip()
            bottom_text = str(moment.get("bottom_text", "")).strip()
            template_name = str(moment.get("trending_template", "Distracted Boyfriend")).strip()

            image_url = None

            if templates:
                template = find_best_template(templates, template_name)
                if template:
                    image_url = create_meme_imgflip(template["id"], top_text, bottom_text)
                    if not image_url:
                        log_err(f"Imgflip failed for '{template_name}', using Pillow")

            if not image_url:
                pillow_path = os.path.join(tmpdir, f"meme_{len(memes)}.png")
                what_happens = str(moment.get("what_happens", "")).strip()
                try:
                    create_meme_pillow(top_text, bottom_text, pillow_path, bg_query=what_happens)
                    import base64
                    with open(pillow_path, "rb") as f:
                        b64 = base64.b64encode(f.read()).decode()
                    image_url = f"data:image/png;base64,{b64}"
                except Exception as e:
                    log_err(f"Pillow fallback failed: {e}")
                    image_url = ""

            memes.append({
                "image_url": image_url,
                "timestamp": str(moment.get("timestamp", "0:00")),
                "what_happens": str(moment.get("what_happens", "")),
                "top_text": top_text,
                "bottom_text": bottom_text,
                "template_name": template_name,
            })

        return {"memes": memes, "video_title": video_title}


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: meme_generator.py <youtube_url> <language>"}))
        sys.exit(1)

    youtube_url = sys.argv[1]
    language = sys.argv[2] if sys.argv[2] in ["en", "es"] else "en"

    result = generate_memes(youtube_url, language)
    print(json.dumps(result, ensure_ascii=False))

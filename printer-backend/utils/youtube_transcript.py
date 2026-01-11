from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from urllib.parse import parse_qs, urlparse

from youtube_transcript_api import YouTubeTranscriptApi


class YouTubeTranscriptError(RuntimeError):
    pass


@dataclass(frozen=True)
class YouTubeTranscriptResult:
    video_id: str
    text: str


def extract_video_id(value: str) -> str:
    """
    Accepts either a full YouTube URL or a bare video id.
    Supports:
      - https://www.youtube.com/watch?v=VIDEO_ID
      - https://youtu.be/VIDEO_ID
      - https://www.youtube.com/shorts/VIDEO_ID
    """
    raw = (value or "").strip()
    if not raw:
        raise YouTubeTranscriptError("Missing YouTube URL or video id.")

    # If it doesn't look like a URL, assume it's a video id.
    if "://" not in raw and "." not in raw and "/" not in raw:
        return raw

    parsed = urlparse(raw)

    host = (parsed.netloc or "").lower()
    path = (parsed.path or "").strip("/")

    # youtu.be/<id>
    if "youtu.be" in host:
        vid = path.split("/")[0] if path else ""
        if vid:
            return vid

    # youtube.com/watch?v=<id>
    qs = parse_qs(parsed.query or "")
    if "v" in qs and qs["v"]:
        return qs["v"][0]

    # youtube.com/shorts/<id> or /embed/<id>
    parts = path.split("/") if path else []
    if len(parts) >= 2 and parts[0] in {"shorts", "embed"}:
        return parts[1]

    raise YouTubeTranscriptError("Could not extract a YouTube video id from the provided URL.")


def fetch_transcript_text(video_id: str, *, languages: Optional[list[str]] = None) -> YouTubeTranscriptResult:
    """
    Fetch a transcript for a given video id.
    Defaults to English first, then falls back to the first available transcript.
    """
    langs = languages or ["en"]

    ytt = YouTubeTranscriptApi()

    try:
        fetched = ytt.fetch(video_id, languages=langs)
        text = " ".join((s.text or "").strip() for s in fetched if (s.text or "").strip()).strip()
        if text:
            return YouTubeTranscriptResult(video_id=video_id, text=text)
    except Exception:
        # Fall back below
        pass

    try:
        transcript_list = ytt.list(video_id)
        # Prefer any transcript matching our languages list, but fall back to the first entry.
        try:
            transcript = transcript_list.find_transcript(langs)
        except Exception:
            transcript = next(iter(transcript_list))
        fetched = transcript.fetch()
        text = " ".join((s.text or "").strip() for s in fetched if (s.text or "").strip()).strip()
        if not text:
            raise YouTubeTranscriptError("Transcript was empty.")
        return YouTubeTranscriptResult(video_id=video_id, text=text)
    except YouTubeTranscriptError:
        raise
    except Exception as e:
        raise YouTubeTranscriptError(f"Failed to fetch transcript: {e}") from e



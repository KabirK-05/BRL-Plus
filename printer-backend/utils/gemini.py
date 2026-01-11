import base64
import os

import requests

GEMINI_MODEL = "gemini-2.5-flash"


class GeminiError(RuntimeError):
    pass


def get_gemini_api_key() -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise GeminiError("GEMINI_API_KEY environment variable is not set")
    return api_key


def describe_file(file_bytes: bytes, mime_type: str) -> str:
    """
    Calls Gemini 2.0 Flash to extract/describe content from a PNG/JPG/PDF.
    Uses REST API for reliability and minimal dependencies.
    """
    api_key = get_gemini_api_key()
    b64 = base64.b64encode(file_bytes).decode("utf-8")

    prompt = (
        "Extract all readable text if present. If this is an image or scanned document, "
        "describe it in clear, plain English. Preserve important details, headings, and lists. "
        "Return only the content to be printed (no preamble)."
    )

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {"inline_data": {"mime_type": mime_type, "data": b64}},
                ]
            }
        ],
        "generationConfig": {"temperature": 0.2},
    }

    try:
        resp = requests.post(url, params={"key": api_key}, json=payload, timeout=60)
    except Exception as e:
        raise GeminiError(f"Gemini request failed: {e}") from e

    if resp.status_code >= 400:
        # Avoid leaking key; include response text for debugging.
        raise GeminiError(f"Gemini API error {resp.status_code}: {resp.text}")

    data = resp.json()
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as e:
        raise GeminiError(f"Unexpected Gemini response shape: {data}") from e

    return (text or "").strip()



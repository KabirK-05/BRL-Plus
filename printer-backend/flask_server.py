from io import BytesIO
import atexit
import json
import logging
import os
import threading
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_sock import Sock

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

from utils.text_to_braille import text_to_braille
from utils.braille_to_gcode import DotPosition, dot_pos_to_pdf, get_dots_pos_and_page, dot_pos_to_gcode, printed_dots
from utils.printer import PrinterConnection, PrintStatus, pause_print, print_gcode, resume_print, stop_print
from utils.gemini import describe_file, GeminiError
from utils.assemblyai_stt import AssemblyAIError, connect_stream, create_streaming_client
from utils.elevenlabs_agent_ws import ElevenLabsAgentError, RendererToolProxy, create_sdk_conversation
from utils.youtube_transcript import YouTubeTranscriptError, extract_video_id, fetch_transcript_text

try:
    # pyserial
    from serial.tools import list_ports as _serial_list_ports
except Exception:
    _serial_list_ports = None

app = Flask(__name__)
CORS(app)
sock = Sock(app)

printer = None

# 15MB default upload cap (enforced by Flask)
app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024


def _error(message: str, status_code: int = 400):
    return jsonify({"error": message}), status_code


def _require_printer():
    global printer
    if printer is None:
        return _error("Printer is not connected. Call /connect first.", 400)
    return None


def _validate_upload(file_storage):
    if file_storage is None:
        return None, _error("Missing form file field: file", 400)

    mime = (file_storage.mimetype or "").lower()
    allowed = {"image/png", "image/jpeg", "application/pdf"}
    if mime not in allowed:
        return None, _error(f"Unsupported file type: {mime}. Allowed: png, jpg/jpeg, pdf.", 400)

    data = file_storage.read()
    if not data:
        return None, _error("Empty file upload", 400)

    # Reset stream in case caller wants to re-read (not strictly needed here)
    try:
        file_storage.stream.seek(0)
    except Exception:
        pass

    return (data, mime), None


@app.route("/", methods=["POST"])
def handle_input():
    # Text-only backend: reject file uploads
    if "file" in request.files:
        return _error("PDF upload not supported in this backend. Send text instead.", 400)

    if "text" not in request.form:
        return _error("Missing form field: text", 400)

    transcript = request.form["text"]
    braille = text_to_braille(transcript)
    dots_pos = get_dots_pos_and_page(braille)
    return jsonify(dots_pos), 200


@sock.route("/ws/speech")
def ws_speech(ws):
    """
    WebSocket endpoint for live speech-to-text.

    Client -> Server:
      - Binary messages: raw PCM16 little-endian audio frames at 16kHz, mono.

    Server -> Client:
      - Text messages: JSON with transcript updates:
        { "type": "transcript", "transcript": string, "end_of_turn": bool }
      - Errors:
        { "type": "error", "error": string }
    """

    def send_json(payload: dict):
        ws.send(json.dumps(payload))

    try:
        # Force the WebSocket upgrade early so the client never receives raw HTTP
        # responses that cause "Invalid frame header" errors.
        try:
            send_json({"type": "ready"})
        except Exception:
            # If we can't send, there's no point continuing.
            return

        def on_turn(event):
            transcript = (event.transcript or "").strip()
            if transcript:
                send_json(
                    {
                        "type": "transcript",
                        "transcript": transcript,
                        "end_of_turn": bool(event.end_of_turn),
                    }
                )

        def on_error(error):
            send_json({"type": "error", "error": str(error)})

        client = create_streaming_client(on_turn=on_turn, on_error=on_error)
        # Connect to AssemblyAI after we've confirmed the WS is established.
        connect_stream(client, sample_rate=16000)

        def audio_iter():
            while True:
                msg = ws.receive()
                if msg is None:
                    break

                # Ignore any text control messages for now
                if isinstance(msg, str):
                    if msg.strip().lower() == "terminate":
                        break
                    continue

                # msg is bytes
                yield msg

        try:
            client.stream(audio_iter())
        finally:
            try:
                client.disconnect(terminate=True)
            except Exception:
                pass

    except AssemblyAIError as e:
        try:
            send_json({"type": "error", "error": str(e)})
        except Exception:
            pass
    except Exception as e:
        try:
            send_json({"type": "error", "error": f"Unexpected speech server error: {e}"})
        except Exception:
            pass


@sock.route("/ws/agent")
def ws_agent(ws):
    """
    WebSocket endpoint for ElevenLabs Agents voice conversations (backend-owned session).

    Client -> Server:
      - Binary messages: raw PCM16 little-endian audio frames at 16kHz, mono.
      - Text messages: JSON control frames:
        - { "type": "client_tool_result", "tool_call_id": string, "result": any, "is_error": boolean }
        - { "type": "contextual_update", "text": string }
      - Or plain "terminate" to end session.

    Server -> Client:
      - Text messages: raw ElevenLabs event JSON forwarded, e.g.:
        - { "type": "user_transcript", ... }
        - { "type": "agent_response", ... }
        - { "type": "audio", ... }
        - { "type": "client_tool_call", ... }
        - { "type": "error", "error": string }
    """
    ws_lock = threading.Lock()

    def send_json(payload: dict):
        with ws_lock:
            ws.send(json.dumps(payload))

    conversation = None
    audio_interface = None
    tool_proxy = None
    try:
        try:
            send_json({"type": "ready"})
        except Exception:
            return

        # Send initiation metadata so the renderer knows how to play audio.
        # The Python SDK AudioInterface uses PCM16 mono @ 16kHz for input and output.
        send_json(
            {
                "type": "conversation_initiation_metadata",
                "conversation_initiation_metadata_event": {
                    "conversation_id": "local_sdk",
                    "agent_output_audio_format": "pcm_16000",
                    "user_input_audio_format": "pcm_16000",
                },
            }
        )

        tool_proxy = RendererToolProxy(send_event=send_json)
        conversation, audio_interface = create_sdk_conversation(send_event=send_json, tool_proxy=tool_proxy)
        conversation.start_session()
        logger.info("ElevenLabs conversation started, entering receive loop")

        msg_count = 0
        while True:
            msg = ws.receive()
            msg_count += 1
            if msg is None:
                logger.warning(f"ws.receive() returned None after {msg_count} messages - frontend disconnected?")
                break

            if isinstance(msg, bytes):
                logger.debug(f"Received binary message #{msg_count}: {len(msg)} bytes")
                try:
                    if audio_interface is not None:
                        audio_interface.feed_input(msg)
                except Exception as e:
                    logger.error(f"Failed to forward audio chunk: {e}")
                    send_json({"type": "error", "error": f"Failed to forward audio chunk: {e}"})
                continue

            # msg is a str
            text = (msg or "").strip()
            if not text:
                continue
            if text.lower() == "terminate":
                break

            try:
                payload = json.loads(text)
            except Exception:
                continue

            ptype = payload.get("type")
            logger.debug(f"Received JSON message type: {ptype}")
            if ptype == "client_tool_result":
                tool_call_id = str(payload.get("tool_call_id") or "")
                logger.info(f"Received client_tool_result: id={tool_call_id}, is_error={payload.get('is_error')}")
                if not tool_call_id:
                    logger.warning("client_tool_result missing tool_call_id, ignoring")
                    continue
                result = payload.get("result")
                is_error = bool(payload.get("is_error"))
                try:
                    if tool_proxy is not None:
                        tool_proxy.deliver_result(tool_call_id=tool_call_id, result=result, is_error=is_error)
                        logger.debug(f"Delivered tool result to proxy: id={tool_call_id}")
                except Exception as e:
                    logger.error(f"Failed to deliver tool result: {e}")
                    send_json({"type": "error", "error": f"Failed to forward tool result: {e}"})
            elif ptype == "contextual_update":
                text_update = str(payload.get("text") or "").strip()
                if not text_update:
                    continue
                try:
                    if conversation is not None:
                        conversation.send_contextual_update(text_update)
                except Exception as e:
                    send_json({"type": "error", "error": f"Failed to send contextual update: {e}"})
            else:
                # Ignore unknown control messages for forward compatibility.
                continue

    except ElevenLabsAgentError as e:
        logger.error(f"ElevenLabsAgentError: {e}")
        try:
            send_json({"type": "error", "error": str(e)})
        except Exception:
            pass
    except Exception as e:
        logger.error(f"Unexpected agent server error: {e}", exc_info=True)
        try:
            send_json({"type": "error", "error": f"Unexpected agent server error: {e}"})
        except Exception:
            pass
    finally:
        logger.info("ws_agent handler exiting, calling end_session()")
        try:
            if conversation is not None:
                conversation.end_session()
        except Exception:
            pass


@app.route("/describe_file", methods=["POST"])
def handle_describe_file():
    file_storage = request.files.get("file")
    validated, err = _validate_upload(file_storage)
    if err:
        return err
    file_bytes, mime_type = validated

    try:
        text = describe_file(file_bytes, mime_type)
    except GeminiError as e:
        return _error(str(e), 500)
    except Exception as e:
        return _error(f"Unexpected error calling Gemini: {e}", 500)

    if not text:
        return _error("Gemini returned empty text.", 500)

    return jsonify({"text": text}), 200


@app.route("/youtube_transcript", methods=["POST"])
def handle_youtube_transcript():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    video_id = (data.get("videoId") or "").strip()
    languages = data.get("languages")

    if not url and not video_id:
        return _error("Missing JSON field: url (or videoId)", 400)

    try:
        vid = extract_video_id(video_id or url)
        langs = languages if isinstance(languages, list) and all(isinstance(x, str) for x in languages) else None
        result = fetch_transcript_text(vid, languages=langs)
        return jsonify({"videoId": result.video_id, "text": result.text}), 200
    except YouTubeTranscriptError as e:
        return _error(str(e), 400)
    except Exception as e:
        return _error(f"Unexpected error fetching YouTube transcript: {e}", 500)


@app.route("/ports", methods=["GET"])
def handle_ports():
    """
    Enumerate available serial ports on the host running the Flask backend.

    Returns: { "ports": [{ "device": string, "description": string, "hwid": string }] }
    """
    if _serial_list_ports is None:
        return _error("Serial port discovery is unavailable (pyserial list_ports not installed).", 500)

    try:
        ports = []
        for p in _serial_list_ports.comports():
            device = getattr(p, "device", None)
            if not device:
                continue
            ports.append(
                {
                    "device": device,
                    "description": getattr(p, "description", "") or "",
                    "hwid": getattr(p, "hwid", "") or "",
                }
            )
        return jsonify({"ports": ports}), 200
    except Exception as e:
        return _error(f"Failed to enumerate serial ports: {e}", 500)


@app.route("/connect", methods=["POST"])
def handle_connect():
    global printer
    data = request.get_json(silent=True) or {}
    port = data.get("port")
    baud_rate = data.get("baudRate")
    if not port or baud_rate is None:
        return _error("Missing JSON fields: port, baudRate", 400)

    # macOS note:
    # /dev/tty.* devices are "dial-in" and can error with EINVAL depending on the driver.
    # /dev/cu.* ("call-up") is typically the correct device to open with pyserial.
    try:
        if isinstance(port, str) and port.startswith("/dev/tty."):
            cu_port = "/dev/cu." + port[len("/dev/tty.") :]
            if os.path.exists(cu_port):
                port = cu_port
    except Exception:
        pass

    try:
        printer = PrinterConnection(port, baud_rate)
        printer.connect()
    except Exception as e:
        # Ensure printer doesn't remain in a half-initialized state
        try:
            if printer is not None:
                printer.status = PrintStatus.ERROR
                printer.close()
        except Exception:
            pass
        printer = None
        return _error(str(e), 500)

    return jsonify({"success": True}), 200


@app.route("/disconnect", methods=["POST"])
def handle_disconnect():
    global printer
    if printer is not None:
        try:
            printer.close()
        finally:
            printer = None
    return jsonify({"success": True}), 200


@app.route("/dot_pos_to_pdf", methods=["POST"])
def handle_dot_pos_to_pdf():
    data = request.get_json(silent=True) or {}
    dot_positions = data.get("dotPositions")
    if not isinstance(dot_positions, list):
        return _error("Missing JSON field: dotPositions", 400)

    dot_positions = [DotPosition(**dot_dict) for dot_dict in dot_positions]
    pdf = dot_pos_to_pdf(dot_positions)
    pdf_bytes = pdf.output(dest="S").encode("latin1")
    return send_file(
        BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name="braille.pdf",
    )


@app.route("/printed_dots", methods=["POST"])
def handle_printed_dots():
    return jsonify(printed_dots.dots), 200


@app.route("/print_dots", methods=["POST"])
def handle_print_dots():
    require_err = _require_printer()
    if require_err:
        return require_err

    data = request.get_json(silent=True) or {}
    dot_positions = data.get("dotPositions")
    if not isinstance(dot_positions, list):
        return _error("Missing JSON field: dotPositions", 400)

    dot_positions = [DotPosition(**dot_dict) for dot_dict in dot_positions]
    actions = dot_pos_to_gcode(dot_positions)
    print_gcode(actions, printer)
    return jsonify({"success": True}), 200


@app.route("/stop_print", methods=["POST"])
def handle_stop_print():
    require_err = _require_printer()
    if require_err:
        return require_err
    # Never fail the request mid-session: stopping should be best-effort and fast.
    try:
        stop_print(printer)
    except Exception as e:
        # Still clear printed dots and report a soft error to the client.
        printed_dots.clear()
        return jsonify({"success": True, "warning": str(e)}), 200
    printed_dots.clear()
    return jsonify({"success": True}), 200


@app.route("/pause_print", methods=["POST"])
def handle_pause_print():
    require_err = _require_printer()
    if require_err:
        return require_err
    pause_print(printer)
    return jsonify({"success": True}), 200


@app.route("/resume_print", methods=["POST"])
def handle_resume_print():
    require_err = _require_printer()
    if require_err:
        return require_err
    resume_print(printer)
    return jsonify({"success": True}), 200


def cleanup():
    global printer
    if printer is not None:
        try:
            printer.close()
        finally:
            printer = None


atexit.register(cleanup)

if __name__ == "__main__":
    app.run(port=6969, debug=True)



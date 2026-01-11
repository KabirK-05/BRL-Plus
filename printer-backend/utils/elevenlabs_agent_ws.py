import base64
import logging
import os
import queue
import threading
import uuid
from typing import Any, Callable, Dict, Optional, Tuple

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.DEBUG)


class ElevenLabsAgentError(RuntimeError):
    pass


def _configure_ca_bundle_env():
    """
    Some macOS/Python setups don't pick up system CA certs, which breaks TLS handshakes
    (e.g. websockets -> ssl CERTIFICATE_VERIFY_FAILED).

    If certifi is available, point Python's TLS stack and requests at certifi's CA bundle.
    """
    try:
        import certifi  # type: ignore

        ca_path = certifi.where()
        os.environ.setdefault("SSL_CERT_FILE", ca_path)
        os.environ.setdefault("REQUESTS_CA_BUNDLE", ca_path)
    except Exception:
        # If certifi isn't available, fall back to system defaults.
        pass


def get_elevenlabs_agent_id() -> str:
    """
    Agent ID is required.

    Support both:
      - AGENT_ID (matches ElevenLabs Python SDK docs/examples)
      - ELEVENLABS_AGENT_ID (backwards-compatible with earlier versions of this project)
    """
    agent_id = (os.getenv("AGENT_ID", "") or os.getenv("ELEVENLABS_AGENT_ID", "")).strip()
    if not agent_id:
        raise ElevenLabsAgentError("AGENT_ID (or ELEVENLABS_AGENT_ID) environment variable is not set")
    return agent_id


def get_elevenlabs_api_key() -> Optional[str]:
    """
    Optional. Only required for non-public agents that have auth enabled.
    """
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    return api_key or None


class RendererToolProxy:
    """
    Proxy that lets SDK ClientTools handlers execute in the Electron renderer.

    Flow:
      - SDK receives a `client_tool_call` from ElevenLabs and invokes our registered tool handler.
      - Tool handler emits a `client_tool_call` event to the renderer (same schema the renderer already supports).
      - Renderer executes UI action and replies with `client_tool_result` containing the same `tool_call_id`.
      - Tool handler returns (or raises) based on that result.
    """

    def __init__(self, send_event: Callable[[dict], None]):
        self._send_event = send_event
        self._cv = threading.Condition()
        self._results: Dict[str, Tuple[Any, bool]] = {}

    def deliver_result(self, *, tool_call_id: str, result: Any, is_error: bool):
        logger.debug(f"deliver_result called: id={tool_call_id}, is_error={is_error}")
        with self._cv:
            self._results[tool_call_id] = (result, bool(is_error))
            self._cv.notify_all()
            logger.debug(f"Notified waiting threads for tool_call_id={tool_call_id}")

    def call_and_wait(self, *, tool_name: str, tool_call_id: str, parameters: dict, timeout_s: float = 30.0) -> Any:
        # Send request to renderer.
        payload = {
            "type": "client_tool_call",
            "client_tool_call": {
                "tool_name": tool_name,
                "tool_call_id": tool_call_id,
                "parameters": parameters or {},
            },
        }
        logger.debug(f"Sending tool call to frontend: {tool_name} (id={tool_call_id})")
        self._send_event(payload)

        # Wait for renderer response.
        logger.debug(f"Waiting for tool result: {tool_name} (id={tool_call_id}, timeout={timeout_s}s)")
        with self._cv:
            if tool_call_id not in self._results:
                self._cv.wait(timeout=timeout_s)
            if tool_call_id not in self._results:
                logger.error(f"TIMEOUT waiting for tool result: {tool_name} (id={tool_call_id})")
                raise ElevenLabsAgentError(f"Timed out waiting for tool result: {tool_name} ({tool_call_id})")
            result, is_error = self._results.pop(tool_call_id)
            logger.debug(f"Got tool result: {tool_name} (id={tool_call_id}, is_error={is_error})")

        if is_error:
            raise ElevenLabsAgentError(str(result))
        return result


def create_sdk_conversation(
    *,
    send_event: Callable[[dict], None],
    tool_proxy: RendererToolProxy,
) -> Tuple[Any, Any]:
    """
    Creates an ElevenLabs Python SDK Conversation + a renderer-backed AudioInterface.
    Returns (conversation, audio_interface).
    """
    _configure_ca_bundle_env()

    # Imports are local so the backend can still start even if the user hasn't installed the SDK yet.
    try:
        from elevenlabs.client import ElevenLabs  # type: ignore
        from elevenlabs.conversational_ai.conversation import AudioInterface, ClientTools, Conversation  # type: ignore
    except Exception as e:
        raise ElevenLabsAgentError(
            "ElevenLabs Python SDK is not available in this environment. Install `elevenlabs` in the backend venv."
        ) from e

    # Define RendererAudioInterface inside this function so it can properly inherit
    # from the SDK's AudioInterface base class (which requires lazy import).
    class RendererAudioInterface(AudioInterface):
        """
        ElevenLabs Python SDK AudioInterface that routes:
          - input audio (PCM16 16kHz mono) from renderer -> SDK via input_callback
          - output audio (PCM16 16kHz mono) from SDK -> renderer as ElevenLabs-style `audio` events
        """

        def __init__(self, send_event_fn: Callable[[dict], None]):
            self._send_event = send_event_fn
            self._stop = threading.Event()
            self._input_callback: Optional[Callable[[bytes], None]] = None

            self._q: "queue.Queue[bytes]" = queue.Queue()
            self._out_thread: Optional[threading.Thread] = None
            self._event_id = 0

            # The SDK recommends 4000 samples (250ms) per input callback at 16kHz PCM16 mono.
            # 4000 samples * 2 bytes/sample = 8000 bytes.
            self._in_buf = bytearray()
            self._in_chunk_bytes = 8000

        def start(self, input_callback: Callable[[bytes], None]):
            logger.info("RendererAudioInterface.start() called")
            self._input_callback = input_callback
            self._stop.clear()
            self._in_buf = bytearray()
            self._out_thread = threading.Thread(target=self._output_loop, daemon=True, name="ElevenAudioOut")
            self._out_thread.start()

        def stop(self):
            self._stop.set()
            self._in_buf = bytearray()
            try:
                # Unblock queue
                self._q.put_nowait(b"")
            except Exception:
                pass
            try:
                if self._out_thread is not None and self._out_thread.is_alive():
                    self._out_thread.join(timeout=1.0)
            except Exception:
                pass
            self._out_thread = None
            self._input_callback = None

        def output(self, audio: bytes):
            if self._stop.is_set():
                return
            if not audio:
                return
            try:
                self._q.put_nowait(audio)
            except Exception:
                pass

        def interrupt(self):
            # Best-effort: drop queued audio and signal renderer.
            try:
                while not self._q.empty():
                    self._q.get_nowait()
            except Exception:
                pass
            self._send_event({"type": "interruption", "interruption_event": {"reason": "interrupted"}})

        def feed_input(self, audio: bytes):
            """Custom method: Feed input audio from renderer to SDK."""
            cb = self._input_callback
            if cb is None or self._stop.is_set():
                return
            if not audio:
                return

            # Buffer and emit ~250ms chunks to match SDK guidance.
            self._in_buf.extend(audio)
            while len(self._in_buf) >= self._in_chunk_bytes and cb is not None and not self._stop.is_set():
                chunk = bytes(self._in_buf[: self._in_chunk_bytes])
                del self._in_buf[: self._in_chunk_bytes]
                try:
                    logger.debug(f"Sending audio chunk to SDK: {len(chunk)} bytes")
                    cb(chunk)
                except Exception as e:
                    # If callback fails (e.g. websocket closed), stop feeding.
                    logger.error(f"Error in input_callback: {e}")
                    break

        def _output_loop(self):
            while not self._stop.is_set():
                try:
                    audio = self._q.get(timeout=0.5)
                except Exception:
                    continue
                if self._stop.is_set():
                    break
                if not audio:
                    continue
                self._event_id += 1
                b64 = base64.b64encode(audio).decode("ascii")
                self._send_event({"type": "audio", "audio_event": {"audio_base_64": b64, "event_id": self._event_id}})

    agent_id = get_elevenlabs_agent_id()
    api_key = get_elevenlabs_api_key()

    logger.info(f"Creating ElevenLabs conversation:")
    logger.info(f"  agent_id={agent_id}")
    logger.info(f"  api_key={'set (hidden)' if api_key else 'NOT SET (public agent mode)'}")
    logger.info(f"  requires_auth={bool(api_key)}")

    if not api_key:
        logger.warning("No ELEVENLABS_API_KEY set. Make sure your agent is configured as PUBLIC in the ElevenLabs dashboard.")

    elevenlabs = ElevenLabs(api_key=api_key)
    audio_interface = RendererAudioInterface(send_event)

    client_tools = ClientTools()

    def _mk_handler(tool_name: str):
        def _handler(parameters: dict):
            # The SDK includes a tool_call_id for each invocation. Preserve it end-to-end.
            # Generating a new id here can lead to mismatches / "Invalid message received"
            # errors depending on agent/tool configuration.
            params = parameters or {}
            tool_call_id = str(params.get("tool_call_id") or "").strip() or uuid.uuid4().hex
            # Forward the remaining tool parameters to the renderer.
            params_clean = {k: v for k, v in params.items() if k != "tool_call_id"}
            logger.info(f"Tool call received: {tool_name} (id={tool_call_id})")
            logger.debug(f"Tool parameters: {params_clean}")
            try:
                # UI-driven tools can legitimately take longer than 30s.
                timeout_s = 30.0
                if tool_name in ("confirm_action", "open_file_picker"):
                    timeout_s = 300.0
                elif tool_name in ("start_print_job", "print_text", "set_print_settings", "cancel_print_job"):
                    timeout_s = 180.0

                result = tool_proxy.call_and_wait(
                    tool_name=tool_name,
                    tool_call_id=tool_call_id,
                    parameters=params_clean,
                    timeout_s=timeout_s,
                )
                logger.info(f"Tool call completed: {tool_name} (id={tool_call_id}) -> {type(result).__name__}")
                return result
            except Exception as e:
                logger.error(f"Tool call failed: {tool_name} (id={tool_call_id}) -> {e}")
                raise

        return _handler

    # Register required client tools (case-sensitive names must match dashboard).
    for name in (
        "open_file_picker",
        "read_current_screen",
        "set_print_settings",
        "confirm_action",
        "start_print_job",
        "print_text",
        "cancel_print_job",
    ):
        client_tools.register(name, _mk_handler(name), is_async=False)

    # Forward conversation events to renderer using the same event shapes the renderer already handles.
    def on_user_transcript(t: str):
        send_event({"type": "user_transcript", "user_transcription_event": {"user_transcript": t}})

    def on_agent_response(t: str):
        send_event({"type": "agent_response", "agent_response_event": {"agent_response": t}})

    def on_agent_response_correction(original: str, corrected: str):
        send_event(
            {
                "type": "agent_response_correction",
                "agent_response_correction_event": {
                    "original_agent_response": original,
                    "corrected_agent_response": corrected,
                },
            }
        )

    conversation = Conversation(
        elevenlabs,
        agent_id,
        requires_auth=bool(api_key),
        audio_interface=audio_interface,
        client_tools=client_tools,
        callback_user_transcript=on_user_transcript,
        callback_agent_response=on_agent_response,
        callback_agent_response_correction=on_agent_response_correction,
    )

    return conversation, audio_interface

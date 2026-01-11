import { API_BASE_URL } from './api'

export type ElevenAgentEvent = {
  type: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export type ElevenClientToolCall = {
  tool_name: string
  tool_call_id: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters?: any
}

export type ElevenClientToolCallEvent = {
  type: 'client_tool_call'
  client_tool_call: ElevenClientToolCall
}

export type ElevenAudioEvent = {
  type: 'audio'
  audio_event: {
    audio_base_64: string
    event_id: number
  }
}

export type ElevenConversationInitiationMetadataEvent = {
  type: 'conversation_initiation_metadata'
  conversation_initiation_metadata_event: {
    conversation_id: string
    agent_output_audio_format?: string
    user_input_audio_format?: string
  }
}

export type ElevenAgentController = {
  stop: () => Promise<void>
  sendContextualUpdate: (text: string) => void
  captureYesNo?: (opts: { prompt?: string; timeoutMs?: number }) => Promise<boolean>
}

export type ElevenAgentHandlers = {
  onEvent?: (event: ElevenAgentEvent) => void
  onError?: (error: string) => void
  onStatus?: (status: 'connecting' | 'connected' | 'disconnected') => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onClientToolCall?: (tool: { name: string; parameters: any }) => Promise<any> | any
  onUserTranscript?: (text: string) => void
  onAgentResponse?: (text: string) => void
}

function apiBaseToWsBase(apiBaseUrl: string) {
  if (apiBaseUrl.startsWith('https://')) return apiBaseUrl.replace(/^https:\/\//, 'wss://')
  if (apiBaseUrl.startsWith('http://')) return apiBaseUrl.replace(/^http:\/\//, 'ws://')
  return apiBaseUrl
}

function downsampleTo16k(input: Float32Array, inSampleRate: number) {
  const outSampleRate = 16000
  if (inSampleRate === outSampleRate) return input

  const sampleRateRatio = inSampleRate / outSampleRate
  const newLength = Math.round(input.length / sampleRateRatio)
  const result = new Float32Array(newLength)

  let offsetResult = 0
  let offsetBuffer = 0
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio)
    let acc = 0
    let count = 0
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < input.length; i++) {
      acc += input[i]!
      count++
    }
    result[offsetResult] = count > 0 ? acc / count : 0
    offsetResult++
    offsetBuffer = nextOffsetBuffer
  }

  return result
}

function floatTo16BitPCM(input: Float32Array) {
  const buffer = new ArrayBuffer(input.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < input.length; i++) {
    let s = input[i] ?? 0
    s = Math.max(-1, Math.min(1, s))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}

function base64ToBytes(b64: string) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function parsePcmSampleRate(format?: string): number | null {
  if (!format) return null
  const m = /^pcm_(\d+)/i.exec(format.trim())
  if (!m) return null
  const sr = Number(m[1])
  return Number.isFinite(sr) && sr > 0 ? sr : null
}

class AudioQueuePlayer {
  private readonly ctx: AudioContext
  private nextTime = 0
  private pcmSampleRate: number | null = null

  constructor(ctx: AudioContext) {
    this.ctx = ctx
  }

  setPcmSampleRate(sr: number | null) {
    this.pcmSampleRate = sr
  }

  reset() {
    this.nextTime = 0
  }

  async playBase64AudioChunk(b64: string) {
    if (!b64) return
    // In Electron/Chromium, AudioContext can end up suspended even after creation.
    // Ensure it's running before we schedule playback.
    try {
      if (this.ctx.state === 'suspended') await this.ctx.resume()
    } catch {
      // ignore
    }
    const bytes = base64ToBytes(b64)

    // If ElevenLabs is configured to emit PCM (common default in docs: pcm_44100),
    // treat the payload as raw 16-bit little-endian PCM mono.
    if (this.pcmSampleRate) {
      if (bytes.byteLength < 2) return
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const sampleCount = Math.floor(view.byteLength / 2)
      const audioBuffer = this.ctx.createBuffer(1, sampleCount, this.pcmSampleRate)
      const channel = audioBuffer.getChannelData(0)
      for (let i = 0; i < sampleCount; i++) {
        const s16 = view.getInt16(i * 2, true)
        channel[i] = s16 / 0x8000
      }

      const source = this.ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(this.ctx.destination)

      const startAt = Math.max(this.ctx.currentTime, this.nextTime || this.ctx.currentTime)
      source.start(startAt)
      this.nextTime = startAt + audioBuffer.duration
      return
    }

    // If we don't know the output format, we still might be receiving raw PCM16 from the backend.
    // Heuristic: if decodeAudioData fails, fall back to PCM16 @ 16kHz (our backend default).
    try {
      const decoded = await this.ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const src = this.ctx.createBufferSource()
      src.buffer = decoded
      src.connect(this.ctx.destination)
      const startAt = Math.max(this.ctx.currentTime, this.nextTime || this.ctx.currentTime)
      src.start(startAt)
      this.nextTime = startAt + decoded.duration
    } catch {
      // PCM16 fallback @ 16kHz mono.
      try {
        if (bytes.byteLength < 2) return
        const sr = 16000
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const sampleCount = Math.floor(view.byteLength / 2)
        const audioBuffer = this.ctx.createBuffer(1, sampleCount, sr)
        const channel = audioBuffer.getChannelData(0)
        for (let i = 0; i < sampleCount; i++) {
          const s16 = view.getInt16(i * 2, true)
          channel[i] = s16 / 0x8000
        }
        const source = this.ctx.createBufferSource()
        source.buffer = audioBuffer
        source.connect(this.ctx.destination)
        const startAt = Math.max(this.ctx.currentTime, this.nextTime || this.ctx.currentTime)
        source.start(startAt)
        this.nextTime = startAt + audioBuffer.duration
      } catch {
        // If decoding fails, drop the chunk (we'll still show transcripts/tool calls).
      }
    }
  }
}

export async function startElevenAgentConversation(handlers: ElevenAgentHandlers): Promise<ElevenAgentController> {
  const wsBase = apiBaseToWsBase(API_BASE_URL)
  const wsUrl = `${wsBase}/ws/agent`
  const speechWsUrl = `${wsBase}/ws/speech`

  handlers.onStatus?.('connecting')

  const ws = new WebSocket(wsUrl)
  ws.binaryType = 'arraybuffer'

  const mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })

  const audioContext = new AudioContext()
  const player = new AudioQueuePlayer(audioContext)
  // Best-effort resume immediately (can still be suspended until user gesture, but Start is a click).
  try {
    if (audioContext.state === 'suspended') await audioContext.resume()
  } catch {
    // ignore
  }

  const source = audioContext.createMediaStreamSource(mediaStream)
  const processor = audioContext.createScriptProcessor(4096, 1, 1)

  let isStopped = false
  // IMPORTANT:
  // When the agent triggers a client tool call (e.g. `print_text`), ElevenLabs can abandon tool execution
  // if it detects new user input (barge-in) while the tool is running. Since we stream mic audio
  // continuously, even background noise can count as "user input".
  //
  // So we pause mic streaming while a tool call is in-flight.
  let inFlightToolCalls = 0
  // After some tool calls (especially voice confirmations), the user will still be finishing
  // the "yes/no" utterance when the tool result is sent. If we immediately resume streaming
  // mic audio to ElevenLabs, that trailing audio can count as new user input (barge-in) and
  // cause the next tool execution (e.g. `print_text`) to be abandoned.
  let agentMicResumeAtMs = 0

  // Hands-free confirmations: we stream the same mic PCM16 to /ws/speech while a tool call is pending,
  // and detect "yes" / "no" locally to resolve confirm_action without requiring UI clicks.
  let speechWs: WebSocket | null = null
  let speechCaptureResolve: ((v: boolean) => void) | null = null
  let speechCaptureReject: ((e: unknown) => void) | null = null
  let speechCaptureTimer: number | null = null

  function closeSpeechWs() {
    try {
      if (speechWs && speechWs.readyState === WebSocket.OPEN) speechWs.send('terminate')
    } catch {
      // ignore
    }
    try {
      speechWs?.close()
    } catch {
      // ignore
    }
    speechWs = null
  }

  function clearSpeechCaptureTimer() {
    if (speechCaptureTimer != null) {
      try {
        window.clearTimeout(speechCaptureTimer)
      } catch {
        // ignore
      }
      speechCaptureTimer = null
    }
  }

  function speakPrompt(text: string) {
    const t = (text || '').trim()
    if (!t) return
    try {
      if (!('speechSynthesis' in window)) return
      // Cancel any queued utterances to keep prompts snappy.
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(t)
      u.rate = 1
      u.pitch = 1
      u.volume = 1
      window.speechSynthesis.speak(u)
    } catch {
      // ignore
    }
  }

  function detectYesNo(transcriptRaw: string): boolean | null {
    const t = (transcriptRaw || '').toLowerCase()
    if (!t.trim()) return null
    // "no" checks first to avoid matching "know"/"no" ambiguity? Keep it simple for now.
    const no = /\b(no|nope|cancel|stop|don't|do not|never)\b/.test(t)
    const yes = /\b(yes|yeah|yep|confirm|confirmed|ok|okay|sure|do it|print it|go ahead)\b/.test(t)
    if (yes && !no) return true
    if (no && !yes) return false
    return null
  }

  async function captureYesNo(opts: { prompt?: string; timeoutMs?: number } = {}): Promise<boolean> {
    const timeoutMs = typeof opts.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : 20000
    const prompt = (opts.prompt || '').trim()

    // If a capture is already active, cancel it (treat as "no") and replace.
    try {
      speechCaptureResolve?.(false)
    } catch {
      // ignore
    }
    speechCaptureResolve = null
    speechCaptureReject = null
    clearSpeechCaptureTimer()
    closeSpeechWs()

    // Tell the user what to do, hands-free.
    if (prompt) speakPrompt(`${prompt} Please say "yes" to confirm, or "no" to cancel.`)

    return await new Promise<boolean>((resolve, reject) => {
      speechCaptureResolve = resolve
      speechCaptureReject = reject

      speechWs = new WebSocket(speechWsUrl)
      speechWs.binaryType = 'arraybuffer'

      speechWs.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        let parsed: any
        try {
          parsed = JSON.parse(event.data)
        } catch {
          return
        }

        if (parsed?.type === 'error') {
          const msg = typeof parsed?.error === 'string' ? parsed.error : 'Speech server error'
          return reject(new Error(msg))
        }

        if (parsed?.type !== 'transcript') return
        const tr = String(parsed?.transcript ?? '').trim()
        const verdict = detectYesNo(tr)
        if (verdict == null) return

        // Resolve and cleanup.
        const r = speechCaptureResolve
        speechCaptureResolve = null
        speechCaptureReject = null
        clearSpeechCaptureTimer()
        closeSpeechWs()
        try {
          r?.(verdict)
        } catch {
          // ignore
        }
      }

      speechWs.onerror = () => reject(new Error('Speech WebSocket error'))

      speechWs.onclose = () => {
        // If it closed before we resolved, treat as "no" (safe default).
        if (speechCaptureResolve) {
          const r = speechCaptureResolve
          speechCaptureResolve = null
          speechCaptureReject = null
          clearSpeechCaptureTimer()
          closeSpeechWs()
          try {
            r(false)
          } catch {
            // ignore
          }
        }
      }

      speechCaptureTimer = window.setTimeout(() => {
        const r = speechCaptureResolve
        speechCaptureResolve = null
        speechCaptureReject = null
        clearSpeechCaptureTimer()
        closeSpeechWs()
        try {
          r?.(false)
        } catch {
          // ignore
        }
      }, timeoutMs)
    })
  }

  function safeError(msg: string) {
    try {
      handlers.onError?.(msg)
    } catch {
      // ignore
    }
  }

  function sendJson(obj: object) {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(obj))
  }

  ws.onopen = () => {
    handlers.onStatus?.('connected')
  }

  ws.onclose = () => {
    handlers.onStatus?.('disconnected')
  }

  ws.onerror = () => {
    safeError('WebSocket error')
  }

  ws.onmessage = async (event) => {
    if (typeof event.data !== 'string') return
    let parsed: ElevenAgentEvent
    try {
      parsed = JSON.parse(event.data) as ElevenAgentEvent
    } catch {
      return
    }

    handlers.onEvent?.(parsed)

    if (parsed.type === 'error') {
      const err = typeof parsed.error === 'string' ? parsed.error : 'Unknown ElevenLabs error'
      safeError(err)
      return
    }

    if (parsed.type === 'conversation_initiation_metadata') {
      const meta = parsed as ElevenConversationInitiationMetadataEvent
      const fmt = meta.conversation_initiation_metadata_event?.agent_output_audio_format
      // Our backend currently emits PCM16 @ 16kHz. Default to 16k if metadata is missing.
      player.setPcmSampleRate(parsePcmSampleRate(fmt) ?? 16000)
      return
    }

    if (parsed.type === 'user_transcript') {
      const t = String(parsed.user_transcription_event?.user_transcript ?? '').trim()
      if (t) handlers.onUserTranscript?.(t)
      return
    }

    if (parsed.type === 'agent_response') {
      const t = String(parsed.agent_response_event?.agent_response ?? '').trim()
      if (t) handlers.onAgentResponse?.(t)
      return
    }

    if (parsed.type === 'audio') {
      const a = parsed as ElevenAudioEvent
      const b64 = String(a.audio_event?.audio_base_64 ?? '')
      await player.playBase64AudioChunk(b64)
      return
    }

    if (parsed.type === 'interruption') {
      // The SDK can emit interruptions (barge-in). Reset queue timing so subsequent audio
      // plays immediately instead of being scheduled behind a now-invalid timeline.
      player.reset()
      return
    }

    if (parsed.type === 'client_tool_call') {
      const toolEvt = parsed as ElevenClientToolCallEvent
      const toolName = String(toolEvt.client_tool_call?.tool_name ?? '')
      const toolCallId = String(toolEvt.client_tool_call?.tool_call_id ?? '')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parameters: any = toolEvt.client_tool_call?.parameters
      if (!toolName || !toolCallId) return

      try {
        inFlightToolCalls++
        const result = await handlers.onClientToolCall?.({ name: toolName, parameters })
        sendJson({ type: 'client_tool_result', tool_call_id: toolCallId, result, is_error: false })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        sendJson({ type: 'client_tool_result', tool_call_id: toolCallId, result: msg, is_error: true })
      } finally {
        inFlightToolCalls = Math.max(0, inFlightToolCalls - 1)
        // Apply a short cooldown before resuming mic audio to ElevenLabs.
        // Longer for confirm_action because the user is actively speaking at that moment.
        const now = Date.now()
        if (toolName === 'confirm_action') agentMicResumeAtMs = Math.max(agentMicResumeAtMs, now + 1200)
        else agentMicResumeAtMs = Math.max(agentMicResumeAtMs, now + 200)
      }
    }
  }

  processor.onaudioprocess = (e) => {
    if (isStopped) return
    if (ws.readyState !== WebSocket.OPEN) return
    const input = e.inputBuffer.getChannelData(0)
    const down = downsampleTo16k(input, audioContext.sampleRate)
    const pcm16 = floatTo16BitPCM(down)
    // Always feed speech capture if active.
    try {
      if (speechWs && speechWs.readyState === WebSocket.OPEN) speechWs.send(pcm16)
    } catch {
      // ignore
    }
    // Only stream to ElevenLabs when no tool call is running (prevents barge-in abandonment).
    if (inFlightToolCalls > 0) return
    if (Date.now() < agentMicResumeAtMs) return
    ws.send(pcm16)
  }

  source.connect(processor)
  processor.connect(audioContext.destination)

  async function stop() {
    if (isStopped) return
    isStopped = true
    player.reset()
    clearSpeechCaptureTimer()
    closeSpeechWs()

    try {
      processor.disconnect()
    } catch {
      // ignore
    }
    try {
      source.disconnect()
    } catch {
      // ignore
    }
    try {
      for (const track of mediaStream.getTracks()) track.stop()
    } catch {
      // ignore
    }
    try {
      await audioContext.close()
    } catch {
      // ignore
    }
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send('terminate')
    } catch {
      // ignore
    }
    try {
      ws.close()
    } catch {
      // ignore
    }
  }

  function sendContextualUpdate(text: string) {
    const t = text.trim()
    if (!t) return
    sendJson({ type: 'contextual_update', text: t })
  }

  return { stop, sendContextualUpdate, captureYesNo }
}



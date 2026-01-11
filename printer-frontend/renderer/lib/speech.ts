import { API_BASE_URL } from './api'

export type SpeechTranscriptMessage = {
  type: 'transcript'
  transcript: string
  end_of_turn: boolean
}

export type SpeechErrorMessage = {
  type: 'error'
  error: string
}

export type SpeechServerMessage = SpeechTranscriptMessage | SpeechErrorMessage

export type SpeechStreamHandlers = {
  onTranscript: (msg: SpeechTranscriptMessage) => void
  onError?: (error: string) => void
  onOpen?: () => void
  onClose?: () => void
}

export type SpeechStreamController = {
  stop: () => Promise<void>
}

function apiBaseToWsBase(apiBaseUrl: string) {
  // http://localhost:6969 -> ws://localhost:6969
  // https://... -> wss://...
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

  // Simple averaging downsample (good enough for speech)
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
    // clamp
    s = Math.max(-1, Math.min(1, s))
    // convert
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}

export async function startSpeechStream(handlers: SpeechStreamHandlers): Promise<SpeechStreamController> {
  const wsBase = apiBaseToWsBase(API_BASE_URL)
  const wsUrl = `${wsBase}/ws/speech`

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
  const source = audioContext.createMediaStreamSource(mediaStream)

  // ScriptProcessor is deprecated but still widely supported and simplest for Electron.
  // Buffer size 4096 gives reasonable latency for live captions.
  const processor = audioContext.createScriptProcessor(4096, 1, 1)

  let isStopped = false

  function safeOnError(msg: string) {
    try {
      handlers.onError?.(msg)
    } catch {
      // ignore
    }
  }

  ws.onopen = () => {
    handlers.onOpen?.()
  }

  ws.onclose = () => {
    handlers.onClose?.()
  }

  ws.onerror = () => {
    safeOnError('WebSocket error')
  }

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return
    try {
      const parsed = JSON.parse(event.data) as SpeechServerMessage
      if (parsed.type === 'transcript') {
        handlers.onTranscript(parsed)
      } else if (parsed.type === 'error') {
        safeOnError(parsed.error)
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      safeOnError(`Failed to parse speech server message: ${err}`)
    }
  }

  processor.onaudioprocess = (e) => {
    if (isStopped) return
    if (ws.readyState !== WebSocket.OPEN) return

    const input = e.inputBuffer.getChannelData(0)
    const down = downsampleTo16k(input, audioContext.sampleRate)
    const pcm16 = floatTo16BitPCM(down)
    ws.send(pcm16)
  }

  // Start audio graph
  source.connect(processor)
  processor.connect(audioContext.destination)

  async function stop() {
    if (isStopped) return
    isStopped = true

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

  return { stop }
}



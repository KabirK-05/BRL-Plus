import Head from 'next/head'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Box,
  Button,
  createIcon,
  Divider,
  Flex,
  HStack,
  Icon,
  IconButton,
  Input,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  Textarea,
  useToast,
} from '@chakra-ui/react'
import {
  AttachmentIcon,
  CheckCircleIcon,
  EditIcon,
  ExternalLinkIcon,
  LinkIcon,
  RepeatIcon,
  SmallCloseIcon,
  ViewIcon
} from '@chakra-ui/icons'

import { Container } from '../components/Container'
import { useApi } from '../lib/api'
import { ElevenAgentController, startElevenAgentConversation } from '../lib/elevenAgent'
import { DEMO_MODE_STORAGE_KEY } from '../components/braille/constants'
import { ConnectorPanel } from '../components/braille/ConnectorPanel'
import { PDFLiveCanvas } from '../components/braille/PDFLiveCanvas'
import { DotPositions } from '../components/braille/types'
import { pausePrint, printDots, resumePrint, stopPrint } from '../components/braille/printerActions'
import { GlassCard } from '../components/glass/GlassCard'
import { GlassShell } from '../components/glass/GlassShell'
import { LottiePrinter } from '../components/LottiePrinter'

const MicIcon = createIcon({
  displayName: 'MicIcon',
  viewBox: '0 0 24 24',
  path: (
    <path
      fill="currentColor"
      d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0a1 1 0 1 0-2 0a7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11a1 1 0 1 0-2 0Z"
    />
  ),
})

export default function HomePage() {
  const toast = useToast()
  const { fetchApi } = useApi()

  const FILE_TAB_INDEX = 1

  const [isConnected, setIsConnected] = useState(false)
  const [demoMode, setDemoMode] = useState(false)

  const [activeTab, setActiveTab] = useState(0)
  const [text, setText] = useState('')
  const [aiFile, setAiFile] = useState<File | null>(null)
  const [aiEnglish, setAiEnglish] = useState('')
  const [isGeneratingEnglish, setIsGeneratingEnglish] = useState(false)

  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [isFetchingYoutube, setIsFetchingYoutube] = useState(false)

  const [isListening, setIsListening] = useState(false)
  const [agentController, setAgentController] = useState<ElevenAgentController | null>(null)
  const [userTranscript, setUserTranscript] = useState('')
  const [agentResponse, setAgentResponse] = useState('')
  const [agentStatus, setAgentStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected')

  const [isProcessing, setIsProcessing] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)

  const [dotPositions, setDotPositions] = useState<DotPositions>([])
  const [currPage, setCurrPage] = useState(0)

  const totalPages = useMemo(() => dotPositions.length, [dotPositions.length])

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const agentControllerRef = useRef<ElevenAgentController | null>(null)
  agentControllerRef.current = agentController
  const uiStateRef = useRef({
    isConnected: false,
    demoMode: false,
    activeTab: 0,
    dotPositionsLength: 0,
    currPage: 0,
    totalPages: 0,
    isPrinting: false,
    aiFileName: '',
    userTranscript: '',
  })
  uiStateRef.current = {
    isConnected,
    demoMode,
    activeTab,
    dotPositionsLength: dotPositions.length,
    currPage,
    totalPages,
    isPrinting,
    aiFileName: aiFile?.name ?? '',
    userTranscript,
  }

  useEffect(() => {
    try {
      const isDemo = window.localStorage.getItem(DEMO_MODE_STORAGE_KEY) === '1'
      setDemoMode(isDemo)
      if (isDemo) setIsConnected(true)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    return () => {
      // Cleanup live agent conversation on unmount
      if (agentControllerRef.current) {
        void agentControllerRef.current.stop()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submitText() {
    if (!text.trim()) return
    setIsProcessing(true)
    try {
      const formData = new FormData()
      formData.append('type', 'text')
      formData.append('text', text)
      const res = await fetchApi('/', { method: 'POST', body: formData })
      if (res) {
        const data: DotPositions = await res.json()
        setDotPositions(data)
        setCurrPage(0)
        toast({
          title: 'Success',
          description: 'Text converted to braille dots.',
          status: 'success',
          duration: 2500,
          isClosable: true,
          position: 'bottom-right',
        })
      }
    } finally {
      setIsProcessing(false)
    }
  }

  async function stopVoiceAgent() {
    const controller = agentController
    setAgentController(null)
    setIsListening(false)
    if (controller) {
      try {
        await controller.stop()
      } catch {
        // ignore
      }
    }
  }

  async function startVoiceAgent() {
    if (isListening) return
    setUserTranscript('')
    setAgentResponse('')
    setIsListening(true)
    setAgentStatus('connecting')

    try {
      const controller = await startElevenAgentConversation({
        onStatus: (s) => setAgentStatus(s),
        onUserTranscript: (t) => {
          setUserTranscript((prev) => (prev ? `${prev} ${t}` : t))
        },
        onAgentResponse: (t) => setAgentResponse(t),
        onClientToolCall: async ({ name, parameters }) => {
          const toolName = (name || '').trim()
          const params = parameters ?? {}
          const s = uiStateRef.current

          // Helpers
          const ok = (result: unknown) => result
          const printFromText = async (textToPrintRaw: string) => {
            const textToPrint = (textToPrintRaw || '').trim()
            if (!textToPrint) {
              return ok({
                started: false,
                error: 'No text provided. Please say what you want to print, like "hello world".',
              })
            }

            // 1) Preview: convert text -> braille dots
            const formData = new FormData()
            formData.append('type', 'text')
            formData.append('text', textToPrint)
            const res = await fetchApi('/', { method: 'POST', body: formData }, { errorTitle: 'Voice print error' })
            if (!res) {
              return ok({ started: false, error: 'Failed to convert text to braille dots.' })
            }

            const data: DotPositions = await res.json().catch(() => [])
            if (!Array.isArray(data) || data.length === 0 || !Array.isArray(data[0]) || data[0].length === 0) {
              return ok({ started: false, error: 'No braille dots were generated for that text.' })
            }

            // Update UI preview for visibility.
            setDotPositions(data)
            setCurrPage(0)
            setActiveTab(0)

            // 2) Print page 1
            if (demoMode) {
              toast({
                title: 'Demo mode',
                description: 'Printer execution is disabled in demo mode.',
                status: 'warning',
                duration: 3500,
                isClosable: true,
                position: 'bottom-right',
              })
              return ok({ started: true, demoMode: true })
            }

            const printRes = await printDots(fetchApi, data[0], { demoMode })
            if (!printRes) {
              return ok({ started: false, error: 'Failed to start print job.' })
            }

            toast({
              title: 'Printing',
              description: 'Printing page 1...',
              status: 'success',
              duration: 2500,
              isClosable: true,
              position: 'bottom-right',
            })

            return ok({ started: true, pages: data.length, usedText: textToPrint })
          }

          if (toolName === 'read_current_screen') {
            return ok({
              connection: { isConnected: s.isConnected, demoMode: s.demoMode },
              ui: {
                activeTabIndex: s.activeTab,
                hasPreview: s.dotPositionsLength > 0,
                currPage: s.currPage + 1,
                totalPages: Math.max(1, s.totalPages),
                isPrinting: s.isPrinting,
                canPrint: !s.demoMode && s.dotPositionsLength > 0,
                selectedFileName: s.aiFileName,
              },
              availableActions: ['print', 'pause', 'resume', 'exit', 'stop'],
            })
          }

          if (toolName === 'confirm_action') {
            const message = String(params?.message ?? params?.prompt ?? 'Confirm?')
            let confirmed = false
            try {
              confirmed = (await agentControllerRef.current?.captureYesNo?.({ prompt: message, timeoutMs: 20000 })) ?? false
            } catch {
              confirmed = false
            }
            return ok({ confirmed })
          }

          if (toolName === 'open_file_picker') {
            // Voice printing does not require file selection; text->braille is sufficient.
            // Keep this tool for dashboard compatibility, but respond with guidance.
            return ok({
              opened: false,
              reason:
                'File picker is not needed for voice printing. Say the text you want to print (e.g. "print hello world"), then confirm to start printing.',
            })
          }

          // User-level job controls only (no mechanical printer settings).
          if (toolName === 'set_print_settings') {
            const action = String(params?.action ?? '').toLowerCase()
            if (action === 'print') await onPrint()
            else if (action === 'pause') await onPause()
            else if (action === 'resume') await onResume()
            else if (action === 'exit') onExit()
            else if (action === 'stop') await onStop()
            return ok({ action })
          }

          if (toolName === 'start_print_job') {
            const raw = String(params?.text ?? params?.content ?? params?.message ?? '').trim()
            const spoken = String(s.userTranscript ?? '').trim()
            return await printFromText(raw || spoken)
          }

          // New explicit tool: print from straight text, no file picker involved.
          // Dashboard tool should define a required string parameter: `text`.
          if (toolName === 'print_text') {
            const raw = String(params?.text ?? params?.content ?? params?.message ?? '').trim()
            const spoken = String(s.userTranscript ?? '').trim()
            return await printFromText(raw || spoken)
          }

          if (toolName === 'cancel_print_job') {
            await onStop()
            return ok({ cancelled: true })
          }

          return ok({ error: `Unknown tool: ${toolName}` })
        },
        onError: (error) => {
          toast({
            title: 'Voice agent error',
            description: error,
            status: 'error',
            duration: 5000,
            isClosable: true,
            position: 'bottom-right',
          })
        },
      })
      setAgentController(controller)
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      toast({
        title: 'Voice agent error',
        description: err,
        status: 'error',
        duration: 5000,
        isClosable: true,
        position: 'bottom-right',
      })
      await stopVoiceAgent()
    }
  }

  async function generateEnglishFromFile() {
    if (!aiFile) return
    setIsGeneratingEnglish(true)
    try {
      const formData = new FormData()
      formData.append('file', aiFile)
      const res = await fetchApi('/describe_file', { method: 'POST', body: formData }, { errorTitle: 'Gemini Error' })
      if (res) {
        const data: { text: string } = await res.json()
        setAiEnglish(data.text ?? '')
        return data.text ?? ''
      }
      return ''
    } finally {
      setIsGeneratingEnglish(false)
    }
  }

  async function generateEnglishFromYoutube() {
    const url = youtubeUrl.trim()
    if (!url) return ''

    setIsFetchingYoutube(true)
    try {
      const res = await fetchApi(
        '/youtube_transcript',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        },
        { errorTitle: 'YouTube Error' }
      )

      if (!res) return ''
      const data: { text?: string } = await res.json()
      const t = (data.text ?? '').trim()
      setAiEnglish(t)
      return t
    } finally {
      setIsFetchingYoutube(false)
    }
  }

  async function previewBrailleFromEnglish(english: string) {
    if (!english.trim()) return
    setIsProcessing(true)
    try {
      const formData = new FormData()
      formData.append('type', 'text')
      formData.append('text', english)
      const res = await fetchApi('/', { method: 'POST', body: formData })
      if (res) {
        const data: DotPositions = await res.json()
        setDotPositions(data)
        setCurrPage(0)
        toast({
          title: 'Braille preview updated',
          description: 'Braille dots were regenerated from the current English text.',
          status: 'success',
          duration: 2500,
          isClosable: true,
          position: 'bottom-right',
        })
      }
    } finally {
      setIsProcessing(false)
    }
  }

  async function previewFromAiFile() {
    if (!aiFile) return
    try {
      const english = await generateEnglishFromFile()
      const finalEnglish = (english ?? '').trim()
      if (!finalEnglish) return
      await previewBrailleFromEnglish(finalEnglish)
    } finally {
      // generateEnglishFromFile / previewBrailleFromEnglish manage their own loading flags
    }
  }

  async function onPrint() {
    if (!dotPositions[currPage]) return
    if (demoMode) {
      toast({
        title: 'Demo mode',
        description: 'Printer execution is disabled in demo mode.',
        status: 'warning',
        duration: 3500,
        isClosable: true,
        position: 'bottom-right',
      })
      return
    }

    setIsPrinting(true)
    try {
      const res = await printDots(fetchApi, dotPositions[currPage], { demoMode })
      if (res) {
        toast({
          title: 'Printing',
          description: `Page ${currPage + 1} is printing...`,
          status: 'success',
          duration: 2500,
          isClosable: true,
          position: 'bottom-right',
        })
      }
    } finally {
      setIsPrinting(false)
    }
  }

  function blockPrinterAction(name: string) {
    toast({
      title: 'Demo mode',
      description: `${name} is disabled in demo mode.`,
      status: 'warning',
      duration: 3500,
      isClosable: true,
      position: 'bottom-right',
    })
  }

  async function onStop() {
    if (demoMode) return blockPrinterAction('STOP')
    await stopPrint(fetchApi, { demoMode })
  }

  async function onPause() {
    if (demoMode) return blockPrinterAction('PAUSE')
    await pausePrint(fetchApi, { demoMode })
  }

  async function onResume() {
    if (demoMode) return blockPrinterAction('RESUME')
    await resumePrint(fetchApi, { demoMode })
  }

  function onExit() {
    setDotPositions([])
    setCurrPage(0)
  }

  return (
    <>
      <Head>
        <title>BRL+</title>
      </Head>

      <GlassShell>
        <Container minH="100vh" px={{ base: 5, md: 10 }} py={{ base: 8, md: 12 }} bg="transparent">
          <Flex direction={{ base: 'column', lg: 'row' }} gap={{ base: 10, lg: 12 }} w="full" maxW="1200px" mx="auto">
          {/* Left column: marketing */}
          <Stack flex={{ base: '1 1 auto', lg: '0.85 1 0%' }} spacing={6} pt={{ base: 0, lg: 4 }}>
            <Stack spacing={12}>
              <Stack spacing={6}>
                <Text fontSize={{ base: '4xl', md: '5xl' }} fontWeight={250} letterSpacing="-0.03em" lineHeight="1.05">
                  World&apos;s most accessible{' '}
                  <Box as="span" color="glass.ink">
                    braille printer ever made.
                  </Box>
                </Text>
                <Text fontSize="md" color="app.muted" maxW="520px">
                  Use Dot Flow to convert text, files, Youtube videos, and voice to printable braille - all at home on your 3D printer.
                </Text>
              </Stack>
            </Stack>

            <HStack spacing={0} align="stretch" maxW="560px">
              <Stack flex="1" spacing={0.5} pr={6}>
                <Text fontSize="3xl" fontWeight={800} color="rgba(34,197,94,0.95)" lineHeight="1">
                  100×
                </Text>
                <Text fontSize="sm" color="app.muted">
                  Less expensive
                </Text>
              </Stack>

              <Divider orientation="vertical" borderColor="rgba(15,23,42,0.14)" />

              <Stack flex="1" spacing={0.5} px={6}>
                <Text fontSize="3xl" fontWeight={700} color="glass.ink" lineHeight="1">
                  1
                </Text>
                <Text fontSize="sm" color="app.muted">
                  Minute per page
                </Text>
              </Stack>

              <Divider orientation="vertical" borderColor="rgba(15,23,42,0.14)" />

              <Stack flex="1" spacing={0.5} pl={6}>
                <Text fontSize="3xl" fontWeight={700} color="glass.ink" lineHeight="1">
                  Live
                </Text>
                <Text fontSize="sm" color="app.muted">
                  Braille preview
                </Text>
              </Stack>
            </HStack>

            <Flex
              gap={3}
              align={{ base: 'stretch', md: 'center' }}
              direction={{ base: 'column', md: 'row' }}
              maxW="640px"
            >
              <GlassCard px={4} py={4} flex="1">
                <Stack spacing={2}>
                  <HStack spacing={2}>
                    <Icon as={CheckCircleIcon} boxSize={4} color="rgba(34,197,94,0.95)" />
                    <Text fontWeight={600} color="glass.ink">
                      Quick start
                    </Text>
                  </HStack>
                  <HStack
                    spacing={2}
                    flexWrap="nowrap"
                    overflowX="auto"
                    overflowY="hidden"
                    w="full"
                    align="center"
                  >
                    <Badge
                      flex="0 0 auto"
                      borderRadius="pill"
                      px={3}
                      py={1}
                      fontSize="xs"
                      bg="rgba(124,58,237,0.10)"
                      borderWidth="1px"
                      borderColor="rgba(124,58,237,0.16)"
                    >
                      Paste text
                    </Badge>
                    <Badge
                      flex="0 0 auto"
                      borderRadius="pill"
                      px={3}
                      py={1}
                      fontSize="xs"
                      bg="rgba(34,197,94,0.10)"
                      borderWidth="1px"
                      borderColor="rgba(34,197,94,0.16)"
                    >
                      Upload image
                    </Badge>
                    <Badge
                      flex="0 0 auto"
                      borderRadius="pill"
                      px={3}
                      py={1}
                      fontSize="xs"
                      bg="rgba(34, 148, 197, 0.10)"
                      borderWidth="1px"
                      borderColor="rgba(34, 148, 197, 0.18)"
                    >
                      Paste youtube link
                    </Badge>
                  </HStack>
                </Stack>
              </GlassCard>

              <Flex
                justify="center"
                align="center"
                minW={{ base: 'auto', md: '190px' }}
              >
                <LottiePrinter />
              </Flex>
            </Flex>
          </Stack>

          {/* Right column: app card */}
          <GlassCard
            flex={{ base: '1 1 auto', lg: '1.25 1 0%' }}
            p={{ base: 6, md: 8 }}
            strength="strong"
            // Add a subtle green glow underneath for a bit of color (like the reference).
            boxShadow="0 26px 50px rgba(2, 6, 23, 0.14), 0 24px 50px rgba(34, 197, 94, 0.16)"
          >
            <Stack spacing={6}>
              <HStack justify="space-between" align="start">
                <Stack spacing={1}>
                  <HStack spacing={2}>
                    {/* <Box
                      w="10px"
                      h="10px"
                      borderRadius="full"
                      bgGradient="linear(to-br, #7C3AED, #EC4899)"
                      boxShadow="0 10px 22px rgba(124,58,237,0.22)"
                      mt="7px"
                    /> */}
                    <Text fontSize="xl" fontWeight={700} letterSpacing="-0.02em">
                      BRL +
                    </Text>
                  </HStack>
                  <Text fontSize="sm" color="app.muted">
                    Convert anything to braille dots
                  </Text>
                </Stack>

                <HStack spacing={3}>
                  <Badge
                    borderRadius="pill"
                    px={3}
                    py={1}
                    bg={isConnected ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.45)'}
                    color="glass.ink"
                    borderWidth="1px"
                    borderColor="glass.border"
                  >
                    <HStack spacing={2}>
                      <Box
                        w="8px"
                        h="8px"
                        borderRadius="full"
                        bg={isConnected ? (demoMode ? 'rgba(34,197,94,0.85)' : 'rgba(34,197,94,0.85)') : 'rgba(100,116,139,0.65)'}
                        boxShadow={isConnected ? '0 0 0 3px rgba(34,197,94,0.14)' : 'none'}
                      />
                      <Box as="span">{isConnected ? (demoMode ? 'Demo' : 'Connected') : 'Offline'}</Box>
                    </HStack>
                  </Badge>
                  {demoMode && (
                    <IconButton
                      aria-label="Exit demo mode"
                      variant="ghost"
                      onClick={() => {
                        try {
                          window.localStorage.removeItem(DEMO_MODE_STORAGE_KEY)
                        } catch {
                          // ignore
                        }
                        setDemoMode(false)
                        setIsConnected(false)
                        setDotPositions([])
                        setCurrPage(0)
                      }}
                      icon={<Icon as={RepeatIcon} />}
                      title="Exit demo mode"
                    />
                  )}
                </HStack>
              </HStack>

              <Divider borderColor="glass.border" />

              <ConnectorPanel
                isConnected={isConnected}
                setIsConnected={setIsConnected}
                demoMode={demoMode}
                setDemoMode={setDemoMode}
              />

              <Divider borderColor="glass.border" />

              {isConnected && (
                <Stack spacing={4}>
                  <Tabs index={activeTab} onChange={(idx) => setActiveTab(idx)} variant="soft-rounded">
                    <TabList gap={2}>
                      <Tab borderRadius="12px">
                        <HStack spacing={2}>
                          <Icon as={EditIcon} boxSize={4} />
                          <Box as="span">Text</Box>
                        </HStack>
                      </Tab>
                      <Tab borderRadius="12px">
                        <HStack spacing={2}>
                          <Icon as={AttachmentIcon} boxSize={4} />
                          <Box as="span">File</Box>
                        </HStack>
                      </Tab>
                      <Tab borderRadius="12px">
                        <HStack spacing={2}>
                          <Icon as={LinkIcon} boxSize={4} />
                          <Box as="span">YouTube</Box>
                        </HStack>
                      </Tab>
                      <Tab borderRadius="12px">
                        <HStack spacing={2}>
                          <Icon as={MicIcon} boxSize={4} />
                          <Box as="span">Voice</Box>
                        </HStack>
                      </Tab>
                    </TabList>
                    <TabPanels pt={4}>
                      <TabPanel px={0}>
                        <Stack spacing={3}>
                          <Textarea
                            value={text}
                            onChange={(e) => {
                              setText(e.target.value)
                              if (e.target.value) {
                                setAiFile(null)
                                setAiEnglish('')
                                setYoutubeUrl('')
                              setUserTranscript('')
                              setAgentResponse('')
                              }
                            }}
                            placeholder="Paste or type text here…"
                            minH="150px"
                          />
                          <HStack justify="flex-end">
                            <Button
                              leftIcon={<Icon as={ViewIcon} />}
                              bg="glass.ink"
                              color="white"
                              _hover={{ bg: 'rgba(17, 24, 39, 0.88)' }}
                              _active={{ bg: 'rgba(17, 24, 39, 0.80)' }}
                              onClick={submitText}
                              isDisabled={!text.trim() || isProcessing}
                            >
                              Preview
                            </Button>
                          </HStack>
                        </Stack>
                      </TabPanel>

                      <TabPanel px={0}>
                        <Stack spacing={3}>
                          <GlassCard p={4}>
                            <Stack spacing={2}>
                              <Text fontSize="sm" color="app.muted">
                                Upload a PNG / JPG / PDF, generate an English description, then edit it before previewing braille.
                              </Text>
                              <input
                                ref={fileInputRef}
                                type="file"
                                accept=".png,.jpg,.jpeg,.pdf"
                                onChange={(e) => {
                                  const file = e.target.files?.[0] ?? null
                                  setAiFile(file)
                                  setAiEnglish('')
                                  setYoutubeUrl('')
                                }}
                              />
                              {aiFile && (
                                <Text fontSize="sm" color="app.muted">
                                  Selected: {aiFile.name}
                                </Text>
                              )}
                            </Stack>
                          </GlassCard>
                          <HStack justify="flex-end" spacing={3}>
                            <Button
                              leftIcon={<Icon as={ViewIcon} />}
                              bg="glass.ink"
                              color="white"
                              _hover={{ bg: 'rgba(17, 24, 39, 0.88)' }}
                              _active={{ bg: 'rgba(17, 24, 39, 0.80)' }}
                              onClick={previewFromAiFile}
                              isDisabled={!aiFile || isGeneratingEnglish || isProcessing}
                              isLoading={isGeneratingEnglish || isProcessing}
                            >
                              Preview
                            </Button>
                          </HStack>
                        </Stack>
                      </TabPanel>

                      <TabPanel px={0}>
                        <Stack spacing={3}>
                          <Text fontSize="sm" color="app.muted">
                            Paste a YouTube link, fetch the transcript, then preview braille.
                          </Text>
                          <Input
                            value={youtubeUrl}
                            onChange={(e) => {
                              setYoutubeUrl(e.target.value)
                              if (e.target.value) {
                                setAiFile(null)
                                setAiEnglish('')
                                setText('')
                              }
                            }}
                            placeholder="https://www.youtube.com/watch?v=..."
                          />
                          <HStack justify="flex-end" spacing={3}>
                            <Button
                              leftIcon={<Icon as={ExternalLinkIcon} />}
                              bg="glass.ink"
                              color="white"
                              _hover={{ bg: 'rgba(17, 24, 39, 0.88)' }}
                              _active={{ bg: 'rgba(17, 24, 39, 0.80)' }}
                              onClick={async () => {
                                // Ensure mic isn’t streaming while doing a YouTube fetch
                                if (isListening) await stopVoiceAgent()
                                const english = await generateEnglishFromYoutube()
                                if (!english.trim()) return
                                await previewBrailleFromEnglish(english)
                              }}
                              isDisabled={!youtubeUrl.trim() || isFetchingYoutube || isProcessing}
                              isLoading={isFetchingYoutube || isProcessing}
                            >
                              Import + Preview
                            </Button>
                          </HStack>
                        </Stack>
                      </TabPanel>

                      <TabPanel px={0}>
                        <Stack spacing={3}>
                          <Text fontSize="sm" color="app.muted">
                            Click Start, speak clearly, then Stop. You can edit the transcript before previewing braille.
                          </Text>

                          <HStack spacing={3} justify="flex-end">
                            {!isListening ? (
                              <Button leftIcon={<Icon as={CheckCircleIcon} />} onClick={startVoiceAgent} isDisabled={isProcessing}>
                                Start
                              </Button>
                            ) : (
                              <Button leftIcon={<Icon as={SmallCloseIcon} />} variant="outline" onClick={stopVoiceAgent}>
                                Stop
                              </Button>
                            )}
                            <Button
                              leftIcon={<Icon as={ViewIcon} />}
                              bg="glass.ink"
                              color="white"
                              _hover={{ bg: 'rgba(17, 24, 39, 0.88)' }}
                              _active={{ bg: 'rgba(17, 24, 39, 0.80)' }}
                              onClick={async () => {
                                if (isListening) await stopVoiceAgent()
                                await previewBrailleFromEnglish(userTranscript)
                              }}
                              isDisabled={!userTranscript.trim() || isProcessing}
                              isLoading={isProcessing}
                            >
                              Preview
                            </Button>
                          </HStack>

                          <Textarea
                            value={userTranscript}
                            onChange={(e) => {
                              // Allow editing when not actively listening
                              if (isListening) return
                              setUserTranscript(e.target.value)
                            }}
                            isReadOnly={isListening}
                            placeholder="Transcript will appear here…"
                            minH="150px"
                          />

                          {agentResponse.trim().length > 0 && (
                            <GlassCard p={4} strength="strong">
                              <Stack spacing={2}>
                                <Text fontSize="sm" color="app.muted">
                                  Agent
                                </Text>
                                <Text fontSize="sm">{agentResponse}</Text>
                              </Stack>
                            </GlassCard>
                          )}

                          {isListening && (
                            <HStack>
                              <Spinner size="sm" />
                              <Text fontSize="sm" color="app.muted">
                                Listening… ({agentStatus})
                              </Text>
                            </HStack>
                          )}
                        </Stack>
                      </TabPanel>
                    </TabPanels>
                  </Tabs>

                  {isProcessing && (
                    <HStack>
                      <Spinner size="sm" />
                      <Text fontSize="sm" color="app.muted">
                        Processing…
                      </Text>
                    </HStack>
                  )}
                  {dotPositions.length > 0 && (
                    <Stack spacing={4}>
                      {aiEnglish.length > 0 && (
                        <GlassCard p={4} strength="strong">
                          <Stack spacing={2}>
                            <Text fontWeight={500}>Editable preview</Text>
                            <Textarea
                              value={aiEnglish}
                              onChange={(e) => setAiEnglish(e.target.value)}
                              placeholder="Gemini output will appear here…"
                              minH="140px"
                            />
                            <HStack justify="flex-end">
                              <Button
                                bg="glass.ink"
                                color="white"
                                _hover={{ bg: 'rgba(17, 24, 39, 0.88)' }}
                                _active={{ bg: 'rgba(17, 24, 39, 0.80)' }}
                                onClick={() => previewBrailleFromEnglish(aiEnglish)}
                                isDisabled={!aiEnglish.trim() || isProcessing}
                                isLoading={isProcessing}
                              >
                                Update braille preview
                              </Button>
                            </HStack>
                          </Stack>
                        </GlassCard>
                      )}
                      <HStack justify="space-between">
                        <Button variant="outline" onClick={() => setCurrPage((p) => Math.max(0, p - 1))} isDisabled={currPage <= 0}>
                          Previous
                        </Button>
                        <Text fontSize="sm" color="app.muted">
                          Page {currPage + 1} / {Math.max(1, totalPages)}
                        </Text>
                        <Button
                          variant="outline"
                          onClick={() => setCurrPage((p) => Math.min(dotPositions.length - 1, p + 1))}
                          isDisabled={currPage >= dotPositions.length - 1}
                        >
                          Next
                        </Button>
                      </HStack>

                      <PDFLiveCanvas page={currPage} dotPositions={dotPositions} disablePolling={demoMode} />

                      <Flex gap={3} wrap="wrap" justify="space-between">
                        <HStack spacing={3}>
                          <Button
                            leftIcon={<Icon as={CheckCircleIcon} />}
                            bg="glass.ink"
                            color="white"
                            _hover={{ bg: 'rgba(17, 24, 39, 0.88)' }}
                            _active={{ bg: 'rgba(17, 24, 39, 0.80)' }}
                            onClick={onPrint}
                            isDisabled={isPrinting}
                          >
                            Print
                          </Button>
                          <Button
                            leftIcon={<Icon as={SmallCloseIcon} />}
                            variant="outline"
                            onClick={onStop}
                            colorScheme="red"
                          >
                            STOP
                          </Button>
                          <Button leftIcon={<Icon as={RepeatIcon} />} variant="outline" onClick={onPause} colorScheme="yellow">
                            PAUSE
                          </Button>
                          <Button leftIcon={<Icon as={RepeatIcon} />} variant="outline" onClick={onResume} colorScheme="green">
                            RESUME
                          </Button>
                        </HStack>
                        <Button variant="ghost" onClick={onExit}>
                          Exit
                        </Button>
                      </Flex>
                    </Stack>
                  )}
                </Stack>
              )}
            </Stack>
          </GlassCard>
        </Flex>
          </Container>
        </GlassShell>
    </>
  )
}

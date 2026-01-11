import {
  Badge,
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Select,
  Stack,
  Text,
} from '@chakra-ui/react'
import { useEffect, useMemo, useState } from 'react'
import { useApi } from '../../lib/api'
import { DEMO_MODE_STORAGE_KEY } from './constants'

export type ConnectorPanelProps = {
  isConnected: boolean
  setIsConnected: (connected: boolean) => void
  demoMode: boolean
  setDemoMode: (demo: boolean) => void
}

export function ConnectorPanel({
  isConnected,
  setIsConnected,
  demoMode,
  setDemoMode,
}: ConnectorPanelProps) {
  const { fetchApi } = useApi()
  const [loading, setLoading] = useState(false)

  const [portsLoading, setPortsLoading] = useState(false)
  const [ports, setPorts] = useState<Array<{ label: string; value: string }>>([])
  const baudRates = useMemo(
    () => [
      '9600',
      '14400',
      '19200',
      '28800',
      '38400',
      '57600',
      '115200',
      '230400',
      '250000',
      '500000',
      '921600',
      '1000000',
    ],
    []
  )

  const [port, setPort] = useState('')
  const [baudRate, setBaudRate] = useState('250000')

  const portOptions = useMemo(() => {
    if (!port) return ports
    if (ports.some((p) => p.value === port)) return ports
    return [{ label: `Custom: ${port}`, value: port }, ...ports]
  }, [port, ports])

  async function refreshPorts() {
    setPortsLoading(true)
    try {
      const res = await fetchApi('/ports', { method: 'GET' }, { errorTitle: 'Port Scan Error' })
      if (!res) return
      const data = (await res.json().catch(() => null)) as any
      const raw = Array.isArray(data?.ports) ? data.ports : []

      const nextPorts = raw
        .map((p: any) => {
          const device = typeof p?.device === 'string' ? p.device : ''
          if (!device) return null
          const description = typeof p?.description === 'string' ? p.description : ''
          const label = description ? `${description} (${device})` : device
          return { label, value: device }
        })
        .filter(Boolean) as Array<{ label: string; value: string }>

      setPorts(nextPorts)
      // If nothing is selected yet, prefer the first discovered port.
      if (!port && nextPorts[0]?.value) setPort(nextPorts[0].value)
    } finally {
      setPortsLoading(false)
    }
  }

  useEffect(() => {
    try {
      const isDemo = window.localStorage.getItem(DEMO_MODE_STORAGE_KEY) === '1'
      setDemoMode(isDemo)
      if (isDemo) setIsConnected(true)
    } catch {
      // ignore
    }

    // Best-effort port scan on load (non-demo).
    refreshPorts().catch(() => {
      // ignore - errors are already toasted by fetchApi
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connect() {
    setLoading(true)
    try {
      // Leaving demo mode implies real connect intent
      try {
        window.localStorage.removeItem(DEMO_MODE_STORAGE_KEY)
      } catch {
        // ignore
      }
      setDemoMode(false)

      const res = await fetchApi('/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port, baudRate: parseInt(baudRate, 10) }),
      })
      if (res) setIsConnected(true)
    } finally {
      setLoading(false)
    }
  }

  async function disconnect() {
    if (demoMode) {
      try {
        window.localStorage.removeItem(DEMO_MODE_STORAGE_KEY)
      } catch {
        // ignore
      }
      setDemoMode(false)
      setIsConnected(false)
      return
    }

    setLoading(true)
    try {
      const res = await fetchApi('/disconnect', { method: 'POST' })
      if (res) setIsConnected(false)
    } finally {
      setLoading(false)
    }
  }

  if (isConnected) {
    return (
      <HStack justify="space-between" w="full">
        <HStack spacing={3}>
          <Badge
            borderRadius="pill"
            px={3}
            py={1}
            bg={demoMode ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.45)'}
            color="glass.ink"
            borderWidth="1px"
            borderColor="glass.border"
          >
            {demoMode ? 'Demo mode' : 'Connected'}
          </Badge>
          <Text fontSize="sm" color="app.muted">
            {demoMode ? 'printer execution OFF' : `Port ${port} @ ${baudRate}`}
          </Text>
        </HStack>
        <Button variant="outline" onClick={disconnect} isLoading={loading}>
          Disconnect
        </Button>
      </HStack>
    )
  }

  return (
    <Stack spacing={4} w="full">
      <Box>
        <Text fontWeight="semibold" fontSize="sm">
          Connect printer
        </Text>
        <Text fontSize="sm" color="app.muted">
          Choose a serial port and baud rate to enable printing. Or use demo mode to safely test the UI.
        </Text>
      </Box>

      <HStack align="start" spacing={4} flexWrap="wrap">
        <FormControl minW="320px" maxW="420px">
          <FormLabel fontSize="sm" color="app.muted">
            <HStack justify="space-between">
              <Text>Port</Text>
              <Button size="xs" variant="outline" onClick={refreshPorts} isLoading={portsLoading}>
                Refresh
              </Button>
            </HStack>
          </FormLabel>
          <Select
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder={portsLoading ? 'Scanning…' : 'Select a port'}
            bg="glass.bgStrong"
            borderColor="glass.border"
          >
            {portOptions.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          <Text mt={2} fontSize="xs" color="app.muted">
            Tip (macOS): prefer <code>/dev/cu.usbserial-110</code> over <code>/dev/tty.usbserial-110</code>
          </Text>
          <Input
            mt={2}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="/dev/tty.usbserial-110"
            bg="glass.bgStrong"
            borderColor="glass.border"
            fontSize="sm"
          />
        </FormControl>

        <FormControl minW="200px" maxW="240px">
          <FormLabel fontSize="sm" color="app.muted">
            Baud rate
          </FormLabel>
          <Select
            value={baudRate}
            onChange={(e) => setBaudRate(e.target.value)}
            bg="glass.bgStrong"
            borderColor="glass.border"
          >
            {baudRates.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </FormControl>
      </HStack>

      <HStack spacing={3}>
        <Button onClick={connect} isLoading={loading} isDisabled={!port || !baudRate}>
          Connect
        </Button>
        <Button
          variant="soft-rounded"
          onClick={() => {
            try {
              window.localStorage.setItem(DEMO_MODE_STORAGE_KEY, '1')
            } catch {
              // ignore
            }
            setDemoMode(true)
            setIsConnected(true)
          }}
        >
          Demo mode
        </Button>
      </HStack>
    </Stack>
  )
}



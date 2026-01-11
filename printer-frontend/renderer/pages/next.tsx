import React from 'react'
import Head from 'next/head'
import { Button, Link as ChakraLink, Stack, Text } from '@chakra-ui/react'

import { Container } from '../components/Container'

export default function NextPage() {
  return (
    <React.Fragment>
      <Head>
        <title>About - BrailleBot</title>
      </Head>
      <Container minHeight="100vh" px={{ base: 5, md: 10 }} py={{ base: 8, md: 12 }}>
        <Stack
          w="full"
          maxW="720px"
          mx="auto"
          bg="app.surface"
          borderWidth="1px"
          borderColor="app.border"
          borderRadius="card"
          p={{ base: 5, md: 7 }}
          shadow="card"
          spacing={4}
        >
          <Text fontSize="2xl" fontWeight="bold">
            BrailleBot
          </Text>
          <Text color="app.muted">
            This is a lightweight desktop UI for converting text/PDFs into braille dot positions and previewing the output.
          </Text>
          <Button
            as={ChakraLink}
            href="/home"
            variant="outline"
            width="fit-content"
          >
            Go to home page
          </Button>
        </Stack>
      </Container>
    </React.Fragment>
  )
}

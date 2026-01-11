<p align="center">
<img src="https://i.imgur.com/oahHuxG.png">
<img src="https://i.imgur.com/sZ01Nyl.png">
</p>

## Usage

### Create an App

```
# with npx
$ npx create-nextron-app my-app --example with-chakra-ui

# with yarn
$ yarn create nextron-app my-app --example with-chakra-ui

# with pnpm
$ pnpm dlx create-nextron-app my-app --example with-chakra-ui
```

### Install Dependencies

```
$ cd my-app

# using yarn or npm
$ yarn (or `npm install`)

# using pnpm
$ pnpm install --shamefully-hoist
```

### Use it

```
# development mode
$ yarn dev (or `npm run dev` or `pnpm run dev`)

# production build
$ yarn build (or `npm run build` or `pnpm run build`)
```

## Voice agent (ElevenLabs Agents)
The Voice tab uses the backend WebSocket bridge at `/ws/agent`. Ensure the backend is running and has:

```bash
export ELEVENLABS_AGENT_ID="your_public_agent_id"
```

/**
 * Creates a new LLMlin document pre-configured with a skill folder entry
 * and prints its Automerge URL.
 *
 * Usage:
 *   node scripts/create-llmlin.mjs [skillFolderUrl] [syncServerUrl]
 *
 * Defaults:
 *   skillFolderUrl  automerge:2J12X8sUQ2ShNUHXG9QD4ezdRoby
 *   syncServerUrl   wss://sync3.automerge.org
 */

import { Repo } from '@automerge/automerge-repo'
import { WebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'

const SKILL_FOLDER_URL  = process.argv[2] ?? 'automerge:2J12X8sUQ2ShNUHXG9QD4ezdRoby'
const SYNC_SERVER       = process.argv[3] ?? 'wss://sync3.automerge.org'
const DEFAULT_MODEL     = 'anthropic/claude-sonnet-4-5'
const DEFAULT_API_URL   = 'https://openrouter.ai/api/v1'

async function main() {
  const repo = new Repo({
    network: [new WebSocketClientAdapter(SYNC_SERVER)],
    peerId: `create-llmlin-${Math.round(Math.random() * 100_000)}`,
  })

  // Wait for the sync connection to be ready
  await new Promise(resolve => setTimeout(resolve, 1500))

  const handle = repo.create()

  handle.change(doc => {
    // Patchwork metadata
    doc['@patchwork'] = {
      type: 'llmlin',
    }

    // LLMlin document structure (mirrors LLMlinDatatype.init)
    doc.readDocUrls    = [SKILL_FOLDER_URL]
    doc.writeDocUrls   = []
    doc.prompt         = ''
    doc.model          = DEFAULT_MODEL
    doc.apiUrl         = DEFAULT_API_URL
    doc.watchedDocUrls = []
    doc.output         = []
    doc.running        = false
  })

  // Wait for sync to propagate
  await new Promise(resolve => setTimeout(resolve, 2000))

  console.log('\nCreated LLMlin document:')
  console.log('  URL:          ', handle.url)
  console.log('  Skill folder: ', SKILL_FOLDER_URL)
  console.log('  Model:        ', DEFAULT_MODEL)
  console.log()

  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

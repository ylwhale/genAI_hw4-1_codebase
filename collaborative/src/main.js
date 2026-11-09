import './style.css'
import { createGame } from './app/game.js'
import { showFatalError } from './ui/screens.js'

// Storage access can throw in privacy modes; play still works without saving.
function getStorage() {
  try {
    const storage = window.localStorage
    storage.getItem('voxel-grove:probe')
    return storage
  } catch {
    return null
  }
}

function start() {
  const uiRoot = document.querySelector('#ui')
  try {
    return createGame({ appRoot: document.querySelector('#app'), uiRoot, storage: getStorage() })
  } catch (error) {
    console.error('Voxel Grove failed to start:', error)
    showFatalError(uiRoot, error)
    return null
  }
}

const game = start()

// Development-only handle for scripted browser checks.
if (import.meta.env.DEV && game) window.__voxelGrove = game

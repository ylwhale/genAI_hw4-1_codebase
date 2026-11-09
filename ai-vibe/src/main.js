import './style.css';
import { Game } from './Game.js';

const root = document.getElementById('app');

try {
  new Game(root).start();
} catch (error) {
  console.error(error);
  const message = document.createElement('div');
  message.className = 'fatal';
  message.textContent =
    'Voxel Grove could not start. It needs a browser with WebGL enabled (a recent Chrome, Edge, or Firefox).';
  root.appendChild(message);
}

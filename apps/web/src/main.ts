import { mount } from 'svelte';
import './styles/tokens.css';
import App from './App.svelte';

// ?mood=velvet in the link wins; otherwise the mood this device used last time.
let mood = new URLSearchParams(location.search).get('mood');
try {
  mood ??= localStorage.getItem('cp:mood');
} catch {
  /* storage blocked */
}
if (mood) document.documentElement.dataset.mood = mood;

export default mount(App, { target: document.getElementById('app')! });

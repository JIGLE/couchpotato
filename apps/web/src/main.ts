import { mount } from 'svelte';
import './styles/tokens.css';
import App from './App.svelte';

const mood = new URLSearchParams(location.search).get('mood');
if (mood) document.documentElement.dataset.mood = mood;

export default mount(App, { target: document.getElementById('app')! });

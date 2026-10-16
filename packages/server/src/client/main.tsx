import { render } from 'preact';
import { App } from './app.js';
import { captureTokenFromLocation } from './auth.js';

captureTokenFromLocation();

const root = document.getElementById('app');
if (root) render(<App />, root);

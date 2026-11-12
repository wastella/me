const { contextBridge, ipcRenderer } = require('electron');
// Marks the page as running inside the desktop app (for title-bar spacing).
window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('desktop'));
// Lets the Notes mic button start macOS Dictation in the focused field.
contextBridge.exposeInMainWorld('meDesktop', { dictate: () => ipcRenderer.send('me:dictate') });

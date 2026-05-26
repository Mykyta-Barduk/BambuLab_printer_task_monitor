import axios from 'axios';

const isProd = window.location.hostname !== 'localhost';
const baseURL = isProd 
    ? 'https://safely-hurling-polyester.ngrok-free.dev'
    : 'http://localhost:5000';

console.log('API baseURL:', baseURL); // ← тимчасово

export const api = axios.create({
  baseURL,
  headers: {
    'ngrok-skip-browser-warning': 'true',
  },
});
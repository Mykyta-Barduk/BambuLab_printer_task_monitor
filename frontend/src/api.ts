import axios from 'axios';

const isProd = window.location.hostname !== 'localhost';

export const api = axios.create({
  baseURL: isProd 
    ? 'https://safely-hurling-polyester.ngrok-free.app'
    : 'http://localhost:5000',
  headers: {
    'ngrok-skip-browser-warning': 'true',
  },
});
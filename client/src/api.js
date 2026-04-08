import axios from "axios";

export const API_BASE =
  process.env.REACT_APP_API_BASE_URL || "https://chat-app-98qi.onrender.com";

export const api = axios.create({
  baseURL: API_BASE,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");

  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

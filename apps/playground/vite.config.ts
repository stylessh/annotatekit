import { defineConfig } from "vite";

// Top-level await picks the backend before the overlay mounts.
export default defineConfig({ build: { target: "es2022" } });

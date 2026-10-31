import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React app lives in client/. During development Vite serves it on :5173 and forwards
// API and slide tile requests to the Express server; "npm run build" writes client/dist,
// which Express serves in production.
const apiTarget = `http://localhost:${process.env.PORT || 3000}`;

export default defineConfig({
    root: 'client',
    plugins: [react()],
    server: {
        port: 5173,
        // Every path Express serves itself; anything else gets the React app.
        proxy: {
            '/api': apiTarget,
            '/slides': apiTarget,
            '/share-tiles': apiTarget,
            '/branding': apiTarget,
            '/img': apiTarget,
        },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        chunkSizeWarningLimit: 1500,
    },
});

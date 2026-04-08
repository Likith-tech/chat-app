# Project Guidelines

## Code Style
- JavaScript/React: Use modern ES6+ syntax, hooks for state management
- Backend: Express with async/await, consistent error handling
- Reference: [client/src/Chat.js](client/src/Chat.js) for component patterns, [server/server.js](server/server.js) for API structure

## Architecture
- **Frontend**: React app with Socket.io client for real-time messaging, WebRTC for video calls
- **Backend**: Express server with MySQL database, auto-schema creation on startup
- **Communication**: REST API for CRUD operations, WebSocket for real-time events (messages, typing, calls)
- **File Storage**: Disk-based uploads in `server/uploads/`, served as static files
- **Auth**: JWT tokens (7-day expiry) with bcrypt password hashing

## Build and Test
- **Client**: `npm start` (dev server port 3000), `npm run build` (production build), `npm test` (Jest)
- **Server**: `node server.js` (starts on port 5000)
- Install dependencies: Run `npm install` in both `client/` and `server/` directories

## Conventions
- **Passwords**: Must be 8+ characters with uppercase, lowercase, digit, and special character
- **Status Privacy**: Levels 'everyone' (public) or 'contacts' (restricted); enforced server-side in `/statuses-feed`
- **Token Storage**: JWT in `localStorage.token`, user object in `sessionStorage.user`
- **Database Schema**: Auto-created on server startup; tables include users, messages, statuses, calls, contacts
- **WebSocket Events**: Use namespaces for real-time features; track online users with Map<username, Set<socketId>>
- **File Uploads**: Use multer for handling; files saved to `server/uploads/`
- **Call Tracking**: Log calls with status (completed, missed, rejected, dropped) and duration

## Pitfalls
- Set `JWT_SECRET` environment variable in production (defaults to 'dev_secret_change_me')
- Configure `ALLOWED_ORIGINS` for CORS (comma-separated client URLs)
- Ensure `server/uploads/` directory exists for file uploads
- Status privacy filtering is server-side only; client assumptions may lead to data leaks
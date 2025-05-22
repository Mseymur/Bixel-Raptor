# Game Controller Server

This is a server application that allows players to control a Unity game remotely through a web interface.

## How It Works

1. Players visit the web interface on their mobile devices
2. They join a queue to take turns controlling the game
3. When it's their turn, they can start the game and jump
4. The admin interface runs on your laptop to control the Unity game

## Deployment

### Deploying to Vercel

1. Sign up for a [Vercel account](https://vercel.com/signup) if you don't have one
2. Install the Vercel CLI: `npm install -g vercel`
3. Run `vercel login` and follow the instructions
4. From the project directory, run `vercel` to deploy
5. Set environment variables in the Vercel dashboard:
   - `ADMIN_USERNAME`: Custom username for admin login (default: admin)
   - `ADMIN_PASSWORD`: Custom password for admin login (default: password)

#### Troubleshooting Vercel Deployment Issues

If you encounter a `FUNCTION_INVOCATION_FAILED` error after deployment:

1. This is usually caused by native dependencies like `robotjs` that can't run in Vercel's serverless environment
2. In this project, we've moved `robotjs` to `optionalDependencies` to prevent Vercel build failures
3. Make sure your Unity client is properly set up to use the socket events (`startGameCommand` and `resetGameCommand`) instead of relying on keyboard simulation
4. Include the `unity-socket.js` file in your Unity WebGL build to handle communication without `robotjs`

### Connecting Your Laptop

1. Launch your Unity game on your laptop
2. Open a web browser and navigate to `https://your-vercel-app.vercel.app/admin`
3. Log in with your admin credentials
4. The admin panel will connect to the server and receive player commands
5. When players send commands, they will be relayed to your laptop

## Local Development

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run dev` to start the server
4. Open `http://localhost:3000` in your browser for the player interface
5. Open `http://localhost:3000/admin` in your browser for the admin interface

## Notes

- robotjs is used for local development only and won't work on Vercel
- The admin interface and unity-socket.js replaces robotjs functionality for production deployments
- Set strong admin credentials when deploying to production

## Security

- Always change the default admin credentials
- Consider using environment variables to store sensitive information
- The admin interface requires authentication to control the game 

## Unity Integration

For proper Unity WebGL integration:
1. Include the `unity-socket.js` file in your Unity WebGL build
2. Add socket.io client library to your Unity project
3. Create a GameController script in Unity that implements the following methods:
   - `OnServerConnected()` - Called when connected to the server
   - `OnServerDisconnected()` - Called when disconnected from the server
   - `StartGame()` - Called when a player starts the game (replaces space key)
   - `ResetGame()` - Called when the game ends (replaces space key)
   - `UpdateGameState(string jsonData)` - Called when game state updates 
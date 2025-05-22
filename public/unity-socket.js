// Unity Socket.io Client Helper
// This file provides communication between the Node.js server and Unity WebGL

// Socket.io initialization
let socket;
let gameState = {
  isConnected: false,
  isPlaying: false,
  currentPlayerId: null
};

// Connect to the server
function connectToServer() {
  // Connect with unity client type
  socket = io({
    query: {
      type: 'unity'
    }
  });
  
  // Connection events
  socket.on('connect', handleConnect);
  socket.on('disconnect', handleDisconnect);
  
  // Game control events
  socket.on('startGameCommand', handleStartGame);
  socket.on('resetGameCommand', handleResetGame);
  
  // Game state events
  socket.on('gameState', handleGameStateUpdate);
}

// Handle connection
function handleConnect() {
  console.log('Connected to server as Unity client');
  gameState.isConnected = true;
  
  // Notify Unity of connection
  if (window.unityInstance) {
    window.unityInstance.SendMessage('GameController', 'OnServerConnected');
  }
  
  // Send initial idle state
  sendGameState('idle');
}

// Handle disconnection
function handleDisconnect() {
  console.log('Disconnected from server');
  gameState.isConnected = false;
  
  // Notify Unity of disconnection
  if (window.unityInstance) {
    window.unityInstance.SendMessage('GameController', 'OnServerDisconnected');
  }
}

// Handle start game command (replacement for robotjs space key)
function handleStartGame() {
  console.log('Received start game command from server');
  if (window.unityInstance) {
    window.unityInstance.SendMessage('GameController', 'StartGame');
  }
}

// Handle reset game command (replacement for robotjs space key)
function handleResetGame() {
  console.log('Received reset game command from server');
  if (window.unityInstance) {
    window.unityInstance.SendMessage('GameController', 'ResetGame');
  }
}

// Handle game state update from server
function handleGameStateUpdate(data) {
  console.log('Game state update from server:', data);
  gameState.currentPlayerId = data.currentPlayerId;
  gameState.isPlaying = data.isGameRunning;
  
  // Update Unity
  if (window.unityInstance) {
    window.unityInstance.SendMessage('GameController', 'UpdateGameState', 
      JSON.stringify(data));
  }
}

// Send game state to server
function sendGameState(state, additionalData = {}) {
  if (!socket || !socket.connected) return;
  
  const data = {
    state: state,
    ...additionalData
  };
  
  console.log('Sending game state to server:', data);
  socket.emit('gameState', data);
}

// Functions to be called from Unity

// Called when Unity game starts
function unityGameStarted() {
  sendGameState('playing', { gameStarted: true });
}

// Called when Unity game ends
function unityGameEnded() {
  sendGameState('gameOver', { gameOver: true });
}

// Called when Unity is ready for the next player
function unityGameIdle() {
  sendGameState('idle');
}

// Initialize when the page loads
window.addEventListener('load', connectToServer);

// Make functions available globally for Unity WebGL
window.unityGameStarted = unityGameStarted;
window.unityGameEnded = unityGameEnded;
window.unityGameIdle = unityGameIdle; 
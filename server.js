const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Conditionally require robotjs only in local development
let robot = null;
if (process.env.NODE_ENV !== 'production') {
  try {
    robot = require('robotjs');
  } catch (error) {
    console.log('robotjs not available:', error.message);
  }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Admin authentication
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';

app.use(express.static('public'));
app.use(express.json());

// Admin login page
app.get('/admin', (req, res) => {
    res.sendFile(__dirname + '/public/admin.html');
});

// Admin authentication endpoint
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// Game state
let currentPlayerId = null;
let isGameRunning = false;
let gameOver = false;
let unityConnected = false;
let unitySocket = null;
let adminSocket = null;
let playerTurnTimeout = null;
let TURN_TIMEOUT = 11000; // 11 seconds timeout for starting (increased from 8)

// Queue system
let playerQueue = [];
let lastPlayedPlayers = new Map(); // Changed from Set to Map to store timestamps
const COOLDOWN_TIME = 120000; // 2 minutes in milliseconds
const MIN_QUEUE_SIZE = 3;

// Function to get remaining cooldown time for a player
function getCooldownTime(playerId) {
    if (!lastPlayedPlayers.has(playerId)) return 0;
    const playTime = lastPlayedPlayers.get(playerId);
    const elapsed = Date.now() - playTime;
    const remaining = Math.max(0, COOLDOWN_TIME - elapsed);
    return Math.ceil(remaining / 1000); // Convert to seconds
}

// Function to check if a player can play again
function canPlayAgain(playerId) {
    return getCooldownTime(playerId) === 0;
}

// Function to add player to queue
function addToQueue(playerId) {
    if (!playerQueue.includes(playerId) && canPlayAgain(playerId)) {
        playerQueue.push(playerId);
        return true;
    }
    return false;
}

// Function to get next player from queue
function getNextPlayer() {
    if (playerQueue.length > 0) {
        const nextPlayer = playerQueue.shift();
        lastPlayedPlayers.set(nextPlayer, Date.now());
        return nextPlayer;
    }
    return null;
}

// Function to start next player's turn
function startNextPlayerTurn() {
    console.log('Starting next player turn. Queue length:', playerQueue.length);
    
    // Clear any existing timeout
    if (playerTurnTimeout) {
        clearTimeout(playerTurnTimeout);
        playerTurnTimeout = null;
    }
    
    if (playerQueue.length > 0) {
        const nextPlayer = getNextPlayer();
        if (nextPlayer) {
            currentPlayerId = nextPlayer;
            console.log(`Next player's turn: ${currentPlayerId}`);
            
            // Notify the player it's their turn with countdown
            io.to(currentPlayerId).emit('yourTurn', { countdown: TURN_TIMEOUT / 1000 });
            
            // Notify all clients about the current state and queue positions
            broadcastGameState();
            broadcastQueuePositions();
            
            // Set timeout for player to start
            playerTurnTimeout = setTimeout(() => {
                console.log(`Player ${currentPlayerId} didn't start in time, moving to next player`);
                // Notify the player they've been skipped
                io.to(currentPlayerId).emit('turnSkipped', { 
                    reason: "You didn't start the game in time." 
                });
                
                // Remove from cooldown since they didn't actually play
                lastPlayedPlayers.delete(currentPlayerId);
                
                // Move to next player
                currentPlayerId = null;
                startNextPlayerTurn();
            }, TURN_TIMEOUT);
        }
    } else {
        console.log('No players in queue');
        currentPlayerId = null;
        broadcastGameState();
    }
}

// Function to broadcast queue positions to all clients
function broadcastQueuePositions() {
    const positions = {};
    playerQueue.forEach((playerId, index) => {
        positions[playerId] = index + 1;
    });
    
    io.emit('queueUpdate', { 
        queueSize: playerQueue.length,
        currentPlayer: currentPlayerId,
        positions: positions
    });
}

// Handle Unity/Admin/Client connections
io.on('connection', (socket) => {
    const clientType = socket.handshake.query.type;
    
    if (clientType === 'unity') {
        console.log('Unity connected');
        unityConnected = true;
        unitySocket = socket;
        
        // Broadcast to all clients that Unity is connected
        io.emit('unityState', { connected: true });
        
        // Handle Unity game state updates
        socket.on('gameState', (data) => {
            console.log('Unity game state:', data);
            
            if (data.state === "idle") {
                // Game is in idle state, ready for a new player
                console.log('Game is idle and ready for a new player');
                isGameRunning = false;
                gameOver = false;
                
                // If there's no current player and queue has players, start next player's turn
                if (!currentPlayerId && playerQueue.length > 0) {
                    console.log('Starting next player from idle state');
                    startNextPlayerTurn();
                } else {
                    console.log('No players in queue or player already assigned');
                    // Notify all clients about the game state
                    broadcastGameState();
                }
            }
            else if (data.state === "gameOver" || data.gameOver) {
                // Force immediate game over handling
                console.log('Game over received from Unity');
                handleGameOver();
            }
            else if (data.gameStarted) {
                console.log('Game started in Unity');
                isGameRunning = true;
                gameOver = false;
                
                // Notify all clients
                broadcastGameState();
            }
        });

        socket.on('disconnect', () => {
            console.log('Unity disconnected');
            unityConnected = false;
            unitySocket = null;
            // Reset game state when Unity disconnects
            isGameRunning = false;
            gameOver = false;
            currentPlayerId = null;
            // Notify all web clients
            io.emit('unityState', { connected: false });
            broadcastGameState();
        });

        // Send current state to unity
        if (currentPlayerId) {
            socket.emit('gameState', {
                currentPlayerId: currentPlayerId,
                isGameRunning: isGameRunning
            });
        }
    } 
    else if (clientType === 'admin') {
        console.log('Admin connected:', socket.id);
        adminSocket = socket;
        
        // Auth check
        socket.on('adminAuth', (data) => {
            if (data.username === ADMIN_USERNAME && data.password === ADMIN_PASSWORD) {
                socket.emit('authSuccess', { message: 'Authentication successful' });
                
                // Mark Unity as connected when admin is connected
                unityConnected = true;
                io.emit('unityState', { connected: true });
                broadcastGameState();
                
                // Send current queue and game status to admin
                socket.emit('adminStatus', {
                    queueSize: playerQueue.length,
                    currentPlayer: currentPlayerId,
                    isGameRunning,
                    gameOver
                });
            } else {
                socket.emit('authFailed', { message: 'Authentication failed' });
            }
        });
        
        // Handle admin commands
        socket.on('adminGameStart', () => {
            if (currentPlayerId) {
                isGameRunning = true;
                gameOver = false;
                broadcastGameState();
            }
        });
        
        socket.on('adminGameOver', () => {
            handleGameOver();
        });
        
        socket.on('adminIdle', () => {
            isGameRunning = false;
            gameOver = false;
            
            // If there's no current player and queue has players, start next player's turn
            if (!currentPlayerId && playerQueue.length > 0) {
                console.log('Starting next player from idle state');
                startNextPlayerTurn();
            } else {
                console.log('No players in queue or player already assigned');
                // Notify all clients about the game state
                broadcastGameState();
            }
        });
        
        socket.on('disconnect', () => {
            console.log('Admin disconnected');
            if (adminSocket === socket) {
                adminSocket = null;
                
                // Only mark Unity as disconnected if there's no Unity socket
                if (!unitySocket) {
                    unityConnected = false;
                    io.emit('unityState', { connected: false });
                    broadcastGameState();
                }
            }
        });
    } 
    else {
        // Web client connection
        console.log('Web client connected:', socket.id);
        
        // First tell client about Unity connection status - always allow joining if Unity is connected
        socket.emit('unityState', { 
            connected: unityConnected,
            allowJoin: unityConnected 
        });
        
        // Then send current game state to new client
        socket.emit('gameState', {
            isGameRunning,
            gameOver,
            currentPlayerId,
            queuePosition: playerQueue.indexOf(socket.id) + 1,
            cooldownTime: getCooldownTime(socket.id),
            canJoinQueue: unityConnected
        });

        // Handle join queue request
        socket.on('joinQueue', () => {
            if (!unityConnected) {
                socket.emit('notYourTurn', { 
                    reason: 'Game is not ready. Please wait for Unity to connect.',
                    waitTime: 0
                });
                return;
            }

            // Check if player is already the current player
            if (socket.id === currentPlayerId) {
                socket.emit('notYourTurn', { 
                    reason: 'You are already the current player.',
                    waitTime: 0
                });
                return;
            }

            // Check cooldown time and add to queue if eligible
            const cooldownTime = getCooldownTime(socket.id);
            if (cooldownTime > 0) {
                socket.emit('notYourTurn', { 
                    reason: 'You recently played. Please wait before playing again.',
                    waitTime: cooldownTime
                });
                return;
            }

            // Player is eligible to join queue
            if (!playerQueue.includes(socket.id)) {
                playerQueue.push(socket.id);
                const position = playerQueue.indexOf(socket.id) + 1;
                socket.emit('queued', { 
                    position: position,
                    queueSize: playerQueue.length
                });
                
                // If this is the first player and no game is running, make them current player
                if (!currentPlayerId && !isGameRunning) {
                    currentPlayerId = socket.id;
                    socket.emit('yourTurn', { countdown: TURN_TIMEOUT / 1000 });
                    // Update game state for all clients
                    broadcastGameState();
                }
                
                // Update all clients about queue changes
                broadcastQueuePositions();
            } else {
                // Already in queue, just update position
                socket.emit('queued', { 
                    position: playerQueue.indexOf(socket.id) + 1,
                    queueSize: playerQueue.length
                });
            }
        });

        // Handle game start
        socket.on('startGame', () => {
            console.log(`Player ${socket.id} started the game`);
            
            if (socket.id === currentPlayerId && !isGameRunning && unityConnected) {
                // Clear the turn timeout
                if (playerTurnTimeout) {
                    clearTimeout(playerTurnTimeout);
                    playerTurnTimeout = null;
                }
                
                isGameRunning = true;
                gameOver = false;
                
                // Simulate space key press to start the game in Unity
                if (robot) {
                    robot.keyTap('space');
                } else {
                    console.log('robotjs not available, would press space key');
                    // Notify Unity to start game through socket instead
                    if (unitySocket) {
                        unitySocket.emit('startGameCommand', {});
                    }
                }
                
                // Notify all clients
                broadcastGameState();
            } else {
                // Notify the player why they can't start
                let reason = "Unknown error";
                if (socket.id !== currentPlayerId) {
                    reason = "It's not your turn";
                } else if (isGameRunning) {
                    reason = "Game is already running";
                } else if (!unityConnected) {
                    reason = "Unity is not connected";
                }
                
                socket.emit('startGameError', { reason });
            }
        });

        // Handle jump
        socket.on('jump', () => {
            if (isGameRunning && !gameOver && currentPlayerId === socket.id) {
                console.log('Jump command from player:', socket.id);
                
                // Send jump command to Unity via socket if connected
                if (unityConnected && unitySocket) {
                    unitySocket.emit('jump');
                }
                
                // Send jump command to Admin client if connected
                if (adminSocket) {
                    adminSocket.emit('jump');
                }
                
                // If running locally, use robotjs
                if (process.env.NODE_ENV !== 'production') {
                    try {
                        robot.keyTap('space');
                    } catch (error) {
                        console.error('Error with robotjs:', error);
                    }
                }
            }
        });

        // Handle disconnection
        socket.on('disconnect', () => {
            console.log('Web client disconnected:', socket.id);
            
            // Remove from queue if present
            const queueIndex = playerQueue.indexOf(socket.id);
            if (queueIndex !== -1) {
                playerQueue.splice(queueIndex, 1);
            }
            
            // Remove from cooldown if present
            lastPlayedPlayers.delete(socket.id);
            
            // If current player disconnects, end the game
            if (currentPlayerId === socket.id) {
                isGameRunning = false;
                gameOver = true;
                currentPlayerId = null;
                
                // Notify all clients
                broadcastGameState();
                
                // Start next player's turn
                startNextPlayerTurn();
            }
        });
    }
});

function handleGameOver() {
    console.log('Handling game over');
    if (gameOver) return; // Prevent duplicate processing
    
    gameOver = true;
    isGameRunning = false;
    
    // Simulate space key press to reset the game in Unity
    if (robot) {
        robot.keyTap('space');
    } else {
        console.log('robotjs not available, would press space key');
        // Notify Unity to reset game through socket instead
        if (unitySocket) {
            unitySocket.emit('resetGameCommand', {});
        }
    }
    
    // Move to the next player
    if (currentPlayerId) {
        io.to(currentPlayerId).emit('gameOver');
        currentPlayerId = null;
    }
    
    // Start the next player's turn after a short delay
    setTimeout(() => {
        startNextPlayerTurn();
    }, 2000);
}

// Function to broadcast game state to all clients
function broadcastGameState() {
    io.emit('gameState', { 
        isGameRunning,
        gameOver,
        currentPlayerId,
        canJoinQueue: unityConnected
    });
}

// Function to broadcast Unity state to all clients
function broadcastUnityState() {
    io.emit('unityState', { 
        connected: unityConnected,
        allowJoin: unityConnected 
    });
}

// Set up periodic Unity status check and broadcast
setInterval(() => {
    if (unitySocket) {
        // Check if the socket is still connected
        if (unitySocket.connected) {
            unityConnected = true;
            broadcastUnityState();
        } else {
            unityConnected = false;
            unitySocket = null;
            
            // Check if admin is connected
            if (adminSocket && adminSocket.connected) {
                unityConnected = true; // Keep unity state as connected if admin is connected
            }
            
            broadcastUnityState();
        }
    } else if (adminSocket && adminSocket.connected) {
        // If admin is connected but Unity isn't, still mark as connected
        unityConnected = true;
        broadcastUnityState();
    }
}, 5000); // Check every 5 seconds

// For local development
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}

// For Vercel serverless deployment
module.exports = app;
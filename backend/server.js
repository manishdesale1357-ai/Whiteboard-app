const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);


const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});


let activeUsers = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
 
  activeUsers[socket.id] = { id: socket.id, x: 0, y: 0 };


  socket.on('draw-canvas-update', (canvasJson) => {
    socket.broadcast.emit('receive-canvas-update', canvasJson);
  });

  
  socket.on('mouse-cursor-move', (coords) => {
    if (activeUsers[socket.id]) {
      activeUsers[socket.id].x = coords.x;
      activeUsers[socket.id].y = coords.y;
      io.emit('update-remote-cursors', Object.values(activeUsers));
    }
  });

 
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete activeUsers[socket.id];
    io.emit('remove-remote-cursor', socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`WebSocket Server running smoothly on port ${PORT}`);
});
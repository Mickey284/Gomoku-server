const express = require('express');
const socketIO = require('socket.io');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 8080;

// 存储连接的用户
const connectedUsers = new Map();
// 存储房间信息
const rooms = new Map();

// 静态文件服务
const publicPath = path.resolve(__dirname, 'public');
app.use(express.static(publicPath));

// 路由处理
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.get('/room', (req, res) => {
  res.sendFile(path.join(publicPath, 'room.html'));
});

// Socket.IO连接处理
io.on('connection', (socket) => {
  console.log(`新客户端连接: ${socket.id}`);
  
  // 从查询参数中获取用户名和房间ID
  const username = socket.handshake.query.username || `用户_${socket.id.substring(0, 6)}`;
  const roomId = socket.handshake.query.roomId;
  
  // 存储用户信息
  connectedUsers.set(socket.id, {
    id: socket.id,
    username: username,
    joined: new Date(),
    currentRoom: roomId || null
  });

  // 发送欢迎消息
  socket.emit('server-message', {
    type: 'welcome',
    message: `欢迎来到多人游戏平台, ${username}!`,
    timestamp: new Date().toISOString()
  });

  // 如果提供了房间ID，尝试加入房间
  if (roomId) {
    joinRoom(socket, roomId);
  } else {
    // 发送当前房间列表
    sendRoomList(socket);
  }

  // 处理客户端消息
  socket.on('client-message', (data) => {
    console.log(`收到客户端消息 [${socket.id}]: ${data.message}`);
    
    const user = connectedUsers.get(socket.id);
    const username = user ? user.username : `用户_${socket.id.substring(0, 6)}`;
    
    // 向所有客户端广播消息（包括发送者）
    io.emit('server-message', {
      type: 'broadcast',
      message: data.message,
      sender: socket.id,
      senderName: username,
      sentTime: data.sentTime,
      timestamp: new Date().toISOString()
    });
  });

  // 处理房间消息
  socket.on('room-message', (data) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.currentRoom) return;
    
    const room = rooms.get(user.currentRoom);
    if (!room) return;
    
    console.log(`收到房间消息 [${room.name}]: ${data.message}`);
    
    // 向房间内所有玩家发送消息
    room.players.forEach(playerId => {
      io.to(playerId).emit('server-message', {
        type: 'room-message',
        message: data.message,
        sender: socket.id,
        senderName: user.username,
        sentTime: data.sentTime,
        timestamp: new Date().toISOString()
      });
    });
  });

  // 创建房间
  socket.on('create-room', (data) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;
    
    // 生成唯一房间ID
    const roomId = generateRoomId();
    const room = {
      id: roomId,
      name: data.name,
      maxPlayers: data.maxPlayers || 4,
      players: [socket.id],
      createdAt: new Date()
    };
    
    rooms.set(roomId, room);
    
    // 更新用户当前房间
    user.currentRoom = roomId;
    connectedUsers.set(socket.id, user);
    
    // 通知房间创建者
    socket.emit('room-created', room);
    
    // 广播房间列表更新
    broadcastRoomList();
    
    // 通知房间内玩家更新
    broadcastRoomPlayers(roomId);
  });

  // 加入房间
  socket.on('join-room', (roomId) => {
    joinRoom(socket, roomId);
  });

  // 离开房间
  socket.on('leave-room', (roomId) => {
    leaveRoom(socket, roomId);
  });

  // 处理断开连接
  socket.on('disconnect', () => {
    console.log(`客户端断开: ${socket.id}`);
    
    const user = connectedUsers.get(socket.id);
    connectedUsers.delete(socket.id);
    
    if (user) {
      // 如果用户在房间中，离开房间
      if (user.currentRoom) {
        leaveRoom(socket, user.currentRoom);
      }
    }
  });
  
  // 加入房间函数
  function joinRoom(socket, roomId) {
    const user = connectedUsers.get(socket.id);
    if (!user) return;
    
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('server-message', {
        type: 'error',
        message: '房间不存在',
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    // 检查房间是否已满
    if (room.players.length >= room.maxPlayers) {
      socket.emit('server-message', {
        type: 'error',
        message: '房间已满',
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    // 如果用户已经在另一个房间，先离开
    if (user.currentRoom && user.currentRoom !== roomId) {
      leaveRoom(socket, user.currentRoom);
    }
    
    // 加入房间
    room.players.push(socket.id);
    rooms.set(roomId, room);
    
    // 更新用户当前房间
    user.currentRoom = roomId;
    connectedUsers.set(socket.id, user);
    
    // 通知用户加入成功
    socket.emit('room-joined', room);
    
    // 通知房间内其他玩家
    room.players.forEach(playerId => {
      if (playerId !== socket.id) {
        io.to(playerId).emit('player-joined', user);
      }
    });
    
    // 广播房间列表更新
    broadcastRoomList();
    
    // 通知房间内玩家更新
    broadcastRoomPlayers(roomId);
  }
  
  // 离开房间函数
  function leaveRoom(socket, roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const user = connectedUsers.get(socket.id);
    if (!user || user.currentRoom !== roomId) return;
    
    // 从房间中移除玩家
    room.players = room.players.filter(playerId => playerId !== socket.id);
    
    // 如果房间为空，删除房间
    if (room.players.length === 0) {
      rooms.delete(roomId);
    } else {
      rooms.set(roomId, room);
    }
    
    // 更新用户当前房间
    user.currentRoom = null;
    connectedUsers.set(socket.id, user);
    
    // 通知用户离开成功
    socket.emit('room-left');
    
    // 通知房间内其他玩家
    room.players.forEach(playerId => {
      io.to(playerId).emit('player-left', user);
    });
    
    // 广播房间列表更新
    broadcastRoomList();
    
    // 通知房间内玩家更新
    if (room.players.length > 0) {
      broadcastRoomPlayers(roomId);
    }
  }
  
  // 生成房间ID
  function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }
  
  // 发送房间列表给指定客户端
  function sendRoomList(socket) {
    socket.emit('room-list', Array.from(rooms.values()));
  }
  
  // 广播房间列表给所有客户端
  function broadcastRoomList() {
    io.emit('room-list', Array.from(rooms.values()));
  }
  
  // 广播房间玩家更新
  function broadcastRoomPlayers(roomId) {
    const room = rooms.get(roomId);
    if (room) {
      room.players.forEach(playerId => {
        io.to(playerId).emit('room-players-updated', room);
      });
    }
  }
});

// 启动服务器
server.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器运行中: http://localhost:${PORT}`);
});
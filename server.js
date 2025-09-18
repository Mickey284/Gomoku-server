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
      createdAt: new Date(),
      // 添加颜色选择和游戏状态属性
      playerColors: {},
      gameStarted: false,
      currentPlayer: null
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
  
  // 选择颜色
  socket.on('select-color', (data) => {
    const { roomId, color } = data;
    const user = connectedUsers.get(socket.id);
    if (!user || !user.currentRoom) return;
    
    const room = rooms.get(user.currentRoom);
    if (!room || room.id !== roomId) return;
    
    // 检查颜色是否已被选择
    if (Object.values(room.playerColors).includes(color)) {
      socket.emit('server-message', {
        type: 'error',
        message: `${color === 'black' ? '黑棋' : '白棋'}已被其他玩家选择`,
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    // 记录玩家选择的颜色
    room.playerColors[socket.id] = color;
    rooms.set(roomId, room);
    
    // 通知房间内所有玩家
    room.players.forEach(playerId => {
      io.to(playerId).emit('color-selected', {
        playerId: socket.id,
        username: user.username,
        color: color
      });
    });
    
    // 检查是否两个颜色都已选择，如果是则开始游戏
    const blackPlayer = Object.keys(room.playerColors).find(id => room.playerColors[id] === 'black');
    const whitePlayer = Object.keys(room.playerColors).find(id => room.playerColors[id] === 'white');
    
    if (blackPlayer && whitePlayer && !room.gameStarted) {
      room.gameStarted = true;
      room.currentPlayer = blackPlayer; // 黑棋先手
      rooms.set(roomId, room);
      
      // 通知房间内所有玩家游戏开始
      room.players.forEach(playerId => {
        io.to(playerId).emit('game-started', {
          blackPlayer: blackPlayer,
          whitePlayer: whitePlayer
        });
      });
    }
    
    // 广播房间玩家更新
    broadcastRoomPlayers(roomId);
  });
  
  // 处理游戏移动
  socket.on('game-move', (data) => {
    const { roomId, row, col } = data;
    const user = connectedUsers.get(socket.id);
    if (!user || !user.currentRoom) return;
    
    const room = rooms.get(user.currentRoom);
    if (!room || room.id !== roomId) return;
    
    // 检查游戏是否已开始
    if (!room.gameStarted) return;
    
    // 检查是否轮到当前玩家
    if (room.currentPlayer !== socket.id) {
      socket.emit('server-message', {
        type: 'error',
        message: '还未轮到你下棋',
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    // 检查该位置是否已经有棋子
    if (!room.board) {
      room.board = Array(15).fill(null).map(() => Array(15).fill(null));
    }
    
    if (room.board[row][col] !== null) {
      socket.emit('server-message', {
        type: 'error',
        message: '该位置已经有棋子了',
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    // 获取当前玩家颜色
    const color = room.playerColors[socket.id];
    
    // 记录落子信息
    const moveData = {
      row: row,
      col: col,
      player: socket.id,
      username: user.username,
      color: color
    };
    
    // 通知房间内所有玩家落子信息
    room.players.forEach(playerId => {
      io.to(playerId).emit('game-move', moveData);
    });
    
    // 记录当前落子到棋盘
    room.board[row][col] = color;
    rooms.set(roomId, room);
    
    // 检查是否获胜
    const win = checkWin(roomId, row, col, color);
    
    if (win) {
      // 游戏结束，通知所有玩家
      room.players.forEach(playerId => {
        io.to(playerId).emit('game-over', {
          winner: socket.id,
          winnerName: user.username,
          color: color
        });
      });
      
      // 重置游戏状态
      room.gameStarted = false;
      room.currentPlayer = null;
      rooms.set(roomId, room);
    } else {
      // 切换当前玩家
      room.currentPlayer = room.currentPlayer === Object.keys(room.playerColors).find(id => room.playerColors[id] === 'black') 
        ? Object.keys(room.playerColors).find(id => room.playerColors[id] === 'white')
        : Object.keys(room.playerColors).find(id => room.playerColors[id] === 'black');
      rooms.set(roomId, room);
    }
  });
  
  // 检查是否获胜
  function checkWin(roomId, row, col, color) {
    const room = rooms.get(roomId);
    if (!room || !room.board) return false;
    
    // 检查四个方向是否连成五子
    const directions = [
      [0, 1],   // 水平
      [1, 0],   // 垂直
      [1, 1],   // 右下对角线
      [1, -1]   // 左下对角线
    ];
    
    for (let [dx, dy] of directions) {
      let count = 1; // 包含当前棋子
      
      // 正方向检查
      for (let i = 1; i <= 4; i++) {
        const r = parseInt(row) + dx * i;
        const c = parseInt(col) + dy * i;
        if (r >= 0 && r < 15 && c >= 0 && c < 15 && room.board[r][c] === color) {
          count++;
        } else {
          break;
        }
      }
      
      // 反方向检查
      for (let i = 1; i <= 4; i++) {
        const r = parseInt(row) - dx * i;
        const c = parseInt(col) - dy * i;
        if (r >= 0 && r < 15 && c >= 0 && c < 15 && room.board[r][c] === color) {
          count++;
        } else {
          break;
        }
      }
      
      // 如果连成五子，返回胜利
      if (count >= 5) {
        return true;
      }
    }
    
    return false;
  }
  
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
    
    // 通知房间内
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
      // 如果离开的玩家选择了颜色，需要从playerColors中移除
      if (room.playerColors[socket.id]) {
        delete room.playerColors[socket.id];
        
        // 如果游戏正在进行中，需要重置游戏状态
        if (room.gameStarted) {
          room.gameStarted = false;
          room.currentPlayer = null;
        }
      }
      
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
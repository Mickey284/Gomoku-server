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
    
    // 通知房间内所有玩家落子信息
    room.players.forEach(playerId => {
      io.to(playerId).emit('game-move', {
        row: row,
        col: col,
        player: socket.id,
        username: user.username
      });
    });
    
    // 检查是否获胜
    const color = room.playerColors[socket.id];
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
    if (!room) return false;
    
    // 初始化棋盘状态（如果不存在）
    if (!room.board) {
      room.board = Array(15).fill(null).map(() => Array(15).fill(null));
    }
    
    // 记录当前落子
    room.board[row][col] = color;
    rooms.set(roomId, room);
    
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
        const r = row + dx * i;
        const c = col + dy * i;
        if (r >= 0 && r < 15 && c >= 0 && c < 15 && room.board[r][c] === color) {
          count++;
        } else {
          break;
        }
      }
      
      // 反方向检查
      for (let i = 1; i <= 4; i++) {
        const r = row - dx * i;
        const c = col - dy * i;
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
  
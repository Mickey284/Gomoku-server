// 全局状态
let socket;
let connectionId = '';
let username = '';
let currentRoom = null;
let selectedColor = null;
let playerColors = {};

// 初始化大厅页面
function initLobbyPage() {
    // 生成随机用户名
    username = `玩家_${Math.floor(1000 + Math.random() * 9000)}`;
    initSocketConnection();
    
    // 监听输入框回车事件
    document.getElementById('room-name-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            createRoom();
        }
    });
    
    document.getElementById('join-room-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            joinRoom();
        }
    });
}

// 初始化房间页面
function initRoomPage() {
    // 从URL获取房间ID
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('roomId');
    
    if (!roomId) {
        alert('房间ID无效，将返回大厅');
        window.location.href = 'index.html';
        return;
    }
    
    // 生成随机用户名
    username = `玩家_${Math.floor(1000 + Math.random() * 9000)}`;
    initSocketConnection(roomId);
    
    // 监听输入框回车事件
    document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    
    // 初始化游戏棋盘
    initGameBoard();
}

// 初始化Socket连接
function initSocketConnection(roomId = null) {
    updateStatus('正在连接服务器...', '#f39c12');

    // 创建随机水果名作为用户名
    const fruits = ['Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', 'Fig', 'Grape', 'Honeydew', 'Icaco', 'Jackfruit'];
    username = fruits[Math.floor(Math.random() * fruits.length)];

    // 创建Socket.IO连接
    const serverUrl = window.location.hostname === 'localhost' 
        ? 'http://localhost:8080' 
        : `http://${window.location.hostname}:8080`;

    const query = {
        username: username
    };

    if (roomId) {
        query.roomId = roomId;
    }

    socket = io(serverUrl, {
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 5000,
        transports: ['websocket', 'polling'],
        query: query
    });

    // 连接成功
    socket.on('connect', () => {
        connectionId = username; // 使用水果名作为连接ID
        updateStatus('连接成功', '#2ecc71');
        document.querySelector('.status-indicator').classList.add('connected');
        document.getElementById('connection-id').textContent = connectionId;

        addMessage('系统', '已连接到服务器', 'system');
    });

    // 连接错误
    socket.on('connect_error', (error) => {
        updateStatus(`连接错误: ${error.message || error}`, '#e74c3c');
        document.querySelector('.status-indicator').classList.remove('connected');
    });

    // 断开连接
    socket.on('disconnect', (reason) => {
        if (reason === 'io server disconnect') {
            updateStatus('服务器断开连接', '#e74c3c');
        } else {
            updateStatus('已断开连接', '#e74c3c');
        }
        document.querySelector('.status-indicator').classList.remove('connected');

        addMessage('系统', '连接已断开', 'system');
    });

    // 尝试重连
    socket.on('reconnect_attempt', (attempt) => {
        updateStatus(`尝试重新连接 (${attempt}/5)`, '#f39c12');
    });

    // 重连成功
    socket.on('reconnect', () => {
        updateStatus('重新连接成功', '#2ecc71');
        connectionId = socket.id;
        document.getElementById('connection-id').textContent = connectionId;
        document.querySelector('.status-indicator').classList.add('connected');

        addMessage('系统', '重新连接成功', 'system');

        // 重新加入房间（如果之前在一个房间中）
        if (currentRoom) {
            joinRoomById(currentRoom.id);
        }
    });

    // 服务器消息处理
    socket.on('server-message', (data) => {
        if (data.type === 'welcome') {
            addMessage('服务器', data.message, 'system');
        } else if (data.type === 'response') {
            addMessage('服务器', data.message, 'system');
        } else if (data.type === 'broadcast') {
            // 处理来自其他玩家的消息，不再添加自己的消息
            if (data.sender !== socket.id) {
                addMessage(data.senderName, data.message, 'other-player-message');
            }
        } else if (data.type === 'room-message') {
            // 房间内的消息，不再添加自己的消息
            if (data.sender !== socket.id) {
                addMessage(data.senderName, data.message, 'other-player-message');
            }
        } else if (data.type === 'error') {
            addMessage('错误', data.message, 'system');
        }
    });

    // 在线玩家更新
    socket.on('player-count', (count) => {
        // 不再需要此功能
    });

    // 玩家列表更新
    socket.on('player-list', (players) => {
        updatePlayerList(players);
    });

    // 玩家加入通知
    socket.on('player-joined', (player) => {
        addMessage('系统', `${player.username} 加入了游戏`, 'system');
        updatePlayerList([player]);
    });

    // 玩家离开通知
    socket.on('player-left', (player) => {
        addMessage('系统', `${player.username} 离开了游戏`, 'system');
        removePlayerFromList(player.id);
        
        // 如果该玩家选择了颜色，需要更新界面
        if (playerColors[player.id]) {
            delete playerColors[player.id];
            updateColorSelectionUI();
        }
    });

    // 房间创建成功
    socket.on('room-created', (room) => {
        addMessage('系统', `房间 "${room.name}" 创建成功!`, 'system');
        currentRoom = room;
        updateRoomList([room]);
        highlightCurrentRoom();

        // 重定向到房间页面
        window.location.href = `room.html?roomId=${room.id}`;
    });

    // 房间加入成功
    socket.on('room-joined', (room) => {
        addMessage('系统', `你已加入房间 "${room.name}"`, 'system');
        currentRoom = room;
        playerColors = room.playerColors || {};
        highlightCurrentRoom();

        // 更新房间标题
        if (document.getElementById('room-title')) {
            document.getElementById('room-title').textContent = room.name;
            // 初始化颜色选择UI
            updateColorSelectionUI();
        } else {
            // 如果在大厅页面，需要跳转到房间页面
            window.location.href = `room.html?roomId=${room.id}`;
        }
    });

    // 房间离开成功
    socket.on('room-left', () => {
        addMessage('系统', `你已离开房间`, 'system');
        currentRoom = null;
        playerColors = {};
        highlightCurrentRoom();

        // 返回大厅
        window.location.href = 'index.html';
    });

    // 房间列表更新
    socket.on('room-list', (rooms) => {
        updateRoomList(rooms);
        highlightCurrentRoom();
    });

    // 房间玩家更新
    socket.on('room-players-updated', (room) => {
        if (currentRoom && currentRoom.id === room.id) {
            currentRoom = room;
            playerColors = room.playerColors || {};
            updateColorSelectionUI();
        }
        updateRoomList([room]);
        highlightCurrentRoom();
    });
    
    // 玩家选择颜色
    socket.on('color-selected', (data) => {
        const { playerId, username, color } = data;
        playerColors[playerId] = color;
        
        addMessage('系统', `${username} 选择了${color === 'black' ? '黑棋' : '白棋'}`, 'system');
        updateColorSelectionUI();
    });
    
    // 游戏开始
    socket.on('game-started', (data) => {
        const { blackPlayer, whitePlayer } = data;
        addMessage('系统', '游戏开始！', 'system');
        
        // 显示游戏状态
        const gameStatus = document.getElementById('game-status');
        if (gameStatus) {
            gameStatus.textContent = `游戏进行中 - 黑棋: ${connectedUsers.get(blackPlayer)?.username || '玩家'}, 白棋: ${connectedUsers.get(whitePlayer)?.username || '玩家'}`;
        }
        
        // 启用棋盘
        enableGameBoard();
    });
    
    // 游戏落子
    socket.on('game-move', (data) => {
        const { row, col, username, win } = data;
        placeStone(row, col, playerColors[data.player] || 'black');
        const gameStatus = document.getElementById('game-status');
        if (gameStatus) {
            if (win) {
                gameStatus.textContent = `${username} 获胜！游戏结束`;
            } else {
                gameStatus.textContent = `轮到${playerColors[data.player] === 'black' ? '白棋' : '黑棋'}下棋`;
            }
        }
        
        // 如果游戏结束，禁用棋盘
        if (win) {
            disableGameBoard();
        }
    });
    
    // 游戏结束
    socket.on('game-over', (data) => {
        const { winnerName, color } = data;
        addMessage('系统', `游戏结束！${winnerName}(${color === 'black' ? '黑棋' : '白棋'}) 获胜！`, 'system');
        
        // 显示游戏状态
        const gameStatus = document.getElementById('game-status');
        if (gameStatus) {
            gameStatus.textContent = `游戏结束！${winnerName} 获胜！`;
        }
        
        // 禁用棋盘
        disableGameBoard();
    });

}

// 初始化游戏棋盘
function initGameBoard() {
    const gameBoard = document.getElementById('game-board');
    if (!gameBoard) return;
    
    gameBoard.innerHTML = '';

    for (let i = 0; i < 15; i++) {
        for (let j = 0; j < 15; j++) {
            const cell = document.createElement('div');
            cell.className = 'game-cell';
            cell.dataset.row = i;
            cell.dataset.col = j;
            cell.addEventListener('click', handleCellClick);
            gameBoard.appendChild(cell);
        }
    }
    
    // 禁用棋盘直到游戏开始
    disableGameBoard();
}

// 禁用游戏棋盘
function disableGameBoard() {
    const gameBoard = document.getElementById('game-board');
    if (gameBoard) {
        gameBoard.style.pointerEvents = 'none';
        gameBoard.style.opacity = '0.3';
    }
}

// 启用游戏棋盘
function enableGameBoard() {
    const gameBoard = document.getElementById('game-board');
    if (gameBoard) {
        gameBoard.style.pointerEvents = 'auto';
        gameBoard.style.opacity = '1';
    }
}

// 处理棋盘点击
function handleCellClick(e) {
    const row = e.target.dataset.row;
    const col = e.target.dataset.col;

    if (!currentRoom) return;

    // 发送落子信息到服务器
    socket.emit('game-move', {
        roomId: currentRoom.id,
        row: parseInt(row),
        col: parseInt(col),
        player: username
    });
}

// 放置棋子
function placeStone(row, col, color) {
    const cell = document.querySelector(`.game-cell[data-row="${row}"][data-col="${col}"]`);
    if (!cell) return;
    
    // 检查是否已有棋子
    if (cell.querySelector('.stone')) return;
    
    const stone = document.createElement('div');
    stone.className = `stone ${color}`;
    cell.appendChild(stone);
}

// 更新玩家列表
function updatePlayerList(players) {
    const playersList = document.getElementById('players-list');
    if (!playersList) return;
    
    playersList.innerHTML = '';

    players.forEach(player => {
        const playerElement = document.createElement('div');
        playerElement.className = 'player-item';
        playerElement.dataset.id = player.id;
        playerElement.innerHTML = `
            <div class="player-status"></div>
            <span>${player.username}</span>
        `;
        playersList.appendChild(playerElement);
    });
}

// 更新房间列表
function updateRoomList(rooms) {
    const roomList = document.getElementById('room-list');
    if (!roomList) return;

    // 如果房间列表为空，显示提示
    if (rooms.length === 0) {
        roomList.innerHTML = '<div class="room-item"><div class="room-info"><div class="room-name">暂无可用房间</div><div class="room-players">请创建新房间</div></div></div>';
        return;
    }

    // 更新或添加房间
    rooms.forEach(room => {
        let roomElement = document.querySelector(`.room-item[data-id="${room.id}"]`);

        if (!roomElement) {
            roomElement = document.createElement('div');
            roomElement.className = 'room-item';
            roomElement.dataset.id = room.id;
            roomElement.innerHTML = `
                <div class="room-info">
                    <div class="room-name">${room.name}</div>
                    <div class="room-players">玩家: ${room.players.length}/${room.maxPlayers || 4}</div>
                </div>
                <div class="room-status ${room.players.length < (room.maxPlayers || 4) ? 'available' : 'full'}">
                    ${room.players.length < (room.maxPlayers || 4) ? '可用' : '已满'}
                </div>
            `;
            roomList.appendChild(roomElement);

            // 添加点击事件
            roomElement.addEventListener('click', () => {
                joinRoomById(room.id);
            });
        } else {
            // 更新现有房间信息
            const roomInfo = roomElement.querySelector('.room-info');
            roomInfo.innerHTML = `
                <div class="room-name">${room.name}</div>
                <div class="room-players">玩家: ${room.players.length}/${room.maxPlayers || 4}</div>
            `;

            const roomStatus = roomElement.querySelector('.room-status');
            roomStatus.className = `room-status ${room.players.length < (room.maxPlayers || 4) ? 'available' : 'full'}`;
            roomStatus.textContent = room.players.length < (room.maxPlayers || 4) ? '可用' : '已满';
        }
    });
}

// 高亮当前房间
function highlightCurrentRoom() {
    // 移除所有高亮
    document.querySelectorAll('.room-item').forEach(item => {
        item.classList.remove('active');
    });

    // 高亮当前房间
    if (currentRoom) {
        const currentRoomElement = document.querySelector(`.room-item[data-id="${currentRoom.id}"]`);
        if (currentRoomElement) {
            currentRoomElement.classList.add('active');
        }
    }
}

// 从玩家列表中移除玩家
function removePlayerFromList(playerId) {
    const playerElement = document.querySelector(`.player-item[data-id="${playerId}"]`);
    if (playerElement) {
        playerElement.remove();
    }
}

// 更新状态显示
function updateStatus(text, color = '#333') {
    const statusElement = document.getElementById('server-status');
    statusElement.textContent = text;
    statusElement.style.color = color;
}

// 添加消息到日志
function addMessage(sender, message, type = 'server') {
    const log = document.getElementById('message-log');
    if (!log) return;

    const messageElement = document.createElement('div');
    messageElement.classList.add('message');

    if (type === 'server') {
        messageElement.classList.add('server-message');
        messageElement.innerHTML = `<strong>${sender}:</strong> ${message}`;
    } else if (type === 'client') {
        // 自己发送的消息样式
        messageElement.classList.add('client-message');
        messageElement.innerHTML = `<strong>${sender}:</strong> ${message}`;
        messageElement.style.cssFloat = 'right';
        messageElement.style.clear = 'both';
        messageElement.style.textAlign = 'right';
        messageElement.style.marginLeft = 'auto';
        messageElement.style.marginRight = '0';
    } else if (type === 'other-player-message') {
        // 其他玩家消息样式
        messageElement.classList.add('other-player-message');
        messageElement.innerHTML = `<strong>${sender}:</strong> ${message}`;
    } else {
        // 系统消息样式
        messageElement.classList.add('system-message');
        messageElement.innerHTML = `<strong>${sender}:</strong> ${message}`;
        messageElement.style.fontSize = '0.9em';
        messageElement.style.opacity = '0.8';
        messageElement.style.backgroundColor = '#f0f0f0';
        messageElement.style.borderLeft = '4px solid #ccc';
    }

    log.appendChild(messageElement);
    log.scrollTop = log.scrollHeight;
}

// 发送消息
function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value.trim();

    if (message) {
        const sentTime = new Date().getTime();

        if (currentRoom) {
            // 发送房间消息
            socket.emit('room-message', {
                roomId: currentRoom.id,
                message: message,
                sentTime: sentTime
            });
        } else {
            // 发送全局消息
            socket.emit('client-message', { 
                message: message, 
                sentTime: sentTime 
            });
        }

        // 仅添加一次消息，不再重复添加
        addMessage('你', message, 'client');
        input.value = '';
        input.focus();
    }
}

// 创建房间
function createRoom() {
    const roomNameInput = document.getElementById('room-name-input');
    const roomName = roomNameInput.value.trim();

    if (roomName) {
        socket.emit('create-room', {
            name: roomName,
            maxPlayers: 4
        });
        roomNameInput.value = '';
    } else {
        alert('请输入房间名称');
    }
}

// 加入房间
function joinRoom() {
    const roomIdInput = document.getElementById('join-room-input');
    const roomId = roomIdInput.value.trim();

    if (roomId) {
        joinRoomById(roomId);
        roomIdInput.value = '';
    } else {
        alert('请输入房间ID');
    }
}

// 通过ID加入房间
function joinRoomById(roomId) {
    socket.emit('join-room', roomId);
}

// 离开房间
function leaveRoom() {
    if (currentRoom) {
        socket.emit('leave-room', currentRoom.id);
        // 直接跳转到主页而不是等待服务器响应
        window.location.href = 'index.html';
    } else {
        // 即使不在房间中也返回主页
        window.location.href = 'index.html';
    }
}

// 更新颜色选择UI
function updateColorSelectionUI() {
    // 创建颜色选择区域（如果不存在）
    let colorSelection = document.getElementById('color-selection');
    if (!colorSelection) {
        const roomContent = document.querySelector('.room-content');
        if (!roomContent) return;
        
        colorSelection = document.createElement('div');
        colorSelection.id = 'color-selection';
        colorSelection.className = 'panel';
        colorSelection.innerHTML = `
            <h3>选择棋子颜色</h3>
            <div style="display: flex; gap: 20px; justify-content: center;">
                <button id="select-black" class="btn btn-dark" style="background: #333; color: white;">选择黑棋</button>
                <button id="select-white" class="btn btn-light" style="background: #fff; color: black; border: 1px solid #ccc;">选择白棋</button>
            </div>
            <div id="selected-colors" style="margin-top: 15px; text-align: center;"></div>
        `;
        roomContent.insertBefore(colorSelection, roomContent.firstChild);
        
        // 添加事件监听器
        document.getElementById('select-black').addEventListener('click', () => selectColor('black'));
        document.getElementById('select-white').addEventListener('click', () => selectColor('white'));
    }
    
    // 更新已选择颜色的显示
    const selectedColorsDiv = document.getElementById('selected-colors');
    if (selectedColorsDiv) {
        let html = '<p style="margin: 5px 0;"><strong>已选择:</strong></p>';
        for (const [playerId, color] of Object.entries(playerColors)) {
            const user = connectedUsers.get(playerId);
            const username = user ? user.username : `用户_${playerId.substring(0, 6)}`;
            html += `<span style="margin: 0 10px; padding: 5px; border-radius: 4px; background: ${color === 'black' ? '#333' : '#fff'}; color: ${color === 'black' ? 'white' : 'black'}; border: 1px solid #ccc;">${username}: ${color === 'black' ? '黑棋' : '白棋'}</span>`;
        }
        selectedColorsDiv.innerHTML = html;
    }
    
    // 更新按钮状态
    const blackButton = document.getElementById('select-black');
    const whiteButton = document.getElementById('select-white');
    
    if (blackButton && whiteButton) {
        // 检查颜色是否已被选择
        const blackTaken = Object.values(playerColors).includes('black');
        const whiteTaken = Object.values(playerColors).includes('white');
        
        // 更新按钮状态
        blackButton.disabled = blackTaken;
        blackButton.style.opacity = blackTaken ? 0.5 : 1;
        whiteButton.disabled = whiteTaken;
        whiteButton.style.opacity = whiteTaken ? 0.5 : 1;
    }
}

// 选择颜色
function selectColor(color) {
    if (!currentRoom) return;
    
    // 检查是否已经选择了颜色
    if (selectedColor) {
        addMessage('系统', `你已经选择了${selectedColor === 'black' ? '黑棋' : '白棋'}`, 'system');
        return;
    }
    
    // 发送颜色选择到服务器
    socket.emit('select-color', {
        roomId: currentRoom.id,
        color: color
    });
    
    selectedColor = color;
}

// 存储连接的用户（客户端版本）
const connectedUsers = new Map();

// 监听玩家加入事件，更新本地用户列表
socket && socket.on('player-joined', (player) => {
    connectedUsers.set(player.id, player);
});

socket && socket.on('room-joined', (room) => {
    // 更新本地用户列表
    room.players.forEach(playerId => {
        if (!connectedUsers.has(playerId)) {
            connectedUsers.set(playerId, { id: playerId, username: `用户_${playerId.substring(0, 6)}` });
        }
    });
});
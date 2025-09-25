function initRoomPage() {
    // 从URL获取房间ID
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('roomId');
    
    if (!roomId) {
        alert('房间ID无效，将返回大厅');
        window.location.href = 'index.html';
        return;
    }
    
    // 生成随机水果名作为用户名
    const fruits = ['Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', 'Fig', 'Grape', 'Honeydew', 'Icaco', 'Jackfruit'];
    username = fruits[Math.floor(Math.random() * fruits.length)];
    initSocketConnection(roomId);
    
    // 监听输入框回车事件
    document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    
    // 初始化游戏棋盘
    initGameBoard();
    
    // 添加离开房间按钮到右上角
    addLeaveRoomButton();
    
    // 注意：房间页面不需要鼠标跟随效果，因此不调用createMouseFollower()
}

// 添加离开房间按钮到右上角
function addLeaveRoomButton() {
    const gameArea = document.querySelector('.game-area');
    if (!gameArea) return;
    
    const leaveButton = document.createElement('button');
    leaveButton.className = 'btn btn-danger';
    leaveButton.textContent = '离开房间';
    leaveButton.style.position = 'absolute';
    leaveButton.style.top = '10px';
    leaveButton.style.right = '10px';
    leaveButton.style.zIndex = '100';
    leaveButton.onclick = function() {
        leaveRoom();
    };
    
    gameArea.appendChild(leaveButton);
}
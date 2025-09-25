// 更新弹窗中的已选择颜色显示
function updateSelectedColorsInModal() {
    const selectedColorsDiv = document.getElementById('selected-colors-modal');
    if (selectedColorsDiv) {
        let html = '<p><strong>已选择:</strong></p>';
        let hasSelection = false;
        
        // 遍历所有玩家的颜色选择
        for (const [playerId, color] of Object.entries(playerColors)) {
            const user = connectedUsers.get(playerId);
            
            // 获取显示名称，优先使用水果名
            let displayName;
            if (user && user.username) {
                displayName = user.username;
            } else if (playerId === socket.id) {
                // 如果是当前玩家，使用全局username（水果名）
                displayName = username;
            } else {
                // 其他玩家使用连接ID作为备选
                displayName = `用户_${playerId.substring(0, 6)}`;
            }
            
            // 添加颜色信息
            const colorText = color === 'black' ? '黑棋' : '白棋';
            html += `<span style="margin: 0 5px; padding: 3px 8px; border-radius: 4px; background: ${color === 'black' ? '#333' : '#fff'}; color: ${color === 'black' ? 'white' : 'black'}; border: 1px solid #ccc;">${displayName}: ${colorText}</span>`;
            hasSelection = true;
        }
        
        if (!hasSelection) {
            html = '<p>暂无玩家选择颜色</p>';
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
        whiteButton.disabled = whiteTaken;
    }
}
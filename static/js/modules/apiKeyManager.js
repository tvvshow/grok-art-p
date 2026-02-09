import { api } from '../utils.js';

let allKeys = [];

export async function initApiKeyManager() {
    // Initial Load
    await loadApiKeys();

    // Event Listeners
    document.getElementById('btn-create-apikey').onclick = createApiKey;
    document.getElementById('btn-copy-apikey').onclick = copyNewKey;
}

async function loadApiKeys() {
    try {
        const data = await api('/api/keys');
        allKeys = data.keys || [];
        updateStats(data);
        renderKeyList(allKeys);
    } catch (e) {
        console.error('加载 API 密钥失败', e);
    }
}

function updateStats(data) {
    document.getElementById('apikey-stat-total').textContent = data.total || 0;
    document.getElementById('apikey-stat-enabled').textContent = data.enabled || 0;
}

function renderKeyList(keys) {
    const list = document.getElementById('apikey-list');
    if (!keys || keys.length === 0) {
        list.innerHTML = '<div class="empty-state">暂无 API 密钥，请创建一个</div>';
        return;
    }

    list.innerHTML = keys.map(k => `
        <div class="token-item">
            <div class="token-info">
                <div class="token-name">
                    ${k.name || '未命名密钥'}
                </div>
                <div class="token-meta">
                    密钥: ${k.key} | 调用次数: ${k.usage_count} | 今日: ${k.daily_usage}${k.rate_limit > 0 ? '/' + k.rate_limit : ''}
                </div>
                <div class="token-meta" style="font-size:0.75rem; color:#888;">
                    创建于: ${formatDate(k.created_at)}${k.last_used_at ? ' | 最后使用: ' + formatDate(k.last_used_at) : ''}
                </div>
            </div>
            <span class="status-badge ${k.enabled ? 'active' : 'inactive'}">${k.enabled ? '启用' : '禁用'}</span>
            <button class="btn btn-secondary btn-sm" onclick="window.toggleApiKey('${k.id}', ${!k.enabled})">${k.enabled ? '禁用' : '启用'}</button>
            <button class="btn btn-danger btn-sm" onclick="window.deleteApiKey('${k.id}')">删除</button>
        </div>
    `).join('');
}

function formatDate(isoString) {
    if (!isoString) return '-';
    const d = new Date(isoString);
    return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

async function createApiKey() {
    const nameInput = document.getElementById('apikey-name');
    const name = nameInput.value.trim();
    const btn = document.getElementById('btn-create-apikey');

    btn.disabled = true;
    btn.textContent = '创建中...';

    try {
        const res = await api('/api/keys', 'POST', { name });
        if (res.success && res.key) {
            // Show new key
            const display = document.getElementById('new-apikey-display');
            const valueEl = document.getElementById('new-apikey-value');
            valueEl.textContent = res.key.key;
            display.style.display = 'block';

            // Clear input
            nameInput.value = '';

            // Reload list
            await loadApiKeys();
        } else {
            alert('创建失败: ' + (res.error || '未知错误'));
        }
    } catch (e) {
        alert('创建失败: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '创建密钥';
    }
}

function copyNewKey() {
    const keyValue = document.getElementById('new-apikey-value').textContent;
    navigator.clipboard.writeText(keyValue).then(() => {
        const btn = document.getElementById('btn-copy-apikey');
        btn.textContent = '已复制!';
        setTimeout(() => {
            btn.textContent = '复制密钥';
        }, 2000);
    }).catch(e => {
        alert('复制失败: ' + e.message);
    });
}

// Global functions for inline onclick handlers
window.deleteApiKey = async (id) => {
    if (!confirm('确定删除此 API 密钥？删除后使用该密钥的服务将无法访问')) return;
    try {
        await api(`/api/keys/${id}`, 'DELETE');
        await loadApiKeys();
    } catch (e) {
        alert('删除失败: ' + e.message);
    }
};

window.toggleApiKey = async (id, enabled) => {
    try {
        await api(`/api/keys/${id}`, 'PATCH', { enabled });
        await loadApiKeys();
    } catch (e) {
        alert('操作失败: ' + e.message);
    }
};

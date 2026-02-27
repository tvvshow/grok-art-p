import { readStream, log, clearLog, bus } from '../utils.js';

let currentPrompt = '';
let currentAspect = '2:3';
let currentNsfw = true;
let loadedUrls = new Set();
let isLoading = false;

export function initImageGen() {
    document.getElementById('btn-generate').onclick = startGeneration;
    document.getElementById('btn-load-more').onclick = loadMore;

    // Hide load more initially
    toggleLoadMore(false);
}

async function startGeneration() {
    const prompt = document.getElementById('input-prompt').value.trim();
    if (!prompt) return alert('请输入提示词');

    currentPrompt = prompt;
    currentAspect = document.getElementById('select-aspect').value;
    currentNsfw = document.getElementById('select-nsfw').value === 'true';
    const count = parseInt(document.getElementById('input-count').value) || 10;

    // Reset UI
    const grid = document.getElementById('image-grid');
    grid.innerHTML = '';
    loadedUrls.clear();
    clearLog('gen-log');
    toggleLoadMore(false);
    setLoading(true, '正在生成...');

    log('gen-log', `生成中: "${prompt}" [目标: ${count}张]`);

    await readStream('/api/imagine/generate', {
        prompt: currentPrompt,
        aspect_ratio: currentAspect,
        enable_nsfw: currentNsfw,
        count: count
    }, {
        onProgress: (data) => {
            updateProgress(data.percentage);
            if (data.status) log('gen-log', `状态: ${data.status}`);
        },
        onData: (data) => {
            if (data.type === 'image' && !loadedUrls.has(data.url)) {
                loadedUrls.add(data.url);
                addImageCard(data);
            }
        },
        onInfo: (data) => log('gen-log', `信息: ${data.message}`),
        onError: (msg) => log('gen-log', `错误: ${msg}`, 'error'),
        onDone: () => {
            setLoading(false);
            toggleLoadMore(true);
            log('gen-log', '生成完成', 'success');
        }
    });
}

async function loadMore() {
    if (isLoading) return;

    setLoading(true, '加载更多...');
    toggleLoadMore(false);
    log('gen-log', '正在加载更多结果...');

    await readStream('/api/imagine/scroll', {
        prompt: currentPrompt,
        aspect_ratio: currentAspect,
        enable_nsfw: currentNsfw,
        max_pages: 1
    }, {
        onData: (data) => {
            if (data.type === 'image' && !loadedUrls.has(data.url)) {
                loadedUrls.add(data.url);
                addImageCard(data);
            }
        },
        onError: (msg) => log('gen-log', `错误: ${msg}`, 'error'),
        onDone: () => {
            setLoading(false);
            toggleLoadMore(true);
            log('gen-log', '加载完成', 'success');
        }
    });
}

function addImageCard(data) {
    const grid = document.getElementById('image-grid');
    const card = document.createElement('div');
    card.className = 'image-card';
    const imgSrc = data.image_src || data.url;

    card.innerHTML = `
        <img src="${imgSrc}" loading="lazy" alt="${data.prompt}">
        <div class="image-info">
            <div class="image-prompt" title="${data.prompt}">${data.prompt}</div>
            <div style="margin-top:5px; font-size:0.8em; color:#666;">
                ${data.width}x${data.height} | ID: ${data.job_id}
            </div>
        </div>
    `;

    card.onclick = () => {
        // Handle selection style
        document.querySelectorAll('.image-card.selected').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');

        // Emit event for video module
        bus.emit('image-selected', data);
    };

    grid.appendChild(card);
}

function setLoading(loading, text = '') {
    isLoading = loading;
    const btn = document.getElementById('btn-generate');
    const loadMoreBtn = document.getElementById('btn-load-more');
    const progress = document.getElementById('gen-progress');
    const label = document.getElementById('gen-status-text');

    btn.disabled = loading;
    if (loadMoreBtn) loadMoreBtn.disabled = loading;

    progress.style.display = loading ? 'block' : 'none';
    if (loading) {
        label.textContent = text;
        progress.querySelector('.progress-fill').style.width = '0%';
    } else {
        label.textContent = '';
    }
}

function updateProgress(percent) {
    const bar = document.querySelector('#gen-progress .progress-fill');
    if (bar) bar.style.width = percent + '%';
}

function toggleLoadMore(show) {
    const btn = document.getElementById('btn-load-more');
    if (btn) {
        btn.style.display = show ? 'inline-flex' : 'none';
        btn.disabled = false;
    }
}

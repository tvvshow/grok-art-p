import { readStream, log, clearLog, bus } from '../utils.js';

let imageData = null;  // base64 data URL of the uploaded image
let isLoading = false;

export function initImg2Img() {
    const dropzone = document.getElementById('img2img-dropzone');
    const fileInput = document.getElementById('img2img-file');
    const clearBtn = document.getElementById('btn-img2img-clear');
    const genBtn = document.getElementById('btn-img2img-generate');

    // Click dropzone to open file picker
    dropzone.addEventListener('click', (e) => {
        if (e.target !== clearBtn && !clearBtn.contains(e.target)) {
            fileInput.click();
        }
    });

    // File selected via picker
    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) loadFile(fileInput.files[0]);
    });

    // Drag & drop
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) loadFile(file);
    });

    // Clear button
    clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearImage();
    });

    // Generate button
    genBtn.addEventListener('click', startGeneration);
}

function loadFile(file) {
    if (file.size > 10 * 1024 * 1024) {
        alert('图片大小不能超过 10MB');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        imageData = e.target.result;  // data URL

        const preview = document.getElementById('img2img-preview');
        const placeholder = document.getElementById('img2img-placeholder');
        const clearBtn = document.getElementById('btn-img2img-clear');
        const fileInfo = document.getElementById('img2img-file-info');

        preview.src = imageData;
        preview.style.display = 'block';
        placeholder.style.display = 'none';
        clearBtn.style.display = 'inline-flex';
        fileInfo.textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
    };
    reader.readAsDataURL(file);
}

function clearImage() {
    imageData = null;

    const preview = document.getElementById('img2img-preview');
    const placeholder = document.getElementById('img2img-placeholder');
    const clearBtn = document.getElementById('btn-img2img-clear');
    const fileInfo = document.getElementById('img2img-file-info');
    const fileInput = document.getElementById('img2img-file');

    preview.src = '';
    preview.style.display = 'none';
    placeholder.style.display = 'block';
    clearBtn.style.display = 'none';
    fileInfo.textContent = '';
    fileInput.value = '';
}

async function startGeneration() {
    if (!imageData) {
        alert('请先上传参考图');
        return;
    }
    if (isLoading) return;

    const prompt = document.getElementById('img2img-prompt').value.trim();
    const count = parseInt(document.getElementById('img2img-count').value) || 4;

    // Reset UI
    document.getElementById('img2img-grid').innerHTML = '';
    clearLog('img2img-log');
    setLoading(true, '正在上传图片...');
    log('img2img-log', `图生图中 [目标: ${count}张]`);

    const loadedUrls = new Set();

    await readStream('/api/imagine/img2img', {
        image_data: imageData,
        prompt,
        count
    }, {
        onProgress: (data) => {
            updateProgress(data.percentage);
            if (data.message) {
                setLoading(true, data.message);
            }
        },
        onData: (data) => {
            if (data.type === 'image' && !loadedUrls.has(data.url || data.image_src)) {
                loadedUrls.add(data.url || data.image_src);
                addImageCard(data);
            }
        },
        onInfo: (data) => log('img2img-log', `信息: ${data.message}`),
        onError: (msg) => {
            log('img2img-log', `错误: ${msg}`, 'error');
            setLoading(false);
        },
        onDone: () => {
            setLoading(false);
            log('img2img-log', '生成完成', 'success');
        }
    });
}

function addImageCard(data) {
    const grid = document.getElementById('img2img-grid');
    const card = document.createElement('div');
    card.className = 'image-card';
    const imgSrc = data.image_src || data.url;

    card.innerHTML = `
        <img src="${imgSrc}" loading="lazy" alt="${data.prompt || ''}">
        <div class="image-info">
            <div class="image-prompt" title="${data.prompt || ''}">${data.prompt || '图生图结果'}</div>
            <div style="margin-top:5px; font-size:0.8em; color:#666;">
                ${data.width}x${data.height}
            </div>
        </div>
    `;

    card.onclick = () => {
        document.querySelectorAll('.image-card.selected').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        bus.emit('image-selected', data);
    };

    grid.appendChild(card);
}

function setLoading(loading, text = '') {
    isLoading = loading;
    const btn = document.getElementById('btn-img2img-generate');
    const progress = document.getElementById('img2img-progress');
    const status = document.getElementById('img2img-status');

    btn.disabled = loading;
    progress.style.display = loading ? 'block' : 'none';
    if (loading) {
        status.textContent = text;
        progress.querySelector('.progress-fill').style.width = '0%';
    } else {
        status.textContent = '';
    }
}

function updateProgress(percent) {
    const bar = document.querySelector('#img2img-progress .progress-fill');
    if (bar) bar.style.width = (percent || 0) + '%';
}

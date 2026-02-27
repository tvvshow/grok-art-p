import { initTokenManager } from './modules/tokenManager.js';
import { initApiKeyManager } from './modules/apiKeyManager.js';
import { initImageGen } from './modules/imageGen.js';
import { initVideoGen } from './modules/videoGen.js';

document.addEventListener('DOMContentLoaded', () => {
    // Tab Switching Logic
    const tabs = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.panel');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;

            // Update Tabs
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update Panels
            panels.forEach(p => p.classList.remove('active'));
            document.getElementById(`panel-${target}`).classList.add('active');
        });
    });

    // Logout button
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await fetch('/api/auth/logout', { method: 'POST' });
            } catch (e) {
                // Ignore errors
            }
            window.location.href = '/';
        });
    }

    // Initialize Modules
    initTokenManager();
    initApiKeyManager();
    initImageGen();
    initVideoGen();

    console.log('应用初始化完成');
});

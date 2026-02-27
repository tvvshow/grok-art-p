// Login page script
(function () {
    const form = document.getElementById('login-form');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const loginBtn = document.getElementById('login-btn');
    const btnText = loginBtn.querySelector('.btn-text');
    const btnLoading = loginBtn.querySelector('.btn-loading');
    const errorDiv = document.getElementById('login-error');

    // Check if already authenticated
    checkAuthStatus();

    async function checkAuthStatus() {
        try {
            const res = await fetch('/api/auth/status');
            const data = await res.json();
            if (data.authenticated) {
                window.location.href = '/app.html';
            }
        } catch (e) {
            // Ignore errors
        }
    }

    function setLoading(loading) {
        loginBtn.disabled = loading;
        btnText.style.display = loading ? 'none' : 'inline';
        btnLoading.style.display = loading ? 'inline' : 'none';
    }

    function showError(message) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }

    function hideError() {
        errorDiv.style.display = 'none';
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError();

        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();

        if (!username) {
            showError('请输入用户名');
            usernameInput.focus();
            return;
        }

        if (!password) {
            showError('请输入密码');
            passwordInput.focus();
            return;
        }

        setLoading(true);

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (data.success) {
                // Redirect to main page
                window.location.href = '/app.html';
            } else {
                showError(data.error || '用户名或密码错误');
                passwordInput.value = '';
                passwordInput.focus();
            }
        } catch (err) {
            showError('网络错误，请重试');
        } finally {
            setLoading(false);
        }
    });

    // Focus username input on load
    usernameInput.focus();
})();

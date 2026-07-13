document.addEventListener('DOMContentLoaded', () => {
    const togglePassword = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('password');
    const form = document.getElementById('loginForm');

    // Fitur Show / Hide Password
    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', function () {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            
            this.classList.toggle('bx-hide');
            this.classList.toggle('bx-show');
        });
    }

    // Efek loading saat disubmit
    if (form) {
        form.addEventListener('submit', () => {
            document.getElementById('loginBtn').innerHTML = "Memproses <i class='bx bx-loader-alt bx-spin'></i>";
        });
    }

    console.log("Sistem Log-in GriyaPlayer Siap.");
});